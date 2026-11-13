// Portfolio Pulse front end. Plain JS, no build step.
const $ = (s) => document.querySelector(s);
const STORE = "portfolio-pulse:holdings";

let portfolio = load();
let quotes = {};
let news = { holdings: [], market: [] };
let tab = "holdings";
let filter = null;
const chat = [];

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(portfolio)); } catch {}
}

const money = (n) => (n == null || isNaN(n) ? "–" : n.toLocaleString(undefined, { style: "currency", currency: "USD" }));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// Minimal, safe Markdown: escape everything first, then add a few formats.
function md(src) {
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html = "", list = false;
  for (const line of src.split("\n")) {
    const li = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+\.\s+(.*)/);
    if (li) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) html += `<h3>${inline(h[1])}</h3>`;
    else if (line.startsWith(">")) html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

// ---------- data ----------
async function refresh() {
  renderHoldings();
  if (!portfolio.length) { news = { holdings: [], market: news.market }; }
  const symbols = portfolio.map((h) => h.symbol).join(",");
  const [q, n] = await Promise.all([
    fetch(`/api/quotes?symbols=${symbols}`).then((r) => r.json()).catch(() => ({})),
    fetch(`/api/news?symbols=${symbols}`).then((r) => r.json()).catch(() => ({ holdings: [], market: [] })),
  ]);
  quotes = q; news = n;
  renderHoldings(); renderNews();
}

// ---------- rendering ----------
function renderHoldings() {
  const body = $("#holdings-body");
  let total = 0, anyValue = false;
  body.innerHTML = portfolio.map((h, i) => {
    const q = quotes[h.symbol];
    const value = q && h.shares ? q.price * h.shares : null;
    if (value != null) { total += value; anyValue = true; }
    const cls = q ? (q.changePct >= 0 ? "up" : "down") : "";
    const pct = q ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "–";
    return `<tr>
      <td><strong>${esc(h.symbol)}</strong></td>
      <td class="num">${h.shares || "–"}</td>
      <td class="num">${q ? money(q.price) : "…"}</td>
      <td class="num ${cls}">${pct}</td>
      <td class="num">${money(value)}</td>
      <td class="num"><button class="remove" data-i="${i}" aria-label="Remove ${esc(h.symbol)}">✕</button></td>
    </tr>`;
  }).join("");
  $("#total-value").textContent = anyValue ? money(total) : "–";
  $("#empty-hint").hidden = portfolio.length > 0;
}

function renderNews() {
  const chips = $("#news-filter");
  if (tab === "holdings" && portfolio.length > 1) {
    chips.innerHTML = [null, ...portfolio.map((h) => h.symbol)]
      .map((s) => `<button class="chip ${filter === s ? "active" : ""}" data-s="${s ?? ""}">${s ?? "All"}</button>`).join("");
  } else chips.innerHTML = "";

  let items = tab === "market" ? news.market : news.holdings;
  if (tab === "holdings" && filter) items = items.filter((n) => n.symbol === filter);
  $("#news").innerHTML = items.length
    ? items.map((n) => `<li>
        <div>${n.symbol ? `<span class="tag">${esc(n.symbol)}</span>` : ""}<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a></div>
        <div class="meta">${esc(n.source)} · ${ago(n.datetime)}</div>
        ${n.summary ? `<p class="sum">${esc(n.summary.slice(0, 220))}${n.summary.length > 220 ? "…" : ""}</p>` : ""}
      </li>`).join("")
    : `<li class="muted">${tab === "holdings" && !portfolio.length ? "Add holdings to see their news." : "No recent stories found."}</li>`;
}

// Reads a Server-Sent Events stream of {text}/{error}/{done} objects.
async function streamInto(url, body, el) {
  el.classList.remove("muted"); el.classList.add("typing"); el.innerHTML = "";
  let text = "";
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop();
      for (const p of parts) {
        if (!p.startsWith("data: ")) continue;
        const msg = JSON.parse(p.slice(6));
        if (msg.text) { text += msg.text; el.innerHTML = md(text); }
        if (msg.error) { text += `\n\n**Error:** ${msg.error}`; el.innerHTML = md(text); }
      }
      el.closest(".chat-log")?.scrollTo(0, 1e9);
    }
  } catch (e) {
    text += `\n\n**Error:** ${e.message}`; el.innerHTML = md(text);
  }
  el.classList.remove("typing");
  return text;
}

// ---------- events ----------
$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const symbol = $("#symbol").value.trim().toUpperCase();
  const shares = parseFloat($("#shares").value) || 0;
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) return;
  const existing = portfolio.find((h) => h.symbol === symbol);
  if (existing) existing.shares = shares || existing.shares;
  else portfolio.push({ symbol, shares });
  save(); $("#symbol").value = ""; $("#shares").value = ""; $("#symbol").focus();
  refresh();
});

$("#holdings-body").addEventListener("click", (e) => {
  const b = e.target.closest(".remove"); if (!b) return;
  const [removed] = portfolio.splice(+b.dataset.i, 1);
  if (filter === removed.symbol) filter = null;
  save(); refresh();
});

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  tab = t.dataset.tab; renderNews();
}));
$("#news-filter").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (!c) return;
  filter = c.dataset.s || null; renderNews();
});

$("#brief-btn").addEventListener("click", async () => {
  if (!portfolio.length) { $("#brief").innerHTML = md("Add at least one holding first."); return; }
  const btn = $("#brief-btn"); btn.disabled = true; btn.textContent = "Writing…";
  await streamInto("/api/brief", { portfolio }, $("#brief"));
  btn.disabled = false; btn.textContent = "Refresh briefing";
});

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input"); const q = input.value.trim(); if (!q) return;
  input.value = "";
  const log = $("#chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
  const el = document.createElement("div"); el.className = "msg assistant md"; log.appendChild(el);
  log.scrollTo(0, 1e9);
  chat.push({ role: "user", content: q });
  const answer = await streamInto("/api/chat", { portfolio, messages: chat }, el);
  chat.push({ role: "assistant", content: answer || "(no answer)" });
});

fetch("/api/status").then((r) => r.json()).then((s) => {
  $("#status").innerHTML =
    `<span class="badge ${s.liveData ? "" : "demo"}">${s.liveData ? "Live market data" : "Demo market data"}</span>` +
    `<span class="badge ${s.ai ? "" : "demo"}">${s.ai ? "AI: " + esc(s.model) : "AI: demo mode"}</span>`;
});

refresh();
setInterval(refresh, 5 * 60 * 1000);

// ---------- trading: AI suggests, user confirms each order ----------
let ideas = [];
let brokerInfo = { broker: "simulated", maxOrderUsd: 1000 };

async function loadAccount() {
  const [acct, orders] = await Promise.all([
    fetch("/api/broker/account").then((r) => r.json()).catch((e) => ({ error: e.message })),
    fetch("/api/broker/orders").then((r) => r.json()).catch(() => []),
  ]);
  if (acct.error) { $("#account").innerHTML = `<p class="warn">Broker error: ${esc(acct.error)}</p>`; return; }
  const pos = acct.positions.length
    ? acct.positions.map((p) => `${esc(p.symbol)} ${p.qty}`).join(" · ")
    : "No positions yet";
  $("#account").innerHTML = `
    <div class="stat"><span>Cash</span><b>${money(acct.cash)}</b></div>
    <div class="stat"><span>Buying power</span><b>${money(acct.buyingPower)}</b></div>
    <div class="stat"><span>Account value</span><b>${money(acct.equity)}</b></div>
    <div class="pos">Broker positions: ${pos}</div>`;
  $("#orders").innerHTML = Array.isArray(orders) && orders.length
    ? orders.map((o) => `<li><span class="side-${o.side}">${o.side.toUpperCase()}</span> ${o.qty} ${esc(o.symbol)} · ${esc(o.status)}${o.filledPrice ? ` @ ${money(o.filledPrice)}` : ""} · ${new Date(o.submittedAt).toLocaleString()}</li>`).join("")
    : `<li class="muted">No orders yet.</li>`;
}

function renderIdeas(summary) {
  const box = $("#ideas");
  const head = summary ? `<div class="md" style="margin-top:10px">${md(summary)}</div>` : "";
  if (!ideas.length) { box.innerHTML = head + (summary ? `<p class="muted">No trades suggested right now.</p>` : ""); return; }
  box.innerHTML = head + ideas.map((i, n) => {
    const label = `${i.side.toUpperCase()} ${i.qty} ${esc(i.symbol)}`;
    let actions;
    if (i.state === "done") actions = `<span class="confirm-text up">✓ ${esc(i.result)}</span>`;
    else if (i.state === "error") actions = `<span class="warn">${esc(i.result)}</span> <button class="secondary" data-act="dismiss" data-n="${n}">Dismiss</button>`;
    else if (i.state === "confirming") actions = `
      <span class="confirm-text">Place a market order to ${label} for about ${money(i.estValue)}${brokerInfo.broker === "live" ? " with REAL money" : ""}?</span>
      <button class="${brokerInfo.broker === "live" ? "danger" : ""}" data-act="confirm" data-n="${n}">Yes, place order</button>
      <button class="secondary" data-act="cancel" data-n="${n}">Cancel</button>`;
    else if (i.state === "placing") actions = `<span class="muted">Placing order…</span>`;
    else if (i.state === "skipped") actions = `<span class="muted">Skipped</span>`;
    else actions = i.problem
      ? `<span class="warn">Can't place: ${esc(i.problem)}</span> <button class="secondary" data-act="skip" data-n="${n}">Dismiss</button>`
      : `<button data-act="approve" data-n="${n}">Review order</button> <button class="secondary" data-act="skip" data-n="${n}">Skip</button>`;
    return `<div class="idea ${i.state === "done" || i.state === "skipped" ? "done" : ""}">
      <div class="idea-head"><strong class="side-${i.side}">${label}</strong>
        <span class="badge">${esc(i.confidence)} confidence · ≈ ${money(i.estValue)}</span></div>
      <p>${esc(i.rationale)}</p>
      <p class="risk"><b>Risks:</b> ${esc(i.risks)}</p>
      <div class="actions">${actions}</div>
    </div>`;
  }).join("");
}
let lastSummary = "";

$("#ideas-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#ideas-btn"); btn.disabled = true; btn.textContent = "Thinking…";
  $("#ideas").innerHTML = `<p class="muted typing">Analysing your holdings and the news</p>`;
  try {
    const r = await fetch("/api/trade/ideas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolio, goal: $("#goal").value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);
    ideas = data.ideas.map((i) => ({ ...i, state: "new" }));
    lastSummary = data.summary;
    renderIdeas(lastSummary);
  } catch (err) {
    $("#ideas").innerHTML = `<p class="warn">Couldn't get ideas: ${esc(err.message)}</p>`;
  }
  btn.disabled = false; btn.textContent = "Get trade ideas";
});

$("#ideas").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const i = ideas[+b.dataset.n];
  const act = b.dataset.act;
  if (act === "approve") i.state = "confirming";
  else if (act === "cancel") i.state = "new";
  else if (act === "skip" || act === "dismiss") i.state = "skipped";
  else if (act === "confirm") {
    i.state = "placing"; renderIdeas(lastSummary);
    try {
      const r = await fetch("/api/trade/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: i.symbol, side: i.side, qty: i.qty, confirmed: true }),
      });
      const o = await r.json();
      if (!r.ok) throw new Error(o.error || r.statusText);
      i.state = "done"; i.result = `Order ${o.status}${o.filledPrice ? ` at ${money(o.filledPrice)}` : ""}`;
    } catch (err) {
      i.state = "error"; i.result = err.message;
    }
    loadAccount();
  }
  renderIdeas(lastSummary);
});

fetch("/api/status").then((r) => r.json()).then((s) => {
  brokerInfo = s;
  const b = $("#broker-badge");
  b.textContent = { simulated: "Simulated account", paper: "Alpaca paper trading", live: "LIVE: real money" }[s.broker];
  b.className = `badge ${s.broker === "live" ? "live" : s.broker === "simulated" ? "demo" : ""}`;
});
loadAccount();
