// MacroCrypto.js — US Macro (FRED), Crypto Prices (CoinGecko), Upcoming Economic Events (Finnhub)
/* global AbortSignal */

// ── Proxy helpers ──────────────────────────────────────────────────────────
// allorigins works best for FRED CSV (corsproxy blocks CSV on free plan)
async function fetchProxyText(url) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  ];
  for (const proxy of proxies) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(proxy, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res.text();
    } catch { /* try next */ }
  }
  throw new Error('all proxies failed');
}

// ── FRED CSV parser ────────────────────────────────────────────────────────
function parseFredCsv(text) {
  // Format: DATE,VALUE per line, first line is header
  const lines = text.trim().split('\n');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, val] = lines[i].split(',');
    if (!date || !val || val.trim() === '.') continue;
    const v = parseFloat(val.trim());
    if (!isNaN(v)) result.push({ date: date.trim(), value: v });
  }
  return result; // ascending by date
}

// ── Date helpers ───────────────────────────────────────────────────────────
function twoYearsBack() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10).slice(0, 4) + '-01-01';
}

// Days from today to a date string YYYY-MM-DD
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

// ── Block 1: US Macro ──────────────────────────────────────────────────────
// Uses NY Fed API (EFFR) + World Bank API (CPI) — both CORS-enabled, no proxy needed
export async function loadMacroData(containerId = 'macro-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const [effrRes, cpiRes] = await Promise.all([
      fetch('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json'),
      fetch('https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&mrv=2'),
    ]);

    if (!effrRes.ok || !cpiRes.ok) throw new Error('api_error');

    const effrJson = await effrRes.json();
    const cpiJson  = await cpiRes.json();

    const fedRate = effrJson?.refRates?.[0]?.percentRate;
    const cpiEntry = cpiJson?.[1]?.find(e => e.value !== null);
    const cpiYoY  = cpiEntry?.value;
    const cpiYear = cpiEntry?.date;

    if (fedRate == null || cpiYoY == null) throw new Error('no_data');

    const fedColor = fedRate >= 4 ? 'negative' : fedRate <= 2 ? 'positive' : '';
    const cpiColor = cpiYoY >= 4  ? 'negative' : cpiYoY  <= 2 ? 'positive' : '';

    container.innerHTML = `
      <div class="macro-item">
        <div>
          <div class="macro-label">Interest Rate</div>
          <div class="macro-sublabel">Fed Funds Rate (EFFR)</div>
        </div>
        <div class="macro-value ${fedColor}">${fedRate.toFixed(2)}%</div>
      </div>
      <div class="macro-item">
        <div>
          <div class="macro-label">Inflation (CPI)</div>
          <div class="macro-sublabel">Annual ${cpiYear} — World Bank</div>
        </div>
        <div class="macro-value ${cpiColor}">${cpiYoY.toFixed(1)}%</div>
      </div>`;
  } catch {
    container.innerHTML = `<p class="macro-error">Unable to load macro data</p>`;
  }
}

// ── Block 2: Crypto Prices ─────────────────────────────────────────────────
export async function loadCryptoPrices(containerId = 'crypto-prices-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';

  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    const btc = data.bitcoin;
    const eth = data.ethereum;
    if (!btc || !eth) throw new Error('no_data');

    function cryptoRow(symbol, coinClass, name, price, change) {
      const chgClass = change >= 0 ? 'positive' : 'negative';
      const sign     = change >= 0 ? '+' : '';
      return `
        <div class="crypto-price-row">
          <span class="crypto-coin-icon ${coinClass}">${symbol}</span>
          <span class="crypto-coin-name">${name}</span>
          <span class="crypto-coin-price">$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          <span class="crypto-coin-change ${chgClass}">${sign}${change.toFixed(2)}%</span>
        </div>`;
    }

    container.innerHTML =
      cryptoRow('₿', 'btc', 'Bitcoin',  btc.usd, btc.usd_24h_change) +
      cryptoRow('Ξ', 'eth', 'Ethereum', eth.usd, eth.usd_24h_change);

  } catch {
    container.innerHTML = `<p class="macro-error">Unable to load crypto prices</p>`;
  }
}

// ── Block 3: Upcoming Economic Events (calculated schedule) ───────────────
// FOMC 2025-2026 decision dates (publicly announced by the Fed)
const FOMC_DATES = [
  '2025-03-19','2025-05-07','2025-06-18','2025-07-30',
  '2025-09-17','2025-10-29','2025-12-10',
  '2026-01-29','2026-03-19','2026-05-07','2026-06-18',
  '2026-07-30','2026-09-17','2026-10-29','2026-12-10',
];

function firstFridayOfMonth(year, month) {
  const d = new Date(year, month, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function generateEvents(todayStr) {
  const events = [];

  // FOMC rate decisions
  FOMC_DATES.forEach(date => {
    if (date >= todayStr) events.push({ date, name: 'FOMC Rate Decision 🏦', icon: '🏛' });
  });

  // CPI, PPI, NFP for the next 4 months (approximate, mid-month)
  const today = new Date(todayStr + 'T00:00:00');
  for (let i = 0; i <= 3; i++) {
    const base = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = base.getFullYear(), m = base.getMonth();

    // CPI: ~15th of the month
    const cpiDate = new Date(y, m, 15).toISOString().slice(0, 10);
    if (cpiDate >= todayStr) {
      const ref = new Date(y, m - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' });
      events.push({ date: cpiDate, name: `CPI Release (${ref})`, icon: '📊' });
    }

    // PPI: ~11th of the month
    const ppiDate = new Date(y, m, 11).toISOString().slice(0, 10);
    if (ppiDate >= todayStr) {
      events.push({ date: ppiDate, name: 'PPI Release', icon: '🏭' });
    }

    // NFP: first Friday of the month
    const nfpDate = firstFridayOfMonth(y, m);
    if (nfpDate >= todayStr) {
      events.push({ date: nfpDate, name: 'Non-Farm Payrolls', icon: '👷' });
    }
  }

  return events
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
}

export function loadUpcomingEvents(containerId = 'events-container') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const events = generateEvents(todayStr);

  if (!events.length) {
    container.innerHTML = `<p class="macro-error">No upcoming events</p>`;
    return;
  }

  const rows = events.map(e => {
    const d     = new Date(e.date + 'T00:00:00');
    const day   = d.getDate();
    const month = d.toLocaleString('en', { month: 'short' });
    const days  = daysUntil(e.date);
    const countdownText  = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    const countdownClass = days <= 3 ? 'event-countdown soon' : 'event-countdown';

    return `
      <div class="event-item">
        <div class="event-date-col">
          <div class="event-day">${day}</div>
          <div class="event-month">${month}</div>
        </div>
        <div class="event-info">
          <div class="event-name">${e.name}</div>
          <div class="${countdownClass}">${countdownText}</div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = rows;
}
