# Claude Code prompt for Portfolio Pulse

Paste everything in the block below into Claude Code. Run it in an empty folder to rebuild the app from scratch, or in this repo to keep extending it (it tells Claude to read the existing code first).

```text
You are working on "Portfolio Pulse", a web app that keeps individual investors informed about the stocks they own and the market overall. If this folder already contains the app, read README.md, server.js, broker.js, demo.js and public/ first and extend what is there instead of rewriting it. If the folder is empty, build it from this spec.

GOAL
A person enters their investment portfolios. The app shows prices, charts and news for their holdings and the market, and an AI assistant (Claude) explains what is happening in plain English. The assistant can also suggest trades, but a human approves every order.

STACK (keep it simple, no build step)
- Node.js 20.12+ with Express, ES modules. One server file (server.js) that keeps all API keys server-side.
- Front end: plain HTML, CSS and JavaScript in public/. Chart.js 4 for charts, served from node_modules at /vendor/chart.umd.js.
- Data is saved in the browser (localStorage). No database or login yet.
- `npm start` runs `node --env-file-if-exists=.env server.js` on http://localhost:3000.

DEMO MODE (required)
Every external service is optional. With no keys, the app must still work end to end on sample data from demo.js (seeded, deterministic quotes, price history, news, briefing and trade ideas), clearly labelled as sample data in the UI. Never present sample data as real.

FEATURES
1. Portfolios: create, rename, delete and switch between multiple named portfolios. Each holding has ticker, company name, shares and optional average cost per share.
2. Adding stocks: a search box with type-ahead suggestions by company name or ticker (GET /api/search). Adding a ticker that already exists updates it. Rows can be edited and removed.
3. Overview: summary tiles (total value, today's change, total gain/loss vs. cost, best performer today); a holdings table (price, today %, value, gain/loss, weight); an allocation donut chart with a legend; a "portfolio value over time" line chart; and a per-stock price chart with 1M/3M/6M/1Y ranges, range high/low, the user's position, and that stock's latest headlines.
4. News: recent stories per holding (filter by ticker) and a general market tab.
5. AI briefing: one click streams a daily brief: market backdrop, what is happening with each holding and why it matters, and a watch list.
6. Ask AI: a chat grounded in the user's portfolio, prices and news, with Claude's web search tool for anything newer.
7. Trade with AI: Claude proposes 0 to 4 trades as structured JSON (symbol, side, whole-share quantity, rationale, risks, confidence). The user must click "Review order" and then "Yes, place order" for each one.

DATA SOURCES AND KEYS (all optional, read from .env; document them in .env.example and README)
- ANTHROPIC_API_KEY: Claude, for the briefing, chat and trade ideas. Use the official @anthropic-ai/sdk. Default model claude-opus-5-5, overridable with CLAUDE_MODEL. Stream responses to the browser as Server-Sent Events. Use structured outputs (output_config.format with a JSON schema) for trade ideas. Handle the "refusal" stop reason.
- FINNHUB_API_KEY: live quotes, company news, market news and ticker search (free tier, 60 calls/min, so cache responses briefly).
- TWELVEDATA_API_KEY: daily price history for charts (free tier).
- ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY: brokerage. Paper trading by default.

TRADING SAFETY RULES (do not weaken these)
- The AI only suggests. The server rejects any order that is not explicitly confirmed by the user in the UI.
- Paper trading is the default. Real money requires BOTH ALPACA_PAPER=false and ALLOW_LIVE_TRADING=true, and the UI then shows a red "LIVE: real money" badge.
- Every order is validated on the server: valid ticker, whole shares, market orders only, no short selling, enough buying power, and a per-order cap (MAX_ORDER_USD, default 1000).
- Without Alpaca keys, use an in-memory simulated $100,000 account.
- Never build fully automatic trading unless I explicitly ask for it.
- The assistant informs; it does not give personalised buy/sell advice in chat. Keep the "For information only, not financial advice" footer.

API ROUTES
GET /api/status, /api/quotes?symbols=, /api/news?symbols=, /api/history?symbol=&range=, /api/search?q=, /api/broker/account, /api/broker/orders
POST /api/brief (SSE), /api/chat (SSE), /api/trade/ideas, /api/trade/execute

DESIGN
- Clean, calm finance dashboard. Works on a phone (no sideways scrolling) and in light and dark mode, with all colours defined as CSS variables.
- Sections: Overview, News & briefing, Ask AI, Trade.
- Charts: thin 2px lines, light grid, hover tooltip with a crosshair, a fixed colour per holding that matches the allocation chart, never two y-axes on one chart. Green/red only for gains and losses, always with a + or − sign or an arrow as well.
- Plain-language labels. Explain anything a beginner might not know.
- Escape all text that comes from APIs or the AI before putting it in the page.

PREVIEW BUILD
`node preview/build.mjs` writes a single-file, no-server version to preview/dist/index.html that runs the real front end against a browser stand-in for the API (preview/mock-api.js). Keep it working whenever you add an API route.

HOW TO WORK
- Make small, focused changes and keep README.md and .env.example up to date.
- After each change, start the app in demo mode and check it in a browser: no console errors, works at phone width, works in dark mode.
- Never commit .env or API keys.
- Tell me plainly what you tested and what you could not test (for example, anything that needs a key I have not given you).

WHAT I WANT NEXT
<Describe the change you want here, for example: "Add price alerts", "Let me import holdings from a CSV file", or "Add user accounts so my portfolios sync across devices".>
```
