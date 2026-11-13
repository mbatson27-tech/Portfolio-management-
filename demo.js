// Demo data so the app runs end to end with no API keys.
// Everything here is clearly fake and labelled as such in the UI.

function seed(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 2 ** 32);
}

export function demoQuote(symbol) {
  const r = seed(symbol + new Date().toISOString().slice(0, 10));
  const price = 20 + r() * 480;
  const changePct = (r() - 0.45) * 5;
  const prevClose = price / (1 + changePct / 100);
  return { price, change: price - prevClose, changePct, prevClose, demo: true };
}

const TEMPLATES = [
  ["{S} beats quarterly estimates as revenue climbs", "Analysts point to stronger demand and improving margins.", "positive"],
  ["{S} announces new product line aimed at enterprise customers", "The launch expands the company's addressable market.", "positive"],
  ["Regulators open review into {S} business practices", "The inquiry is at an early stage; no penalties have been proposed.", "negative"],
  ["{S} shares slip after cautious guidance", "Management flagged slower growth in the coming quarter.", "negative"],
  ["{S} raises dividend and expands buyback", "The board approved a larger capital return programme.", "positive"],
  ["Analyst downgrades {S} to neutral on valuation", "The firm cited a stretched multiple after recent gains.", "mixed"],
];

export function demoCompanyNews(symbol) {
  const r = seed(symbol);
  const picks = [...TEMPLATES].sort(() => r() - 0.5).slice(0, 2);
  return picks.map(([h, s, tone], i) => ({
    symbol,
    headline: `[Demo] ${h.replaceAll("{S}", symbol)}`,
    summary: s,
    source: "Demo Wire",
    url: "#",
    datetime: Date.now() - (i + 1) * 5 * 3600e3 - Math.floor(r() * 3600e3),
    tone,
  }));
}

export function demoMarketNews() {
  const items = [
    ["Stocks edge higher as investors weigh inflation data", "Major indexes rose modestly; bond yields were little changed."],
    ["Central bank officials signal patience on rate moves", "Policymakers said they want more data before acting."],
    ["Oil prices dip on supply outlook", "Energy shares lagged the broader market."],
    ["Tech sector leads gains on AI spending optimism", "Chipmakers and cloud providers outperformed."],
  ];
  return items.map(([headline, summary], i) => ({
    symbol: null,
    headline: `[Demo] ${headline}`,
    summary,
    source: "Demo Markets Desk",
    url: "#",
    datetime: Date.now() - (i + 1) * 2 * 3600e3,
  }));
}

export function demoBrief(portfolio, quotes, news) {
  const lines = [
    "> **Demo briefing.** This is sample text built from demo data. Add an `ANTHROPIC_API_KEY` for a real AI briefing, and a `FINNHUB_API_KEY` for live prices and news.",
    "",
    "### Market backdrop",
    ...news.market.slice(0, 3).map((n) => `- ${n.headline.replace("[Demo] ", "")}. ${n.summary}`),
    "",
    "### Your holdings",
  ];
  for (const h of portfolio) {
    const q = quotes[h.symbol];
    const top = news.holdings.find((n) => n.symbol === h.symbol);
    const move = q ? `${q.changePct >= 0 ? "up" : "down"} ${Math.abs(q.changePct).toFixed(1)}% today` : "price unavailable";
    lines.push(
      `- **${h.symbol}** (${move}): ${top ? `${top.headline.replace("[Demo] ", "")}. ${top.summary} Reads as **${top.tone}**.` : "No notable news."}`
    );
  }
  lines.push("", "### Watch list", "- Upcoming earnings dates for your holdings", "- Next inflation report and central bank commentary");
  return lines.join("\n");
}

export function demoTradeIdeas(symbols, quotes, account, maxUsd) {
  const ideas = [];
  const held = new Map(account.positions.map((p) => [p.symbol, p.qty]));
  for (const s of symbols.slice(0, 3)) {
    const price = quotes[s]?.price || demoQuote(s).price;
    if (held.get(s) >= 2 && ideas.length === 1) {
      ideas.push({
        symbol: s, side: "sell", qty: 1,
        rationale: `[Demo] Trim ${s} slightly after recent gains to lock in some profit.`,
        risks: "You may miss further upside if the rally continues.",
        confidence: "low",
      });
    } else {
      ideas.push({
        symbol: s, side: "buy", qty: Math.max(1, Math.floor((maxUsd * 0.5) / price)),
        rationale: `[Demo] Positive recent headlines for ${s}; a small add keeps the position size modest.`,
        risks: "Headlines can reverse quickly, and a single stock carries company-specific risk.",
        confidence: "medium",
      });
    }
  }
  return {
    summary: "[Demo] Sample suggestions from demo data. Add an ANTHROPIC_API_KEY for real AI analysis.",
    ideas,
  };
}

// ---------- price history & ticker search (demo) ----------
export const RANGE_DAYS = { "1M": 22, "3M": 64, "6M": 128, "1Y": 252 };

// Business days ending today, oldest first (shared by every symbol so portfolio sums line up).
function tradingDays(n) {
  const out = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

// A seeded random walk that ends exactly at today's demo price.
export function demoHistory(symbol, range = "3M") {
  const n = RANGE_DAYS[range] || RANGE_DAYS["3M"];
  const days = tradingDays(RANGE_DAYS["1Y"]);
  const r = seed("hist" + symbol);
  const drift = (r() - 0.4) * 0.002;
  const vol = 0.008 + r() * 0.012;
  const rets = days.map(() => drift + (r() + r() + r() - 1.5) * vol);
  const end = demoQuote(symbol).price;
  const closes = new Array(days.length);
  closes[days.length - 1] = end;
  for (let i = days.length - 2; i >= 0; i--) closes[i] = closes[i + 1] / (1 + rets[i + 1]);
  return days.map((t, i) => ({ t, c: Math.round(closes[i] * 100) / 100 })).slice(-n);
}

export const POPULAR = [
  ["AAPL", "Apple Inc."], ["MSFT", "Microsoft Corp."], ["NVDA", "NVIDIA Corp."], ["AMZN", "Amazon.com Inc."],
  ["GOOGL", "Alphabet Inc. Class A"], ["META", "Meta Platforms Inc."], ["TSLA", "Tesla Inc."], ["BRK.B", "Berkshire Hathaway Class B"],
  ["JPM", "JPMorgan Chase & Co."], ["V", "Visa Inc."], ["MA", "Mastercard Inc."], ["UNH", "UnitedHealth Group"],
  ["JNJ", "Johnson & Johnson"], ["PG", "Procter & Gamble"], ["XOM", "Exxon Mobil Corp."], ["CVX", "Chevron Corp."],
  ["HD", "Home Depot Inc."], ["KO", "Coca-Cola Co."], ["PEP", "PepsiCo Inc."], ["COST", "Costco Wholesale"],
  ["WMT", "Walmart Inc."], ["DIS", "Walt Disney Co."], ["NFLX", "Netflix Inc."], ["AMD", "Advanced Micro Devices"],
  ["INTC", "Intel Corp."], ["AVGO", "Broadcom Inc."], ["CRM", "Salesforce Inc."], ["ADBE", "Adobe Inc."],
  ["ORCL", "Oracle Corp."], ["BAC", "Bank of America"], ["NKE", "Nike Inc."], ["MCD", "McDonald's Corp."],
  ["PFE", "Pfizer Inc."], ["LLY", "Eli Lilly & Co."], ["T", "AT&T Inc."], ["VZ", "Verizon Communications"],
  ["VOO", "Vanguard S&P 500 ETF"], ["SPY", "SPDR S&P 500 ETF"], ["QQQ", "Invesco QQQ Trust"], ["VTI", "Vanguard Total Stock Market ETF"],
  ["SCHD", "Schwab US Dividend Equity ETF"], ["VXUS", "Vanguard Total International Stock ETF"], ["BND", "Vanguard Total Bond Market ETF"], ["GLD", "SPDR Gold Shares"],
];

export function demoSearch(q) {
  q = String(q || "").trim().toUpperCase();
  if (!q) return [];
  const hits = POPULAR.filter(([s, n]) => s.startsWith(q) || n.toUpperCase().includes(q));
  hits.sort((a, b) => (b[0].startsWith(q) ? 1 : 0) - (a[0].startsWith(q) ? 1 : 0) || a[0].length - b[0].length);
  return hits.slice(0, 8).map(([symbol, name]) => ({ symbol, name }));
}
