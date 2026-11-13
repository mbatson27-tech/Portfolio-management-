// Portfolio Pulse: a small Express server that keeps API keys server-side,
// fetches prices and news for a user's holdings, and streams an AI briefing.
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { demoQuote, demoCompanyNews, demoMarketNews, demoBrief } from "./demo.js";

const PORT = process.env.PORT || 3000;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

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
  res.json({ liveData: Boolean(FINNHUB_KEY), ai: Boolean(anthropic), model: MODEL })
);

app.get("/api/quotes", async (req, res) => res.json(await getQuotes(parseSymbols(req.query.symbols))));

app.get("/api/news", async (req, res) => res.json(await getNews(parseSymbols(req.query.symbols))));

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

app.listen(PORT, () => {
  console.log(`Portfolio Pulse running at http://localhost:${PORT}`);
  console.log(`  Market data: ${FINNHUB_KEY ? "live (Finnhub)" : "DEMO (set FINNHUB_API_KEY for live data)"}`);
  console.log(`  AI assistant: ${anthropic ? MODEL : "DEMO (set ANTHROPIC_API_KEY to enable)"}`);
});
