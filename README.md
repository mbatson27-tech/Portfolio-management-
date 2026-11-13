# Portfolio Pulse

Enter the stocks you own and get the news that matters for them, plus the overall market, with an AI assistant that summarises it all in plain English and answers your questions.

## Features
- **Portfolio**: add tickers (and optionally share counts). Saved in your browser. Shows price, today's move and value.
- **News feed**: recent stories for each holding (filterable by ticker) and general market news.
- **AI briefing**: one click writes a daily brief: market backdrop, what's happening with each holding and why it matters, and a watch list.
- **Ask the assistant**: chat about your holdings or the market. It sees your portfolio and the latest news, and can run live web searches for anything newer.
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

Without a key, that part of the app runs in demo mode. Set `CLAUDE_MODEL` to use a different Claude model (for example `claude-sonnet-5-5` for lower cost).

## How it works
- `server.js`: Express server. Keeps keys server-side, calls Finnhub (with a short cache), and streams Claude responses to the browser.
- `demo.js`: sample data used when keys are missing.
- `public/`: plain HTML/CSS/JS front end, no build step.

## Not yet included
User accounts and cloud sync, price alerts and email digests, brokerage import, charts. Information only, not financial advice.
