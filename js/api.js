// api.js — כל קריאות ה-API + corsproxy + cache
// Price data: Yahoo Finance (free, no rate limit)
// Fundamentals: Twelve Data (free key — 800 req/day, cached 24 hours)

function getTwelveKey() { return localStorage.getItem('bon-twelve-key') || 'demo'; }

const PROXY1 = 'https://corsproxy.io/?';
const PROXY2 = 'https://api.allorigins.win/raw?url=';

// ── Price cache (15 min) ───────────────────────────────
function cacheGet(symbol) {
  try {
    const raw = localStorage.getItem(`bon-cache-${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < 15 * 60 * 1000) return data;
    return null;
  } catch { return null; }
}

function cacheSet(symbol, data) {
  try {
    localStorage.setItem(`bon-cache-${symbol}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

function cacheGetStale(symbol) {
  try {
    const raw = localStorage.getItem(`bon-cache-${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, ts };
  } catch { return null; }
}

// ── Fundamentals cache (24 hours) ─────────────────────
// Fundamentals (PE, PB, growth, debt, etc.) change slowly — cache for 24h
function fundGet(symbol) {
  try {
    const raw = localStorage.getItem(`bon-fund-${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < 24 * 60 * 60 * 1000) return data;
    return null;
  } catch { return null; }
}

function fundSet(symbol, data) {
  try {
    localStorage.setItem(`bon-fund-${symbol}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

// ── Fetch helpers ──────────────────────────────────────
function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchProxy(url) {
  try {
    const res = await fetchWithTimeout(PROXY1 + encodeURIComponent(url));
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    const res = await fetchWithTimeout(PROXY2 + encodeURIComponent(url));
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
}

// ── Yahoo Finance v8 chart ─────────────────────────────
async function yahooChart(symbol, range = '1d', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
  return fetchProxy(url);
}

// ── Yahoo Finance news + sector ────────────────────────
async function yahooNewsSearch(symbol) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=8&enableNavLinks=false`;
  return fetchProxy(url);
}

// ── Twelve Data ───────────────────────────────────────
async function tdGet(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.twelvedata.com/${endpoint}${sep}apikey=${getTwelveKey()}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(res.status);
  const json = await res.json();
  if (json.code >= 400 || json.status === 'error') throw new Error(json.message || json.code);
  return json;
}

async function tdStatistics(symbol) {
  return tdGet(`statistics?symbol=${encodeURIComponent(symbol)}`);
}

async function tdAnalystRatings(symbol) {
  return tdGet(`analyst_ratings/light?symbol=${encodeURIComponent(symbol)}`);
}

async function tdPriceTarget(symbol) {
  return tdGet(`price_target?symbol=${encodeURIComponent(symbol)}`);
}

async function tdEarnings(symbol) {
  return tdGet(`earnings?symbol=${encodeURIComponent(symbol)}`);
}

// ── Trending symbols ───────────────────────────────────
const TRENDING_DEFAULTS = ['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'];

async function fetchTrending() {
  return TRENDING_DEFAULTS;
}

// ── Crypto / TASE detection ────────────────────────────
function isCryptoSymbol(symbol) {
  return /^[A-Z0-9]+-(?:USD|USDT|USDC|BTC|ETH|EUR|GBP)$/i.test(symbol);
}

// ── Master fetch: all data for a symbol ───────────────
async function fetchAllData(symbol, lite = false) {
  // Full cache hit (price + fundamentals, 15 min)
  const cached = cacheGet(symbol);
  if (cached) return { data: cached, fromCache: true, offline: false };

  const stale = cacheGetStale(symbol);

  try {
    const isCrypto = isCryptoSymbol(symbol);
    const isTASE   = symbol.endsWith('.TA');
    const skipFund = isTASE || isCrypto;

    // 1. Yahoo chart — price data (always available, no rate limit)
    const chartRaw = await yahooChart(symbol, '1d', '1d');
    const meta = chartRaw?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) throw new Error('no_data');

    // 2. Fundamentals from Twelve Data — 24h cache, skip for TASE/Crypto/lite
    let stats = null, ratings = null, target = null, earning = null;
    if (!skipFund) {
      const cached24h = fundGet(symbol);
      if (cached24h) {
        // Use cached fundamentals
        stats   = cached24h.stats;
        ratings = cached24h.ratings;
        target  = cached24h.target;
        earning = cached24h.earning;
      } else if (!lite) {
        // Fetch fresh fundamentals (full mode only)
        stats   = await tdStatistics(symbol).catch(() => null);
        ratings = await tdAnalystRatings(symbol).catch(() => null);
        target  = await tdPriceTarget(symbol).catch(() => null);
        earning = await tdEarnings(symbol).catch(() => null);
        // Cache fundamentals for 24 hours
        fundSet(symbol, { stats, ratings, target, earning });
      } else {
        // lite mode: try stats only (for scoring), skip heavy calls
        stats = await tdStatistics(symbol).catch(() => null);
        if (stats) fundSet(symbol, { stats, ratings: null, target: null, earning: null });
      }
    }

    // 3. News (Yahoo — no rate limit)
    const newsResp = await yahooNewsSearch(symbol).catch(() => null);

    const data = parseAllData({ meta, stats, ratings, target, earning, newsResp }, symbol);
    cacheSet(symbol, data);
    return { data, fromCache: false, offline: false };

  } catch (err) {
    if (stale) {
      return { data: stale.data, fromCache: true, offline: true, cacheDate: new Date(stale.ts) };
    }
    throw err;
  }
}

// ── Analyst ratings aggregation ───────────────────────
function aggregateRatings(ratingsData) {
  if (!ratingsData?.ratings?.length) return null;

  const byFirm = new Map();
  for (const r of ratingsData.ratings) {
    if (!byFirm.has(r.firm) || r.date > byFirm.get(r.firm).date) {
      byFirm.set(r.firm, r);
    }
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = [...byFirm.values()].filter(r => r.date >= cutoff);
  if (!recent.length) return null;

  const counts = { strongBuy: 0, buy: 0, hold: 0, sell: 0 };
  const STRONG_BUY = ['strong buy', 'top pick'];
  const BUY_WORDS  = ['buy', 'outperform', 'overweight', 'accumulate', 'positive'];
  const HOLD_WORDS = ['hold', 'neutral', 'equal', 'market perform', 'sector perform', 'sector weight', 'in-line'];

  for (const r of recent) {
    const rc = (r.rating_current || '').toLowerCase();
    if (STRONG_BUY.some(w => rc.includes(w))) counts.strongBuy++;
    else if (BUY_WORDS.some(w => rc.includes(w)))   counts.buy++;
    else if (HOLD_WORDS.some(w => rc.includes(w)))  counts.hold++;
    else counts.sell++;
  }

  const total = counts.strongBuy + counts.buy + counts.hold + counts.sell;
  return total > 0 ? counts : null;
}

// ── Parse all raw data into clean object ──────────────
function parseAllData({ meta, stats, ratings, target, earning, newsResp }, symbol) {
  const st  = stats?.statistics || {};
  const val = st.valuations_metrics || {};
  const fin = st.financials || {};
  const inc = fin.income_statement || {};
  const bal = fin.balance_sheet || {};
  const sps = st.stock_price_summary || {};
  const sst = st.stock_statistics || {};
  const div = st.dividends_and_splits || {};

  const isCrypto    = isCryptoSymbol(symbol);
  const isTASE      = symbol.endsWith('.TA');
  const marketState = isCrypto ? 'REGULAR' : (meta.marketState ?? 'CLOSED');

  // Price (Yahoo chart — always reliable)
  const price     = meta.regularMarketPrice    ?? null;
  const prevClose = meta.chartPreviousClose    ?? meta.regularMarketPreviousClose ?? null;
  const change    = (price != null && prevClose) ? price - prevClose : null;
  const changePct = (change != null && prevClose) ? (change / prevClose) * 100 : null;
  const currency  = meta.currency    ?? 'USD';
  const exchange  = meta.exchangeName ?? meta.fullExchangeName ?? null;

  // Name & sector
  const name   = stats?.meta?.name ?? meta.longName ?? meta.shortName ?? symbol;
  const sector = newsResp?.quotes?.find(q => q.symbol === symbol)?.sector || null;

  // Valuation (Twelve Data)
  const marketCap = val.market_capitalization  ?? null;
  const pe        = val.trailing_pe            ?? null;
  const pb        = val.price_to_book_mrq      ?? null;
  const ps        = val.price_to_sales_ttm     ?? null;

  // Price stats (Twelve Data + Yahoo fallback)
  const beta    = sps.beta                ?? null;
  const high52w = sps.fifty_two_week_high ?? meta.fiftyTwoWeekHigh ?? null;
  const low52w  = sps.fifty_two_week_low  ?? meta.fiftyTwoWeekLow  ?? null;

  // Dividend (Twelve Data — decimal: 0.0041 = 0.41%)
  const dividend = div.forward_annual_dividend_yield != null
    ? div.forward_annual_dividend_yield * 100
    : null;

  // Growth (Twelve Data — decimal: 0.159 = 15.9%)
  const epsGrowth     = inc.quarterly_earnings_growth_yoy != null
    ? inc.quarterly_earnings_growth_yoy * 100
    : null;
  const revenueGrowth = inc.quarterly_revenue_growth != null
    ? inc.quarterly_revenue_growth * 100
    : null;

  // Debt/Equity (Twelve Data — returns as percent: 102.63 = 1.0263x)
  const debtEquity = bal.total_debt_to_equity_mrq != null
    ? bal.total_debt_to_equity_mrq / 100
    : null;

  // Institutional %
  const instPct = sst.percent_held_by_institutions ?? null;

  // Analyst recommendations
  const analystScore = aggregateRatings(ratings);

  // Price target
  const pt = target?.price_target || null;
  const targetMean = pt?.average ?? null;
  const targetHigh = pt?.high    ?? null;
  const targetLow  = pt?.low     ?? null;

  // Earnings date
  let earningsDate = null;
  const earningsArr = Array.isArray(earning?.earnings) ? earning.earnings : [];
  const nextEarning = earningsArr.find(e => e.date && new Date(e.date) > new Date());
  if (nextEarning) earningsDate = new Date(nextEarning.date);

  // News
  const rawNews   = newsResp?.news || [];
  const newsItems = rawNews.slice(0, 5).map(n => ({
    headline: n.title,
    url:      n.link,
    source:   n.publisher,
    datetime: (n.providerPublishTime || 0) * 1000,
    image:    n.thumbnail?.resolutions?.[0]?.url || null,
  }));

  return {
    symbol, name, sector, exchange, currency, isTASE, isCrypto, marketState,
    price, prevClose, change, changePct,
    pe, pb, ps, marketCap, beta, dividend,
    high52w, low52w,
    analystScore, targetMean, targetHigh, targetLow,
    debtEquity, earningsDate,
    instPct, epsGrowth, revenueGrowth,
    newsItems,
  };
}

// ── Historical prices for chart ───────────────────────
async function fetchHistory(symbol, range) {
  const now = Math.floor(Date.now() / 1000);
  const configs = {
    '1W': { period1: now - 7   * 86400, interval: '15m' },
    '1M': { period1: now - 30  * 86400, interval: '1d'  },
    '3M': { period1: now - 90  * 86400, interval: '1d'  },
    '6M': { period1: now - 180 * 86400, interval: '1d'  },
    '1Y': { period1: now - 365 * 86400, interval: '1wk' },
    '3Y': { period1: now - 3 * 365 * 86400, interval: '1mo' },
    '5Y': { period1: now - 5 * 365 * 86400, interval: '1mo' },
  };
  const { period1, interval } = configs[range] || configs['1M'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${now}&interval=${interval}&includePrePost=false`;
  const raw = await fetchProxy(url);
  const result = raw?.chart?.result?.[0];
  if (!result) return [];
  const ts     = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ time: t, value: closes[i] })).filter(p => p.value != null);
}
