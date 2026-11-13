// Browser-only stand-in for server.js, used by the hosted preview build.
// It answers the same /api/* routes with demo data so the real front end runs unchanged.
// (demo.js is inlined above this file by preview/build.mjs.)
const MAX_ORDER_USD = 1000;
const sim = { cash: 100_000, positions: new Map(), orders: [] };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function sse(text) {
  const enc = new TextEncoder();
  const chunks = text.match(/[\s\S]{1,40}/g) || [];
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text: c })}\n\n`));
          await new Promise((r) => setTimeout(r, 15));
        }
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        ctrl.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

const symbolsOf = (url) =>
  [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))];
const quotesFor = (syms) => Object.fromEntries(syms.map((s) => [s, demoQuote(s)]));
const newsFor = (syms) => ({ holdings: syms.flatMap((s) => demoCompanyNews(s)), market: demoMarketNews() });

function account() {
  const positions = [...sim.positions].map(([symbol, qty]) => {
    const price = demoQuote(symbol).price;
    return { symbol, qty, price, marketValue: qty * price };
  });
  const equity = sim.cash + positions.reduce((a, p) => a + p.marketValue, 0);
  return { mode: "simulated", cash: sim.cash, equity, buyingPower: sim.cash, positions };
}

function execute({ symbol, side, qty, confirmed }) {
  if (confirmed !== true) return json({ error: "Order must be confirmed by the user." }, 400);
  symbol = String(symbol || "").toUpperCase();
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty <= 0) return json({ error: "Quantity must be a whole number of shares." }, 400);
  const price = demoQuote(symbol).price;
  if (qty * price > MAX_ORDER_USD)
    return json({ error: `Order is about $${(qty * price).toFixed(0)}, above the $${MAX_ORDER_USD} per-order limit.` }, 400);
  const held = sim.positions.get(symbol) || 0;
  if (side === "sell" && qty > held)
    return json({ error: `You hold ${held} ${symbol}; selling more than that (short selling) is not allowed.` }, 400);
  const delta = side === "buy" ? qty : -qty;
  sim.cash -= delta * price;
  const next = held + delta;
  next ? sim.positions.set(symbol, next) : sim.positions.delete(symbol);
  const order = { id: `sim-${Date.now()}`, symbol, side, qty, status: "filled", filledPrice: price, submittedAt: new Date().toISOString() };
  sim.orders.push(order);
  return json(order);
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const body = init.body ? JSON.parse(init.body) : {};
  const portfolio = Array.isArray(body.portfolio) ? body.portfolio : [];
  switch (url.pathname) {
    case "/api/status":
      return json({ liveData: false, ai: false, model: "claude-opus-5-5", broker: "simulated", maxOrderUsd: MAX_ORDER_USD });
    case "/api/quotes":
      return json(quotesFor(symbolsOf(url)));
    case "/api/news":
      return json(newsFor(symbolsOf(url)));
    case "/api/history": {
      const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
      const range = url.searchParams.get("range") || "3M";
      return json({ symbol, range, demo: true, points: demoHistory(symbol, range) });
    }
    case "/api/search":
      return json(demoSearch(url.searchParams.get("q")));
    case "/api/brief": {
      if (!portfolio.length) return json({ error: "Add at least one holding." }, 400);
      const syms = portfolio.map((h) => h.symbol);
      return sse(demoBrief(portfolio, quotesFor(syms), newsFor(syms)));
    }
    case "/api/chat":
      return sse(
        "**Preview mode:** in this preview the assistant can't answer yet. " +
          "When the app runs with an Anthropic API key, it answers using your portfolio, the latest news and live web search."
      );
    case "/api/broker/account":
      return json(account());
    case "/api/broker/orders":
      return json(sim.orders.slice(-20).reverse());
    case "/api/trade/ideas": {
      const acct = account();
      const syms = [...new Set([...portfolio.map((h) => h.symbol), ...acct.positions.map((p) => p.symbol)])];
      const quotes = quotesFor(syms);
      const result = demoTradeIdeas(syms, quotes, acct, MAX_ORDER_USD);
      result.ideas = result.ideas.map((i) => {
        const price = quotes[i.symbol].price;
        const est = price * i.qty;
        const held = sim.positions.get(i.symbol) || 0;
        const problem = est > MAX_ORDER_USD ? `About $${est.toFixed(0)}, above your $${MAX_ORDER_USD} per-order limit.`
          : i.side === "sell" && i.qty > held ? `You only hold ${held} shares in the broker account.` : null;
        return { ...i, price, estValue: est, problem };
      });
      return json(result);
    }
    case "/api/trade/execute":
      return execute(body);
    default:
      return json({ error: "Not found" }, 404);
  }
};

// Start first-time visitors with example portfolios so the preview isn't empty.
try {
  if (!localStorage.getItem("portfolio-pulse:v2")) {
    const ex = (symbol, name, shares, f) => ({ symbol, name, shares, cost: Math.round(demoQuote(symbol).price * f * 100) / 100 });
    localStorage.setItem("portfolio-pulse:v2", JSON.stringify({
      active: "ex1",
      portfolios: [
        { id: "ex1", name: "Example: Long-term", holdings: [
          ex("VOO", "Vanguard S&P 500 ETF", 12, 0.82),
          ex("AAPL", "Apple Inc.", 10, 0.9),
          ex("MSFT", "Microsoft Corp.", 6, 1.06),
          ex("JNJ", "Johnson & Johnson", 8, 0.95),
          ex("KO", "Coca-Cola Co.", 20, 0.88),
        ] },
        { id: "ex2", name: "Example: Tech picks", holdings: [
          ex("NVDA", "NVIDIA Corp.", 5, 0.7),
          ex("AMD", "Advanced Micro Devices", 8, 1.12),
          ex("GOOGL", "Alphabet Inc. Class A", 4, 0.93),
        ] },
      ],
    }));
  }
} catch {}
