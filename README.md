# Portfolio Pulse

Enter the stocks you own and get the news that matters for them, plus the overall market, with an AI assistant that summarises it all in plain English and answers your questions.

## Features
- **Portfolios**: create several named portfolios and switch between them. Add stocks by searching a company name or ticker, with shares and optional average cost. Saved in your browser.
- **Overview and charts**: total value, today's change and gain/loss; an allocation chart; portfolio value over time; and a price chart for each stock (1M to 1Y).
- **News feed**: recent stories for each holding (filterable by ticker) and general market news.
- **AI briefing**: one click writes a daily brief: market backdrop, what's happening with each holding and why it matters, and a watch list.
- **Ask the assistant**: chat about your holdings or the market. It sees your portfolio and the latest news, and can run live web searches for anything newer.
- **Trade with AI**: Claude suggests trades (with its reasoning, risks and confidence) based on your holdings and the news. **Nothing is placed until you review and confirm each order.** Runs on a simulated account, or on Alpaca paper trading with keys.
- **Demo mode**: runs with no keys at all, on clearly labelled sample data.

## Run it
Requires Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env   # add keys (optional)
npm start              # http://localhost:3000
```

## API keys
| Key | What it powers | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI briefing and chat (Claude Opus 5.5, with web search) | Pay per use. Get one at console.anthropic.com |
| `FINNHUB_API_KEY` | Live quotes, company news, market news | Free tier (60 calls/min). Sign up at finnhub.io |

| `TWELVEDATA_API_KEY` | Real daily price history for the charts | Free tier at twelvedata.com |
| `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY` | Trading through Alpaca (paper trading by default) | Free paper account at alpaca.markets |

Without a key, that part of the app runs in demo mode (trading uses a simulated $100k account). Set `CLAUDE_MODEL` to use a different Claude model (for example `claude-sonnet-5-5` for lower cost).

## Trading safety
- The AI only **suggests**. Each order needs you to click *Review order* and then *Yes, place order*; the server rejects any order not marked as confirmed.
- Paper trading (fake money) is the default. Real money needs **both** `ALPACA_PAPER=false` and `ALLOW_LIVE_TRADING=true`, and the app then shows a red "LIVE: real money" badge.
- Every order is checked server-side: whole shares, market orders only, no short selling, and a per-order cap (`MAX_ORDER_USD`, default $1,000).
- AI suggestions can be wrong. News can be stale or misread, and market orders can fill at a different price than shown. Try it on paper for a while before considering real money.

## Claude Code prompt
`PROMPT.md` holds a ready-to-paste prompt for rebuilding or extending this app with Claude Code.

## Preview build
`node preview/build.mjs` writes a single-file, no-server preview (sample data only) to `preview/dist/index.html`. It runs the real front end against a browser stand-in for the API (`preview/mock-api.js`).

## How it works
- `server.js`: Express server. Keeps keys server-side, calls Finnhub (with a short cache), and streams Claude responses to the browser.
- `broker.js`: Alpaca client, simulated account, and order safety checks.
- `demo.js`: sample data used when keys are missing.
- `public/`: plain HTML/CSS/JS front end, no build step.

## Not yet included
User accounts and cloud sync, price alerts and email digests, limit/stop orders, CSV import. Information only, not financial advice.
