// Portfolio Pulse: a small Express server that keeps API keys server-side,
// fetches prices and news for a user's holdings, and streams an AI briefing.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { demoQuote, demoCompanyNews, demoMarketNews, demoBrief, demoTradeIdeas, demoHistory, demoSearch, RANGE_DAYS } from "./demo.js";
import { brokerMode, getAccount, getOrders, placeOrder, MAX_ORDER_USD } from "./broker.js";

const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
// Chart.js is served from the installed package, so the app needs no CDN.
app.get("/vendor/chart.umd.js", (_req, res) => res.sendFile("chart.umd.js", { root: "node_modules/chart.js/dist" }));

// ---------- helpers ----------
const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;
function parseSymbols(raw) {
  return [...new Set(String(raw || "").toUpperCase().split(",").map((s) => s.trim()))]
    .filter((s) => SYMBOL_RE.test(s))
    .slice(0, 25);
}

const cache = new Map(); // tiny TTL cache so we stay inside Finnhub's free 60 calls/min
async function finnhub(path, params, ttlMs = 60_000) {
  const qs = new URLSearchParams({ ...params, token: FINNHUB_KEY });
  const url = `https://finnhub.io/api/v1/${path}?${qs}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${path} ${res.status}`);
  const v = await res.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}

const isoDate = (d) => d.toISOString().slice(0, 10);
const normalizeNews = (items, symbol) =>
  (items || []).slice(0, 8).map((n) => ({
    symbol,
    headline: n.headline,
    summary: n.summary,
    source: n.source,
    url: n.url,
    datetime: n.datetime * 1000,
  }));

async function getQuotes(symbols) {
  if (!FINNHUB_KEY) return Object.fromEntries(symbols.map((s) => [s, demoQuote(s)]));
  const out = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await finnhub("quote", { symbol: s }, 30_000);
        out[s] = { price: q.c, change: q.d, changePct: q.dp, prevClose: q.pc };
      } catch {
        out[s] = null;
      }
    })
  );
  return out;
}

async function getNews(symbols) {
  if (!FINNHUB_KEY) {
    return {
      holdings: symbols.flatMap((s) => demoCompanyNews(s)),
      market: demoMarketNews(),
    };
  }
  const to = new Date();
  const from = new Date(Date.now() - 7 * 864e5);
  const holdings = (
    await Promise.all(
      symbols.map((s) =>
        finnhub("company-news", { symbol: s, from: isoDate(from), to: isoDate(to) }, 10 * 60_000)
          .then((items) => normalizeNews(items, s))
          .catch(() => [])
      )
    )
  ).flat();
  const market = await finnhub("news", { category: "general" }, 10 * 60_000)
    .then((items) => normalizeNews(items, null).slice(0, 12))
    .catch(() => []);
  holdings.sort((a, b) => b.datetime - a.datetime);
  return { holdings, market };
}

// Compact text context handed to Claude.
function buildContext(portfolio, quotes, news) {
  const lines = portfolio.map((h) => {
    const q = quotes[h.symbol];
    const px = q ? `$${q.price?.toFixed(2)} (${q.changePct?.toFixed(2)}% today)` : "price n/a";
    return `- ${h.symbol}${h.shares ? `, ${h.shares} shares` : ""}: ${px}`;
  });
  const fmt = (n) =>
    `[${n.symbol || "MARKET"}] ${new Date(n.datetime).toISOString().slice(0, 10)} ${n.source}: ${n.headline}${
      n.summary ? ` | ${n.summary.slice(0, 280)}` : ""
    }`;
  return [
    "PORTFOLIO:",
    ...lines,
    "",
    "RECENT HOLDING NEWS:",
    ...news.holdings.slice(0, 40).map(fmt),
    "",
    "MARKET NEWS:",
    ...news.market.slice(0, 12).map(fmt),
  ].join("\n");
}

const SYSTEM = `You are Portfolio Pulse, a news assistant that keeps an individual investor informed about the stocks they own and the market overall.
Today is ${isoDate(new Date())}.
- Ground every claim in the provided news or in web search results, and name the source.
- Explain why a story matters for the specific holding, in plain language.
- Be balanced: cover risks as well as positives. Say clearly when news is thin or stale.
- You inform; you do not give personalised buy/sell advice. If asked what to buy or sell, explain the relevant considerations instead and suggest a licensed adviser for decisions.
- Keep answers concise and skimmable, using short Markdown headings and bullets.`;

// Streams a Claude response as Server-Sent Events of {text} chunks.
async function streamClaude(res, messages, { webSearch = false } = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium" },
      // Server-side fallback: if a request is declined, the API reroutes it to a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }] : undefined,
      messages,
    });
    stream.on("text", (text) => send({ text }));
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") send({ text: "\n\n*The assistant declined to answer this one.*" });
    send({ done: true });
  } catch (err) {
    console.error(err);
    send({ error: err instanceof Anthropic.APIError ? `AI error (${err.status}): ${err.message}` : String(err) });
  }
  res.end();
}

async function streamDemo(res, text) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const chunk of text.match(/[\s\S]{1,40}/g)) {
    res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    await new Promise((r) => setTimeout(r, 15));
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}

function cleanPortfolio(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((h) => ({ symbol: String(h.symbol || "").toUpperCase(), shares: Number(h.shares) || 0 }))
    .filter((h) => SYMBOL_RE.test(h.symbol))
    .slice(0, 25);
}

// ---------- routes ----------
app.get("/api/status", (_req, res) =>
  res.json({ liveData: Boolean(FINNHUB_KEY), ai: Boolean(anthropic), model: MODEL, broker: brokerMode(), maxOrderUsd: MAX_ORDER_USD })
);

app.get("/api/quotes", async (req, res) => res.json(await getQuotes(parseSymbols(req.query.symbols))));

app.get("/api/news", async (req, res) => res.json(await getNews(parseSymbols(req.query.symbols))));

// Daily closing prices for charts. Twelve Data (free tier) when keyed, demo data otherwise.
const historyCache = new Map();
app.get("/api/history", async (req, res) => {
  const [symbol] = parseSymbols(req.query.symbol);
  const range = RANGE_DAYS[req.query.range] ? req.query.range : "3M";
  if (!symbol) return res.status(400).json({ error: "Missing symbol." });
  if (!TWELVEDATA_KEY) return res.json({ symbol, range, demo: true, points: demoHistory(symbol, range) });
  const key = `${symbol}:${range}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60_000) return res.json(hit.v);
  try {
    const qs = new URLSearchParams({ symbol, interval: "1day", outputsize: String(RANGE_DAYS[range]), apikey: TWELVEDATA_KEY });
    const data = await fetch(`https://api.twelvedata.com/time_series?${qs}`).then((r) => r.json());
    if (data.status === "error") throw new Error(data.message);
    const points = data.values.map((v) => ({ t: v.datetime.slice(0, 10), c: Number(v.close) })).reverse();
    const v = { symbol, range, points };
    historyCache.set(key, { t: Date.now(), v });
    res.json(v);
  } catch (e) {
    res.status(502).json({ error: `Price history unavailable: ${e.message}` });
  }
});

// Ticker search for the "add stock" box. Finnhub when keyed, a built-in list otherwise.
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 30);
  if (!q) return res.json([]);
  if (!FINNHUB_KEY) return res.json(demoSearch(q));
  try {
    const data = await finnhub("search", { q }, 24 * 3600_000);
    res.json(
      (data.result || [])
        .filter((r) => r.type === "Common Stock" || r.type === "ETP" || r.type === "ETF")
        .filter((r) => SYMBOL_RE.test(r.symbol))
        .slice(0, 8)
        .map((r) => ({ symbol: r.symbol, name: r.description }))
    );
  } catch {
    res.json(demoSearch(q));
  }
});

app.post("/api/brief", async (req, res) => {
  const portfolio = cleanPortfolio(req.body.portfolio);
  if (!portfolio.length) return res.status(400).json({ error: "Add at least one holding." });
  const symbols = portfolio.map((h) => h.symbol);
  const [quotes, news] = await Promise.all([getQuotes(symbols), getNews(symbols)]);
  if (!anthropic) return streamDemo(res, demoBrief(portfolio, quotes, news));
  const prompt = `${buildContext(portfolio, quotes, news)}

Write my daily briefing:
1. "Market backdrop": 2-3 bullets on the overall market.
2. "Your holdings": for each holding with meaningful news, the key story, why it matters, and whether it reads as positive, negative or mixed. Group holdings with no notable news into one line.
3. "Watch list": upcoming events or open questions worth following this week.`;
  await streamClaude(res, [{ role: "user", content: prompt }]);
});

app.post("/api/chat", async (req, res) => {
  const portfolio = cleanPortfolio(req.body.portfolio);
  const history = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12);
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history.at(-1).role !== "user") return res.status(400).json({ error: "No question." });
  if (!anthropic) {
    return streamDemo(
      res,
      "**Demo mode:** the AI assistant needs an `ANTHROPIC_API_KEY` on the server to answer questions. " +
        "Add one to `.env` and restart, and I'll answer using your portfolio, the latest news, and live web search."
    );
  }
  const symbols = portfolio.map((h) => h.symbol);
  const [quotes, news] = await Promise.all([getQuotes(symbols), getNews(symbols)]);
  const context = `Context for this conversation (refreshed each turn):\n${buildContext(portfolio, quotes, news)}`;
  const messages = [{ role: "user", content: `${context}\n\n---\n\n${history[0].content}` }, ...history.slice(1)];
  await streamClaude(res, messages, { webSearch: true });
});

// ---------- trading: the AI proposes, the user confirms each order ----------
app.get("/api/broker/account", async (_req, res) => {
  try { res.json(await getAccount()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get("/api/broker/orders", async (_req, res) => {
  try { res.json(await getOrders()); } catch (e) { res.status(502).json({ error: e.message }); }
});

const IDEAS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ideas"],
  properties: {
    summary: { type: "string" },
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "side", "qty", "rationale", "risks", "confidence"],
        properties: {
          symbol: { type: "string" },
          side: { type: "string", enum: ["buy", "sell"] },
          qty: { type: "integer" },
          rationale: { type: "string" },
          risks: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
};

app.post("/api/trade/ideas", async (req, res) => {
  const portfolio = cleanPortfolio(req.body.portfolio);
  const goal = String(req.body.goal || "").slice(0, 500);
  try {
    const account = await getAccount();
    const symbols = [...new Set([...portfolio.map((h) => h.symbol), ...account.positions.map((p) => p.symbol)])].slice(0, 25);
    const [quotes, news] = await Promise.all([getQuotes(symbols), getNews(symbols)]);
    let result;
    if (!anthropic) {
      result = demoTradeIdeas(symbols, quotes, account, MAX_ORDER_USD);
    } else {
      const prompt = `${buildContext(portfolio, quotes, news)}

BROKER ACCOUNT (${account.mode}): cash $${account.cash.toFixed(2)}, buying power $${account.buyingPower.toFixed(2)}, equity $${account.equity.toFixed(2)}
POSITIONS: ${account.positions.map((p) => `${p.symbol} ${p.qty} sh @ $${p.price.toFixed(2)}`).join("; ") || "none"}
RULES: whole shares only, market orders, no short selling (sell only what is held), each order must be worth at most $${MAX_ORDER_USD}.
${goal ? `INVESTOR'S GOAL / INSTRUCTIONS: ${goal}` : ""}

Act as a careful, risk-aware portfolio analyst. Propose 0 to 4 trades that are justified by the news and the investor's positions.
Proposing no trades is a good answer when nothing is compelling; don't trade for the sake of it. Prefer small, diversified adjustments.
For each idea give a short rationale citing the specific news, the main risks, and an honest confidence level.
The investor reviews and approves each trade themselves. "summary" is a 1-2 sentence overview.`;
      const msg = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "high", format: { type: "json_schema", schema: IDEAS_SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content: prompt }],
      });
      if (msg.stop_reason === "refusal") return res.status(422).json({ error: "The assistant declined to suggest trades." });
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      result = JSON.parse(text);
    }
    // Server-side checks so a bad suggestion is flagged before it reaches the confirm button.
    result.ideas = (result.ideas || []).slice(0, 6).map((i) => {
      const symbol = String(i.symbol).toUpperCase();
      const price = quotes[symbol]?.price ?? (account.mode === "simulated" ? demoQuote(symbol).price : null);
      const held = account.positions.find((p) => p.symbol === symbol)?.qty || 0;
      const est = price ? price * i.qty : null;
      let problem = null;
      if (!price) problem = "No current price available.";
      else if (est > MAX_ORDER_USD) problem = `About $${est.toFixed(0)}, above your $${MAX_ORDER_USD} per-order limit.`;
      else if (i.side === "sell" && i.qty > held) problem = `You only hold ${held} shares in the broker account.`;
      return { ...i, symbol, price, estValue: est, problem };
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e instanceof Anthropic.APIError ? `AI error (${e.status}): ${e.message}` : e.message });
  }
});

// Executes ONE order the user has explicitly confirmed in the UI.
app.post("/api/trade/execute", async (req, res) => {
  if (req.body.confirmed !== true) return res.status(400).json({ error: "Order must be confirmed by the user." });
  try {
    const symbol = String(req.body.symbol || "").toUpperCase();
    const q = (await getQuotes([symbol]))[symbol];
    const price = q?.price ?? (brokerMode() === "simulated" ? demoQuote(symbol).price : null);
    const order = await placeOrder({ symbol, side: req.body.side, qty: req.body.qty }, price);
    console.log(`[trade] ${brokerMode()} ${order.side} ${order.qty} ${order.symbol} -> ${order.status}`);
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Portfolio Pulse running at http://localhost:${PORT}`);
  console.log(`  Market data: ${FINNHUB_KEY ? "live (Finnhub)" : "DEMO (set FINNHUB_API_KEY for live data)"}`);
  console.log(`  AI assistant: ${anthropic ? MODEL : "DEMO (set ANTHROPIC_API_KEY to enable)"}`);
  console.log(`  Trading: ${brokerMode().toUpperCase()}${brokerMode() === "live" ? " (REAL MONEY)" : ""}, max $${MAX_ORDER_USD} per order`);
});
