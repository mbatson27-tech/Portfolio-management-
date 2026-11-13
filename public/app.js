// Portfolio Pulse front end. Plain JS, no build step. Charts use Chart.js (global `Chart`).
const $ = (s) => document.querySelector(s);
const STORE = "portfolio-pulse:v2";
const OLD_STORE = "portfolio-pulse:holdings";
const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;
const RANGES = ["1M", "3M", "6M", "1Y"];

// ---------- state ----------
let state = loadState();
let active = state.portfolios.find((p) => p.id === state.active) || state.portfolios[0];
let portfolio = active.holdings; // holdings of the active portfolio: [{symbol, name, shares, cost}]
let quotes = {};
let news = { holdings: [], market: [] };
let tab = "holdings";
let filter = null;
let selected = null; // symbol shown in the stock chart
let perfRange = "3M";
let detailRange = "3M";
let chat = [];
const charts = {};
const historyCache = new Map();

function newId() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.portfolios) && s.portfolios.length) return s;
    const old = JSON.parse(localStorage.getItem(OLD_STORE)); // migrate the single-portfolio format
    if (Array.isArray(old) && old.length) return { active: "p1", portfolios: [{ id: "p1", name: "My portfolio", holdings: old }] };
  } catch {}
  return { active: "p1", portfolios: [{ id: "p1", name: "My portfolio", holdings: [] }] };
}
function save() {
  state.active = active.id;
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {}
}

// ---------- formatting ----------
const money = (n) => (n == null || isNaN(n) ? "–" : n.toLocaleString(undefined, { style: "currency", currency: "USD" }));
const moneyCompact = (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n, d = 2) => (n == null || isNaN(n) ? "–" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const signed = (n) => (n == null || isNaN(n) ? "–" : `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`);
const arrow = (n) => (n >= 0 ? "▲" : "▼");
const dir = (n) => (n >= 0 ? "up" : "down");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const shortDate = (t) => new Date(t + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

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

// ---------- derived numbers ----------
// Colour follows the holding's position in the portfolio, so it stays put when prices move.
function slotOf(symbol) {
  const i = portfolio.findIndex((h) => h.symbol === symbol);
  const max = portfolio.length > 8 ? 7 : 8;
  return i >= 0 && i < max ? i + 1 : 0; // 0 = "Other"
}
const colorOf = (symbol) => { const s = slotOf(symbol); return css(s ? `--s${s}` : "--s-other"); };

function summary() {
  let value = 0, prev = 0, cost = 0, costedValue = 0, best = null;
  const rows = portfolio.map((h) => {
    const q = quotes[h.symbol];
    const v = q && h.shares ? q.price * h.shares : null;
    if (v != null) { value += v; prev += q.prevClose * h.shares; }
    const gain = v != null && h.cost ? v - h.cost * h.shares : null;
    if (gain != null) { cost += h.cost * h.shares; costedValue += v; }
    if (q && (!best || q.changePct > best.changePct)) best = { symbol: h.symbol, changePct: q.changePct };
    return { ...h, q, value: v, gain, gainPct: gain != null ? (gain / (h.cost * h.shares)) * 100 : null };
  });
  rows.forEach((r) => (r.weight = r.value != null && value ? (r.value / value) * 100 : null));
  return {
    rows, value, hasValue: rows.some((r) => r.value != null),
    day: value - prev, dayPct: prev ? ((value - prev) / prev) * 100 : null,
    gain: cost ? costedValue - cost : null, gainPct: cost ? ((costedValue - cost) / cost) * 100 : null, best,
  };
}

// ---------- data ----------
async function refresh() {
  renderAll();
  const symbols = portfolio.map((h) => h.symbol).join(",");
  const [q, n] = await Promise.all([
    fetch(`/api/quotes?symbols=${symbols}`).then((r) => r.json()).catch(() => ({})),
    fetch(`/api/news?symbols=${symbols}`).then((r) => r.json()).catch(() => ({ holdings: [], market: [] })),
  ]);
  quotes = q; news = n;
  renderAll();
}

function history(symbol, range) {
  const key = `${symbol}:${range}`;
  if (!historyCache.has(key)) {
    historyCache.set(key, fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); return d.points; })
      .catch((e) => { historyCache.delete(key); throw e; }));
  }
  return historyCache.get(key);
}

// ---------- rendering: portfolios ----------
function renderPortfolios() {
  $("#pf-select").innerHTML = state.portfolios.map((p) =>
    `<option value="${p.id}" ${p.id === active.id ? "selected" : ""}>${esc(p.name)} (${p.holdings.length})</option>`).join("");
  $("#pf-delete").hidden = state.portfolios.length < 2;
}

function switchPortfolio(id) {
  active = state.portfolios.find((p) => p.id === id) || state.portfolios[0];
  portfolio = active.holdings;
  filter = null; selected = null; quotes = {}; news = { holdings: [], market: news.market };
  $("#brief").className = "md muted";
  $("#brief").textContent = "Get a plain-English summary of what's happening with this portfolio and the market.";
  $("#brief-btn").textContent = "Generate briefing";
  ideas = []; $("#ideas").innerHTML = "";
  save(); refresh();
}

function panel(html, onSubmit) {
  const p = $("#pf-panel");
  p.innerHTML = `<form>${html}<button type="button" class="ghost small" data-cancel>Cancel</button></form>`;
  p.hidden = false;
  p.querySelector("input")?.select();
  p.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); onSubmit(p.querySelector("input")?.value.trim()); p.hidden = true; });
  p.querySelector("[data-cancel]").addEventListener("click", () => (p.hidden = true));
}

// ---------- rendering: overview ----------
function renderKpis(s) {
  const tile = (label, big, small = "") => `<div class="kpi"><span>${label}</span><b>${big}</b><small>${small}</small></div>`;
  $("#kpis").innerHTML =
    tile("Total value", s.hasValue ? money(s.value) : "–", `${portfolio.length} holding${portfolio.length === 1 ? "" : "s"}`) +
    tile("Today", s.hasValue ? `<span class="${dir(s.day)}" style="font-size:inherit;text-transform:none;letter-spacing:0">${arrow(s.day)} ${signed(s.day)}</span>` : "–",
      s.hasValue ? `<span class="${dir(s.day)}">${pct(s.dayPct)}</span>` : "Add share counts") +
    tile("Total gain / loss", s.gain != null ? `<span class="${dir(s.gain)}" style="font-size:inherit;text-transform:none;letter-spacing:0">${arrow(s.gain)} ${signed(s.gain)}</span>` : "–",
      s.gain != null ? `<span class="${dir(s.gain)}">${pct(s.gainPct)}</span> vs. what you paid` : "Add your average cost to track this") +
    tile("Best today", s.best ? esc(s.best.symbol) : "–", s.best ? `<span class="${dir(s.best.changePct)}">${arrow(s.best.changePct)} ${pct(s.best.changePct)}</span>` : "");
}

function renderHoldings(s) {
  $("#holdings-count").textContent = active.name;
  $("#holdings-body").innerHTML = s.rows.map((h, i) => `<tr data-s="${esc(h.symbol)}" class="${h.symbol === selected ? "selected" : ""}">
      <td><span class="sw" style="background:${colorOf(h.symbol)}"></span><strong>${esc(h.symbol)}</strong>${h.name ? `<span class="name">${esc(h.name)}</span>` : ""}</td>
      <td class="num">${h.shares || "–"}</td>
      <td class="num">${h.q ? money(h.q.price) : "…"}</td>
      <td class="num ${h.q ? dir(h.q.changePct) : ""}">${h.q ? pct(h.q.changePct) : "–"}</td>
      <td class="num">${money(h.value)}</td>
      <td class="num hide-sm ${h.gain != null ? dir(h.gain) : ""}">${h.gain != null ? `${signed(h.gain)}<span class="sub">${pct(h.gainPct, 1)}</span>` : "–"}</td>
      <td class="num hide-sm">${h.weight != null ? h.weight.toFixed(1) + "%" : "–"}</td>
      <td class="num row-actions">
        <button type="button" data-edit="${i}" aria-label="Edit ${esc(h.symbol)}" title="Edit">✎</button>
        <button type="button" class="remove" data-remove="${i}" aria-label="Remove ${esc(h.symbol)}" title="Remove">✕</button>
      </td></tr>`).join("");
  $("#empty-hint").hidden = portfolio.length > 0;
}

function emptyChart(canvasId, message) {
  charts[canvasId]?.destroy(); delete charts[canvasId];
  const box = $("#" + canvasId).parentElement;
  box.querySelector(".chart-empty")?.remove();
  if (message) box.insertAdjacentHTML("beforeend", `<div class="chart-empty">${esc(message)}</div>`);
}

const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(c) {
    const a = c.tooltip?.getActiveElements?.();
    if (!a || !a.length) return;
    const { ctx, chartArea: { top, bottom } } = c;
    ctx.save(); ctx.strokeStyle = css("--line-strong"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a[0].element.x, top); ctx.lineTo(a[0].element.x, bottom); ctx.stroke(); ctx.restore();
  },
};

function lineChart(canvasId, points, color, label) {
  emptyChart(canvasId);
  if (typeof Chart === "undefined") return emptyChart(canvasId, "Charts couldn't load.");
  charts[canvasId] = new Chart($("#" + canvasId), {
    type: "line",
    data: {
      labels: points.map((p) => shortDate(p.t)),
      datasets: [{
        label, data: points.map((p) => p.c), borderColor: color, borderWidth: 2, tension: 0.15,
        pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color, pointHoverBorderColor: css("--card"), pointHoverBorderWidth: 2,
        fill: true, backgroundColor: color + "1f",
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: (c) => `${label}: ${money(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css("--line") }, ticks: { color: css("--muted"), maxTicksLimit: 6, maxRotation: 0 } },
        y: { grid: { color: css("--line") }, border: { display: false }, ticks: { color: css("--muted"), maxTicksLimit: 5, callback: (v) => moneyCompact(v) } },
      },
    },
    plugins: [crosshair],
  });
}

function renderAllocation(s) {
  const valued = s.rows.filter((r) => r.value > 0);
  const main = valued.filter((r) => slotOf(r.symbol));
  const other = valued.filter((r) => !slotOf(r.symbol));
  const slices = main.map((r) => ({ label: r.symbol, value: r.value, color: colorOf(r.symbol) }));
  if (other.length) slices.push({ label: `Other (${other.length})`, value: other.reduce((a, r) => a + r.value, 0), color: css("--s-other") });
  charts.alloc?.destroy(); delete charts.alloc;
  $("#alloc-center").innerHTML = slices.length ? `<b>${moneyCompact(s.value)}</b><span>total</span>` : `<span>Add share counts to see your allocation</span>`;
  $("#alloc-legend").innerHTML = slices.map((x) =>
    `<li><span class="sw" style="background:${x.color}"></span><span class="lbl">${esc(x.label)}</span><span class="pct">${((x.value / s.value) * 100).toFixed(1)}%</span><span class="val">${money(x.value)}</span></li>`).join("");
  if (!slices.length || typeof Chart === "undefined") return;
  charts.alloc = new Chart($("#alloc-chart"), {
    type: "doughnut",
    data: { labels: slices.map((x) => x.label), datasets: [{ data: slices.map((x) => x.value), backgroundColor: slices.map((x) => x.color), borderColor: css("--card"), borderWidth: 2, hoverOffset: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: "68%", animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${money(c.parsed)} · ${((c.parsed / s.value) * 100).toFixed(1)}%` } } },
    },
  });
}

function segButtons(el, current, onPick) {
  el.innerHTML = RANGES.map((r) => `<button type="button" class="${r === current ? "active" : ""}" data-r="${r}">${r}</button>`).join("");
  el.onclick = (e) => { const b = e.target.closest("button"); if (b) onPick(b.dataset.r); };
}

function changeLine(first, last, range) {
  const d = last - first;
  return `<span class="${dir(d)}">${arrow(d)} ${signed(d)} (${pct(first ? (d / first) * 100 : 0)})</span><span class="muted">past ${range}</span>`;
}

let perfToken = 0;
async function renderPerformance() {
  const token = ++perfToken;
  segButtons($("#perf-range"), perfRange, (r) => { perfRange = r; renderPerformance(); });
  const held = portfolio.filter((h) => h.shares > 0);
  $("#perf-note").textContent = "";
  if (!held.length) {
    $("#perf-head").innerHTML = "";
    return emptyChart("perf-chart", portfolio.length ? "Add share counts to see your portfolio's value over time." : "Add stocks to see your portfolio's value over time.");
  }
  try {
    const series = await Promise.all(held.map((h) => history(h.symbol, perfRange)));
    if (token !== perfToken) return;
    // Sum shares × close per day, carrying the last known close forward where a date is missing.
    const dates = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort();
    const maps = series.map((s) => new Map(s.map((p) => [p.t, p.c])));
    const last = new Array(held.length).fill(null);
    const points = [];
    for (const t of dates) {
      maps.forEach((m, i) => { if (m.has(t)) last[i] = m.get(t); });
      if (last.every((v) => v != null)) points.push({ t, c: Math.round(held.reduce((a, h, i) => a + h.shares * last[i], 0) * 100) / 100 });
    }
    if (points.length < 2) throw new Error("Not enough price history.");
    $("#perf-head").innerHTML = `<b>${money(points.at(-1).c)}</b>${changeLine(points[0].c, points.at(-1).c, perfRange)}`;
    $("#perf-note").textContent = "Shows what today's holdings were worth each day. It doesn't account for when you bought or sold.";
    lineChart("perf-chart", points, css("--s1"), "Value");
  } catch (e) {
    if (token !== perfToken) return;
    $("#perf-head").innerHTML = "";
    emptyChart("perf-chart", `Couldn't load price history. ${e.message}`);
  }
}

let detailToken = 0;
async function renderDetail(s) {
  const token = ++detailToken;
  segButtons($("#detail-range"), detailRange, (r) => { detailRange = r; renderDetail(summary()); });
  if (!selected || !portfolio.some((h) => h.symbol === selected)) selected = portfolio[0]?.symbol || null;
  if (!selected) {
    $("#detail-title").textContent = "Stock chart";
    $("#detail-head").innerHTML = ""; $("#detail-stats").innerHTML = ""; $("#detail-news").innerHTML = "";
    return emptyChart("detail-chart", "Add a stock, then click its row to see its price chart.");
  }
  const row = s.rows.find((r) => r.symbol === selected);
  $("#detail-title").textContent = `${selected}${row.name ? " · " + row.name : ""}`;
  const stories = news.holdings.filter((n) => n.symbol === selected).slice(0, 3);
  $("#detail-news").innerHTML = stories.map((n) =>
    `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a><div class="meta">${esc(n.source)} · ${ago(n.datetime)}</div></li>`).join("");
  try {
    const points = await history(selected, detailRange);
    if (token !== detailToken) return;
    const closes = points.map((p) => p.c);
    $("#detail-head").innerHTML = `<b>${money(closes.at(-1))}</b>${changeLine(closes[0], closes.at(-1), detailRange)}`;
    const stat = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    $("#detail-stats").innerHTML =
      stat(`${detailRange} high`, money(Math.max(...closes))) + stat(`${detailRange} low`, money(Math.min(...closes))) +
      stat("Your position", row.value != null ? money(row.value) : "–") +
      stat("Your gain / loss", row.gain != null ? `<span class="${dir(row.gain)}">${signed(row.gain)}</span>` : "–");
    lineChart("detail-chart", points, colorOf(selected), selected);
  } catch (e) {
    if (token !== detailToken) return;
    $("#detail-head").innerHTML = ""; $("#detail-stats").innerHTML = "";
    emptyChart("detail-chart", `Couldn't load price history. ${e.message}`);
  }
}

// ---------- rendering: news ----------
function renderNews() {
  const chips = $("#news-filter");
  chips.innerHTML = tab === "holdings" && portfolio.length > 1
    ? [null, ...portfolio.map((h) => h.symbol)].map((s) => `<button type="button" class="chip ${filter === s ? "active" : ""}" data-s="${s ?? ""}">${s ?? "All"}</button>`).join("")
    : "";
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

function renderAll() {
  const s = summary();
  if (!selected || !portfolio.some((h) => h.symbol === selected)) selected = portfolio[0]?.symbol || null;
  renderPortfolios(); renderKpis(s); renderHoldings(s); renderAllocation(s); renderNews();
  renderPerformance(); renderDetail(s);
}

// ---------- streaming helper ----------
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

// ---------- events: views ----------
const VIEWS = ["overview", "news", "assistant", "trade"];
function showView() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
  VIEWS.forEach((name) => ($("#view-" + name).hidden = name !== v));
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  if (v === "overview") Object.values(charts).forEach((c) => c.resize());
}
window.addEventListener("hashchange", showView);

// ---------- events: portfolios ----------
$("#pf-select").addEventListener("change", (e) => switchPortfolio(e.target.value));
$("#pf-new").addEventListener("click", () =>
  panel(`<input id="pf-name" placeholder="Name, e.g. Retirement or Tech picks" maxlength="40" required /><button type="submit" class="small">Create portfolio</button>`, (name) => {
    if (!name) return;
    const p = { id: newId(), name, holdings: [] };
    state.portfolios.push(p); switchPortfolio(p.id);
    location.hash = "overview"; $("#symbol").focus();
  }));
$("#pf-rename").addEventListener("click", () =>
  panel(`<input id="pf-name" value="${esc(active.name)}" maxlength="40" required /><button type="submit" class="small">Save name</button>`, (name) => {
    if (!name) return;
    active.name = name; save(); renderAll();
  }));
$("#pf-delete").addEventListener("click", () =>
  panel(`<span>Delete “${esc(active.name)}” and its ${portfolio.length} holding${portfolio.length === 1 ? "" : "s"}? This can't be undone.</span><button type="submit" class="small danger">Delete portfolio</button>`, () => {
    state.portfolios = state.portfolios.filter((p) => p.id !== active.id);
    switchPortfolio(state.portfolios[0].id);
  }));

// ---------- events: add / edit holdings with ticker search ----------
let suggestions = [], sIndex = -1, sTimer, picked = null;
function renderSuggest() {
  const ul = $("#suggest");
  ul.hidden = !suggestions.length;
  $("#symbol").setAttribute("aria-expanded", String(!!suggestions.length));
  ul.innerHTML = suggestions.map((s, i) => `<li role="option" data-i="${i}" class="${i === sIndex ? "active" : ""}"><b>${esc(s.symbol)}</b><span>${esc(s.name)}</span></li>`).join("");
}
function pick(s) {
  picked = s; $("#symbol").value = s.symbol; suggestions = []; sIndex = -1; renderSuggest(); $("#shares").focus();
}
$("#symbol").addEventListener("input", () => {
  picked = null; clearTimeout(sTimer);
  const q = $("#symbol").value.trim();
  if (!q) { suggestions = []; return renderSuggest(); }
  sTimer = setTimeout(async () => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => []);
    if ($("#symbol").value.trim() !== q) return;
    suggestions = Array.isArray(res) ? res : []; sIndex = -1; renderSuggest();
  }, 180);
});
$("#symbol").addEventListener("keydown", (e) => {
  if (!suggestions.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sIndex = (sIndex + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length; renderSuggest();
  } else if (e.key === "Enter" && sIndex >= 0) { e.preventDefault(); pick(suggestions[sIndex]); }
  else if (e.key === "Escape") { suggestions = []; renderSuggest(); }
});
$("#suggest").addEventListener("mousedown", (e) => {
  const li = e.target.closest("li"); if (!li) return;
  e.preventDefault(); pick(suggestions[+li.dataset.i]);
});
$("#symbol").addEventListener("blur", () => setTimeout(() => { suggestions = []; renderSuggest(); }, 150));

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const typed = $("#symbol").value.trim().toUpperCase();
  // Use what was picked; otherwise the typed ticker; otherwise the top search result.
  const choice = picked?.symbol === typed ? picked : SYMBOL_RE.test(typed) ? { symbol: typed, name: suggestions.find((s) => s.symbol === typed)?.name } : suggestions[0];
  if (!choice) { $("#symbol").focus(); return; }
  const shares = parseFloat($("#shares").value) || 0;
  const cost = parseFloat($("#cost").value) || 0;
  const existing = portfolio.find((h) => h.symbol === choice.symbol);
  if (existing) {
    if ($("#shares").value !== "") existing.shares = shares;
    if ($("#cost").value !== "") existing.cost = cost;
    if (choice.name) existing.name = choice.name;
  } else portfolio.push({ symbol: choice.symbol, name: choice.name || "", shares, cost });
  selected = choice.symbol; picked = null; suggestions = []; renderSuggest();
  save(); e.target.reset(); $("#add-btn").textContent = "Add"; $("#symbol").focus();
  refresh();
});

$("#holdings-body").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]"), ed = e.target.closest("[data-edit]"), tr = e.target.closest("tr");
  if (rm) {
    const [removed] = portfolio.splice(+rm.dataset.remove, 1);
    if (filter === removed.symbol) filter = null;
    if (selected === removed.symbol) selected = null;
    save(); refresh();
  } else if (ed) {
    const h = portfolio[+ed.dataset.edit];
    $("#symbol").value = h.symbol; $("#shares").value = h.shares || ""; $("#cost").value = h.cost || "";
    picked = { symbol: h.symbol, name: h.name }; $("#add-btn").textContent = "Update"; $("#shares").focus();
  } else if (tr) { selected = tr.dataset.s; const s = summary(); renderHoldings(s); renderDetail(s); }
});

// ---------- events: news, briefing, chat ----------
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

async function ask(q) {
  const log = $("#chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(q)}</div>`);
  const el = document.createElement("div"); el.className = "msg assistant md"; log.appendChild(el);
  log.scrollTo(0, 1e9);
  chat.push({ role: "user", content: q });
  const answer = await streamInto("/api/chat", { portfolio, messages: chat }, el);
  chat.push({ role: "assistant", content: answer || "(no answer)" });
}
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#chat-input").value.trim(); if (!q) return;
  $("#chat-input").value = ""; ask(q);
});
$("#chat-suggest").innerHTML = ["What moved my portfolio today?", "Which holding has the most risk right now?", "What should I watch this week?", "Summarise the market in 3 bullets"]
  .map((q) => `<button type="button" class="chip">${q}</button>`).join("");
$("#chat-suggest").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (c) ask(c.textContent); });

// ---------- trading: AI suggests, user confirms each order ----------
let ideas = [];
let lastSummary = "";
let brokerInfo = { broker: "simulated", maxOrderUsd: 1000 };

async function loadAccount() {
  const [acct, orders] = await Promise.all([
    fetch("/api/broker/account").then((r) => r.json()).catch((e) => ({ error: e.message })),
    fetch("/api/broker/orders").then((r) => r.json()).catch(() => []),
  ]);
  if (acct.error) { $("#account").innerHTML = `<p class="warn">Broker error: ${esc(acct.error)}</p>`; return; }
  const pos = acct.positions.length ? acct.positions.map((p) => `${esc(p.symbol)} ${p.qty}`).join(" · ") : "No positions yet";
  $("#account").innerHTML = `
    <div class="stat"><span>Cash</span><b>${money(acct.cash)}</b></div>
    <div class="stat"><span>Buying power</span><b>${money(acct.buyingPower)}</b></div>
    <div class="stat"><span>Account value</span><b>${money(acct.equity)}</b></div>
    <div class="pos">Broker positions: ${pos}</div>`;
  $("#orders").innerHTML = Array.isArray(orders) && orders.length
    ? orders.map((o) => `<li><span class="side-${o.side}">${o.side.toUpperCase()}</span> ${o.qty} ${esc(o.symbol)} · ${esc(o.status)}${o.filledPrice ? ` @ ${money(o.filledPrice)}` : ""} · ${new Date(o.submittedAt).toLocaleString()}</li>`).join("")
    : `<li class="muted">No orders yet.</li>`;
}

function renderIdeas(summaryText) {
  const box = $("#ideas");
  const head = summaryText ? `<div class="md" style="margin-top:10px">${md(summaryText)}</div>` : "";
  if (!ideas.length) { box.innerHTML = head + (summaryText ? `<p class="muted">No trades suggested right now.</p>` : ""); return; }
  box.innerHTML = head + ideas.map((i, n) => {
    const label = `${i.side.toUpperCase()} ${i.qty} ${esc(i.symbol)}`;
    let actions;
    if (i.state === "done") actions = `<span class="confirm-text up">✓ ${esc(i.result)}</span>`;
    else if (i.state === "error") actions = `<span class="warn">${esc(i.result)}</span> <button type="button" class="secondary" data-act="dismiss" data-n="${n}">Dismiss</button>`;
    else if (i.state === "confirming") actions = `
      <span class="confirm-text">Place a market order to ${label} for about ${money(i.estValue)}${brokerInfo.broker === "live" ? " with REAL money" : ""}?</span>
      <button type="button" class="${brokerInfo.broker === "live" ? "danger" : ""}" data-act="confirm" data-n="${n}">Yes, place order</button>
      <button type="button" class="secondary" data-act="cancel" data-n="${n}">Cancel</button>`;
    else if (i.state === "placing") actions = `<span class="muted">Placing order…</span>`;
    else if (i.state === "skipped") actions = `<span class="muted">Skipped</span>`;
    else actions = i.problem
      ? `<span class="warn">Can't place: ${esc(i.problem)}</span> <button type="button" class="secondary" data-act="skip" data-n="${n}">Dismiss</button>`
      : `<button type="button" data-act="approve" data-n="${n}">Review order</button> <button type="button" class="secondary" data-act="skip" data-n="${n}">Skip</button>`;
    return `<div class="idea ${i.state === "done" || i.state === "skipped" ? "done" : ""}">
      <div class="idea-head"><strong class="side-${i.side}">${label}</strong>
        <span class="badge">${esc(i.confidence)} confidence · ≈ ${money(i.estValue)}</span></div>
      <p>${esc(i.rationale)}</p>
      <p class="risk"><b>Risks:</b> ${esc(i.risks)}</p>
      <div class="actions">${actions}</div>
    </div>`;
  }).join("");
}

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

// ---------- start ----------
fetch("/api/status").then((r) => r.json()).then((s) => {
  brokerInfo = s;
  $("#status").innerHTML =
    `<span class="badge ${s.liveData ? "" : "demo"}">${s.liveData ? "Live market data" : "Sample market data"}</span>` +
    `<span class="badge ${s.ai ? "" : "demo"}">${s.ai ? "AI: " + esc(s.model) : "AI: sample mode"}</span>`;
  const b = $("#broker-badge");
  b.textContent = { simulated: "Simulated account", paper: "Alpaca paper trading", live: "LIVE: real money" }[s.broker];
  b.className = `badge ${s.broker === "live" ? "live" : s.broker === "simulated" ? "demo" : ""}`;
});

// Redraw charts when the colour theme changes, since canvas colours are read from CSS tokens.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
new MutationObserver(renderAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

showView();
refresh();
loadAccount();
setInterval(refresh, 5 * 60 * 1000);
