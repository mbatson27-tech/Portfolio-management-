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
