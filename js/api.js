// api.js — כל קריאות ה-API + corsproxy + cache

const FINNHUB_KEY = localStorage.getItem('bon-finnhub-key') || 'd6qup2hr01qgdhqcgpbgd6qup2hr01qgdhqcgpc0';
const FMP_KEY     = localStorage.getItem('bon-fmp-key')     || 'B2YQqp7ld6CnzJXytvs5siPiJbUImjNZ';

const PROXY1 = 'https://corsproxy.io/?';
const PROXY2 = 'https://api.allorigins.win/raw?url=';

// ── Cache ──────────────────────────────────────────────
function cacheGet(symbol) {
  try {
    const raw = localStorage.getItem(`bon-cache-${symbol}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < 15 * 60 * 1000) return data; // 15 min
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

// ── Fetch helpers ──────────────────────────────────────
async function fetchProxy(url) {
  try {
    const res = await fetch(PROXY1 + encodeURIComponent(url));
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    const res = await fetch(PROXY2 + encodeURIComponent(url));
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  }
}

async function fetchDirect(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  return await res.json();
}

// ── Yahoo Finance ──────────────────────────────────────
async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,calendarEvents,assetProfile,price`;
  return fetchProxy(url);
}

async function yahooHistory(symbol, period1, period2, interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=${interval}`;
  return fetchProxy(url);
}

// ── Finnhub ────────────────────────────────────────────
async function finnhubGet(endpoint) {
  return fetchDirect(`https://finnhub.io/api/v1/${endpoint}&token=${FINNHUB_KEY}`);
}

async function getFinnhubRecommendations(symbol) {
  return finnhubGet(`stock/recommendation?symbol=${symbol}`);
}

async function getFinnhubInstitutional(symbol) {
  return finnhubGet(`institutional/ownership?symbol=${symbol}&limit=10`);
}

async function getFinnhubNews(symbol) {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return finnhubGet(`company-news?symbol=${symbol}&from=${from}&to=${to}`);
}

async function getFinnhubTrending() {
  // Top active symbols
  return finnhubGet('stock/market-status?exchange=US');
}

// ── Financial Modeling Prep ────────────────────────────
async function fmpGet(endpoint) {
  return fetchDirect(`https://financialmodelingprep.com/stable/${endpoint}&apikey=${FMP_KEY}`);
}

async function getFmpEPS(symbol) {
  return fmpGet(`earnings?symbol=${symbol}&limit=8`);
}

async function getFmpRevenue(symbol) {
  return fmpGet(`income-statement?symbol=${symbol}&limit=4&period=annual`);
}

async function getFmpBalanceSheet(symbol) {
  return fmpGet(`balance-sheet-statement?symbol=${symbol}&limit=2&period=annual`);
}

// ── Master fetch: all data for a symbol ───────────────
async function fetchAllData(symbol) {
  // Check cache first
  const cached = cacheGet(symbol);
  if (cached) return { data: cached, fromCache: false };

  let offline = false;
  const stale = cacheGetStale(symbol);

  try {
    const [yahooRaw, recommendations, institutional, news, epsRaw, revenueRaw, balanceRaw] =
      await Promise.allSettled([
        yahooQuote(symbol),
        getFinnhubRecommendations(symbol),
        getFinnhubInstitutional(symbol),
        getFinnhubNews(symbol),
        getFmpEPS(symbol),
        getFmpRevenue(symbol),
        getFmpBalanceSheet(symbol),
      ]);

    const yahoo = yahooRaw.status === 'fulfilled' ? yahooRaw.value : null;
    const result = yahooRaw.value?.quoteSummary?.result?.[0];

    if (!result && !yahoo) throw new Error('no_data');

    const data = parseAllData({
      result,
      recommendations: recommendations.status === 'fulfilled' ? recommendations.value : [],
      institutional:   institutional.status   === 'fulfilled' ? institutional.value   : null,
      news:            news.status            === 'fulfilled' ? news.value            : [],
      eps:             epsRaw.status          === 'fulfilled' ? epsRaw.value          : [],
      revenue:         revenueRaw.status      === 'fulfilled' ? revenueRaw.value      : [],
      balance:         balanceRaw.status      === 'fulfilled' ? balanceRaw.value      : [],
    }, symbol);

    cacheSet(symbol, data);
    return { data, fromCache: false, offline: false };

  } catch (err) {
    if (stale) {
      return { data: stale.data, fromCache: true, offline: true, cacheDate: new Date(stale.ts) };
    }
    throw err;
  }
}

// ── Parse all raw data into clean object ──────────────
function parseAllData({ result, recommendations, institutional, news, eps, revenue, balance }, symbol) {
  const sd  = result?.summaryDetail     || {};
  const ks  = result?.defaultKeyStatistics || {};
  const fd  = result?.financialData     || {};
  const pr  = result?.price             || {};
  const ap  = result?.assetProfile      || {};
  const cal = result?.calendarEvents    || {};

  // Price
  const price       = pr.regularMarketPrice?.raw ?? sd.regularMarketPrice?.raw ?? null;
  const prevClose   = pr.regularMarketPreviousClose?.raw ?? null;
  const change      = price && prevClose ? price - prevClose : null;
  const changePct   = change && prevClose ? (change / prevClose) * 100 : null;
  const currency    = pr.currency || 'USD';
  const isTASE      = symbol.endsWith('.TA');
  const marketState = pr.marketState || 'CLOSED';

  // Basic info
  const name        = pr.longName || pr.shortName || symbol;
  const sector      = ap.sector || null;
  const industry    = ap.industry || null;
  const exchange    = pr.exchangeName || null;

  // Valuation
  const pe          = sd.trailingPE?.raw    ?? ks.trailingPE?.raw    ?? null;
  const pb          = ks.priceToBook?.raw   ?? null;
  const ps          = ks.priceToSalesTrailing12Months?.raw ?? null;
  const marketCap   = pr.marketCap?.raw     ?? sd.marketCap?.raw     ?? null;
  const beta        = sd.beta?.raw          ?? null;
  const dividend    = sd.dividendYield?.raw ?? null;

  // 52w
  const high52w     = sd.fiftyTwoWeekHigh?.raw ?? null;
  const low52w      = sd.fiftyTwoWeekLow?.raw  ?? null;

  // Analyst recommendations (Finnhub)
  const recLatest   = Array.isArray(recommendations) && recommendations.length ? recommendations[0] : null;
  const analystScore = recLatest
    ? { buy: recLatest.buy, hold: recLatest.hold, sell: recLatest.sell + recLatest.strongSell, strongBuy: recLatest.strongBuy }
    : null;

  // Price target (Yahoo)
  const targetMean  = fd.targetMeanPrice?.raw ?? null;
  const targetHigh  = fd.targetHighPrice?.raw ?? null;
  const targetLow   = fd.targetLowPrice?.raw  ?? null;

  // Debt/Equity
  const debtEquity  = fd.debtToEquity?.raw ?? null;

  // Earnings date
  const earningsTs  = cal.earnings?.earningsDate?.[0]?.raw ?? null;
  const earningsDate = earningsTs ? new Date(earningsTs * 1000) : null;

  // Institutional (Finnhub)
  const instPct     = institutional?.ownership?.[0]?.share ?? null;

  // EPS growth (FMP)
  let epsGrowth = null;
  if (Array.isArray(eps) && eps.length >= 2) {
    const recent = eps[0]?.eps ?? eps[0]?.actualEarningResult?.earningsPerShare;
    const older  = eps[4]?.eps ?? eps[4]?.actualEarningResult?.earningsPerShare;
    if (recent != null && older != null && older !== 0) {
      epsGrowth = ((recent - older) / Math.abs(older)) * 100;
    }
  }

  // Revenue growth (FMP)
  let revenueGrowth = null;
  if (Array.isArray(revenue) && revenue.length >= 2) {
    const r0 = revenue[0]?.revenue ?? null;
    const r1 = revenue[1]?.revenue ?? null;
    if (r0 != null && r1 != null && r1 !== 0) {
      revenueGrowth = ((r0 - r1) / Math.abs(r1)) * 100;
    }
  }

  // News
  const newsItems = Array.isArray(news)
    ? news.slice(0, 5).map(n => ({
        headline: n.headline,
        url:      n.url,
        source:   n.source,
        datetime: n.datetime * 1000,
        image:    n.image || null,
      }))
    : [];

  return {
    symbol, name, sector, industry, exchange, currency, isTASE, marketState,
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
  const now    = Math.floor(Date.now() / 1000);
  const ranges = {
    '1W': { period1: now - 7  * 86400, interval: '15m' },
    '1M': { period1: now - 30 * 86400, interval: '1d'  },
    '3M': { period1: now - 90 * 86400, interval: '1d'  },
    '6M': { period1: now - 180 * 86400, interval: '1d' },
    '1Y': { period1: now - 365 * 86400, interval: '1wk' },
    '3Y': { period1: now - 3 * 365 * 86400, interval: '1mo' },
    '5Y': { period1: now - 5 * 365 * 86400, interval: '1mo' },
  };
  const { period1, interval } = ranges[range] || ranges['1M'];
  const raw = await yahooHistory(symbol, period1, now, interval);
  const chart = raw?.chart?.result?.[0];
  if (!chart) return [];
  const ts = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ time: t, value: closes[i] })).filter(p => p.value != null);
}

// ── Trending symbols (hardcoded + Finnhub news) ───────
const TRENDING_DEFAULTS = ['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'];

async function fetchTrending() {
  return TRENDING_DEFAULTS;
}

// ── Validate symbol exists ─────────────────────────────
async function validateSymbol(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;
    const data = await fetchProxy(url);
    return data?.chart?.result?.[0] != null;
  } catch { return false; }
}
