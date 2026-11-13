// Brokerage layer. Uses Alpaca (paper trading by default) when keys are set,
// otherwise an in-memory simulated paper account so the feature works in demo mode.
// Every order goes through placeOrder(), which enforces the safety limits below.
import { demoQuote } from "./demo.js";

const KEY = process.env.ALPACA_API_KEY_ID || "";
const SECRET = process.env.ALPACA_API_SECRET_KEY || "";
// Real money needs BOTH ALPACA_PAPER=false and ALLOW_LIVE_TRADING=true.
const LIVE = process.env.ALPACA_PAPER === "false" && process.env.ALLOW_LIVE_TRADING === "true";
const BASE = LIVE ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
export const MAX_ORDER_USD = Number(process.env.MAX_ORDER_USD) || 1000;

export const brokerMode = () => (!KEY || !SECRET ? "simulated" : LIVE ? "live" : "paper");

async function alpaca(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "APCA-API-KEY-ID": KEY,
      "APCA-API-SECRET-KEY": SECRET,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Alpaca ${res.status}`);
  return body;
}

// ---------- simulated paper account (demo mode) ----------
const sim = { cash: 100_000, positions: new Map(), orders: [] };
function simAccount() {
  const positions = [...sim.positions].map(([symbol, qty]) => {
    const price = demoQuote(symbol).price;
    return { symbol, qty, price, marketValue: qty * price };
  });
  const equity = sim.cash + positions.reduce((a, p) => a + p.marketValue, 0);
  return { cash: sim.cash, equity, buyingPower: sim.cash, positions };
}

// ---------- public API ----------
export async function getAccount() {
  const mode = brokerMode();
  if (mode === "simulated") return { mode, ...simAccount() };
  const [acct, pos] = await Promise.all([alpaca("/v2/account"), alpaca("/v2/positions")]);
  return {
    mode,
    cash: Number(acct.cash),
    equity: Number(acct.equity),
    buyingPower: Number(acct.buying_power),
    positions: pos.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      price: Number(p.current_price),
      marketValue: Number(p.market_value),
    })),
  };
}

export async function getOrders() {
  if (brokerMode() === "simulated") return sim.orders.slice(-20).reverse();
  const orders = await alpaca("/v2/orders?status=all&limit=20&direction=desc");
  return orders.map((o) => ({
    id: o.id,
    symbol: o.symbol,
    side: o.side,
    qty: Number(o.qty),
    status: o.status,
    filledPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
    submittedAt: o.submitted_at,
  }));
}

// Validates and places a market order. `estPrice` is the latest quote, used for the size limit.
export async function placeOrder({ symbol, side, qty }, estPrice) {
  symbol = String(symbol || "").toUpperCase();
  qty = Number(qty);
  if (!/^[A-Z.]{1,10}$/.test(symbol)) throw new Error("Invalid ticker.");
  if (side !== "buy" && side !== "sell") throw new Error("Side must be buy or sell.");
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a whole number of shares.");
  if (!estPrice) throw new Error(`No current price for ${symbol}, so the order was not placed.`);
  const value = qty * estPrice;
  if (value > MAX_ORDER_USD) {
    throw new Error(`Order is about $${value.toFixed(0)}, above the $${MAX_ORDER_USD} per-order limit (MAX_ORDER_USD).`);
  }
  const acct = await getAccount();
  if (side === "sell") {
    const held = acct.positions.find((p) => p.symbol === symbol)?.qty || 0;
    if (qty > held) throw new Error(`You hold ${held} ${symbol}; selling more than that (short selling) is not allowed.`);
  } else if (value > acct.buyingPower) {
    throw new Error("Not enough buying power.");
  }

  if (brokerMode() === "simulated") {
    const delta = side === "buy" ? qty : -qty;
    sim.cash -= delta * estPrice;
    const next = (sim.positions.get(symbol) || 0) + delta;
    next ? sim.positions.set(symbol, next) : sim.positions.delete(symbol);
    const order = {
      id: `sim-${Date.now()}`,
      symbol, side, qty,
      status: "filled",
      filledPrice: estPrice,
      submittedAt: new Date().toISOString(),
    };
    sim.orders.push(order);
    return order;
  }
  const o = await alpaca("/v2/orders", {
    method: "POST",
    body: JSON.stringify({ symbol, qty: String(qty), side, type: "market", time_in_force: "day" }),
  });
  return { id: o.id, symbol, side, qty, status: o.status, filledPrice: null, submittedAt: o.submitted_at };
}
