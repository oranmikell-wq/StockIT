/**
 * Cloudflare Worker — CORS Proxy for BullTherapy
 *
 * Special handling: requests to finance.yahoo.com/quote/{symbol}/
 * are intercepted — the Worker fetches the HTML page, extracts the
 * full quoteSummary JSON that Yahoo Finance embeds as a SvelteKit
 * data island, and returns only that JSON.  This avoids needing a
 * crumb token for the v10/quoteSummary API.
 */

const ALLOWED_ORIGINS = [
  'https://bulltherapy.com',
  'https://www.bulltherapy.com',
  'https://oranmikell-wq.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finance.yahoo.com',
  'api.twelvedata.com',
  'generativelanguage.googleapis.com',
  'production.dataviz.cnn.io',
  'api.stlouisfed.org',
  'www.aaii.com',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders(origin) });
    }

    let parsedUrl;
    try { parsedUrl = new URL(targetUrl); }
    catch { return new Response('Invalid URL', { status: 400, headers: corsHeaders(origin) }); }

    if (!ALLOWED_HOSTS.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.' + h))) {
      return new Response('Host not allowed', { status: 403, headers: corsHeaders(origin) });
    }

    // ── Special case: extract quoteSummary from Yahoo Finance HTML page ──
    if (parsedUrl.hostname === 'finance.yahoo.com' &&
        parsedUrl.pathname.startsWith('/quote/')) {
      return handleYahooQuotePage(parsedUrl.toString(), origin);
    }

    // ── Special case: crumb-based quoteSummary fetch ─────────────────────
    if ((parsedUrl.hostname === 'query1.finance.yahoo.com' || parsedUrl.hostname === 'query2.finance.yahoo.com') &&
        parsedUrl.pathname.includes('/quoteSummary/')) {
      return handleYahooFundamentals(parsedUrl, origin);
    }

    // ── Special case: parse AAII sentiment survey page into JSON ──
    if (parsedUrl.hostname === 'www.aaii.com' &&
        parsedUrl.pathname === '/sentimentsurvey') {
      return handleAAIIPage(origin);
    }

    // ── Standard proxy ───────────────────────────────────────────────────
    try {
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      }));

      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => newHeaders.set(k, v));
      newHeaders.delete('content-encoding');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, {
        status: 502,
        headers: corsHeaders(origin),
      });
    }
  },
};

// ── Yahoo Finance crumb+cookie auth helper ───────────────────────────────────
// Returns { cookieStr, crumb } or null.
// Strategy: bootstrap cookies from the v8 chart endpoint (no consent needed),
// then use those to obtain a valid crumb.
async function getYahooCrumb() {
  const hdr = { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };

  // Strategy A: crumb endpoint without cookies (works from non-GDPR IPs)
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', { headers: hdr });
    if (r.ok) {
      const j  = await r.json().catch(() => null);
      const cr = j?.csrfToken ?? j?.crumb ?? null;
      if (cr) {
        const rc = r.headers.getSetCookie?.() ?? [];
        return { cookieStr: rc.map(c => c.split(';')[0]).join('; '), crumb: cr };
      }
    }
  } catch {}

  // Strategy B: use v8 chart endpoint (no consent wall) to harvest cookies,
  // then exchange them for a crumb via the csrfToken endpoint.
  try {
    const chartRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d&includePrePost=false',
      { headers: hdr }
    );
    const rc = chartRes.headers.getSetCookie?.() ?? [];
    const cookieStr = rc.map(c => c.split(';')[0]).join('; ');

    if (cookieStr) {
      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/csrfToken', {
        headers: { ...hdr, 'Cookie': cookieStr },
      });
      if (crumbRes.ok) {
        const j  = await crumbRes.json().catch(() => null);
        const cr = j?.csrfToken ?? j?.crumb ?? null;
        if (cr) return { cookieStr, crumb: cr };
      }
    }
  } catch {}

  return null;
}

// Fetch Yahoo Finance fundamentals using cookie+crumb authentication.
async function handleYahooFundamentals(parsedUrl, origin) {
  const hdrs = { ...corsHeaders(origin), 'Content-Type': 'application/json' };
  const err  = (msg) =>
    new Response(JSON.stringify({ quoteSummary: { result: null, error: { code: 'WorkerError', description: msg } } }),
                 { status: 502, headers: hdrs });
  try {
    const auth = await getYahooCrumb();
    const sep  = parsedUrl.search ? '&' : '?';
    const url  = auth?.crumb
      ? `${parsedUrl.toString()}${sep}crumb=${encodeURIComponent(auth.crumb)}`
      : parsedUrl.toString();

    const fundRes = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(auth?.cookieStr ? { 'Cookie': auth.cookieStr } : {}),
      },
    });

    if (!fundRes.ok) return err(`HTTP ${fundRes.status}`);
    const json = await fundRes.json();
    return new Response(JSON.stringify(json), { status: 200, headers: hdrs });

  } catch (e) {
    return err(e.message);
  }
}

// Yahoo Finance embeds the full quoteSummary response in a
// <script type="application/json" data-sveltekit-fetched> tag.
// We try multiple extraction strategies to handle different page layouts.
// Returns true if the HTML is a GDPR consent / privacy preference page (no stock data)
function isConsentPage(html) {
  return !html.includes('quoteSummary') && !html.includes('data-sveltekit-fetched') &&
    (html.includes('guce') || html.includes('consent') || html.includes('privacy') ||
     html.includes('\u05E4\u05E8\u05D8\u05D9\u05D5\u05EA')); // "פרטיות" (privacy in Hebrew)
}

async function handleYahooQuotePage(url, origin) {
  const hdrs = { ...corsHeaders(origin), 'Content-Type': 'application/json' };
  const err  = (msg, status = 502) =>
    new Response(JSON.stringify({ quoteSummary: { result: null, error: { code: 'WorkerError', description: msg } } }),
                 { status, headers: hdrs });

  const fetchPage = async (pageUrl, extraCookies = '') => {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Cache-Control': 'no-cache',
        ...(extraCookies ? { 'Cookie': extraCookies } : {}),
      },
    });
    return res;
  };

  try {
    // First attempt
    let res = await fetchPage(url);
    if (!res.ok) return err(`HTTP ${res.status}`, res.status);
    let html = await res.text();

    // If consent page, retry with guccounter bypass + auth cookies
    if (isConsentPage(html)) {
      const auth = await getYahooCrumb();
      const sep  = url.includes('?') ? '&' : '?';
      const bypassUrl = `${url}${sep}guccounter=1`;
      res  = await fetchPage(bypassUrl, auth?.cookieStr ?? '');
      if (res.ok) html = await res.text();
    }

    // Strategy 1: SvelteKit island filtered by quoteSummary in data-url (fast path)
    const m1 = html.match(/<script\s+type="application\/json"\s+data-sveltekit-fetched[^>]*data-url="[^"]*quoteSummary[^"]*"[^>]*>([\s\S]*?)<\/script>/);
    if (m1) {
      try {
        const outer = JSON.parse(m1[1]);
        const inner = JSON.parse(outer.body);
        if (inner?.quoteSummary?.result?.[0]) {
          return new Response(JSON.stringify(inner), { status: 200, headers: hdrs });
        }
      } catch {}
    }

    // Strategy 2: any SvelteKit data island that contains quoteSummary in its body
    for (const m of html.matchAll(/<script\s+type="application\/json"\s+data-sveltekit-fetched[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const outer = JSON.parse(m[1]);
        const inner = typeof outer.body === 'string' ? JSON.parse(outer.body) : outer;
        if (inner?.quoteSummary?.result?.[0]) {
          return new Response(JSON.stringify(inner), { status: 200, headers: hdrs });
        }
      } catch {}
    }

    // Strategy 3: __NEXT_DATA__ (older Yahoo Finance page structure)
    const nextM = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextM) {
      try {
        const nd = JSON.parse(nextM[1]);
        // Walk all values looking for a quoteSummary object
        const found = findDeep(nd, 'quoteSummary');
        if (found?.result?.[0]) {
          return new Response(JSON.stringify({ quoteSummary: found }), { status: 200, headers: hdrs });
        }
      } catch {}
    }

    return err('quoteSummary island not found in page');

  } catch (e) {
    return err(e.message);
  }
}

// Recursively search an object for a key with a non-null value
function findDeep(obj, key, depth = 0) {
  if (depth > 8 || obj === null || typeof obj !== 'object') return null;
  if (key in obj && obj[key] !== null) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findDeep(v, key, depth + 1);
    if (r !== null) return r;
  }
  return null;
}

// ── AAII Sentiment Survey scraper ───────────────────────────────────────────
async function handleAAIIPage(origin) {
  const hdrs = { ...corsHeaders(origin), 'Content-Type': 'application/json' };
  const err  = (msg) => new Response(JSON.stringify({ error: msg }), { status: 502, headers: hdrs });
  try {
    const res = await fetch('https://www.aaii.com/sentimentsurvey', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return err(`HTTP ${res.status}`);
    const html = await res.text();
    const data = parseAAII(html);
    return new Response(JSON.stringify(data), { status: 200, headers: hdrs });
  } catch (e) {
    return err(e.message);
  }
}

function parseAAII(html) {
  const result = { weekly: [], averages: null, highs: {} };
  const sections = html.split('<div class="datebars">').slice(1);

  for (const sec of sections) {
    const dateM = sec.match(/<div class="date">\s*([\s\S]*?)\s*<\/div>/);
    if (!dateM) continue;
    const label = dateM[1].trim().replace(/\s+/g, ' ').replace(/:$/, '');

    const bullM = sec.match(/class="bar bullish"[^>]*>\s*([\d.]+)%/);
    const neuM  = sec.match(/class="bar neutral"[^>]*>\s*([\d.]+)%/);
    const bearM = sec.match(/class="bar bearish"[^>]*>\s*([\d.]+)%/);
    const endM  = sec.match(/class="ending">Week Ending ([^<]+)<\/div>/);

    const bull = bullM ? +bullM[1] : null;
    const neu  = neuM  ? +neuM[1]  : null;
    const bear = bearM ? +bearM[1] : null;
    const date = endM  ? endM[1].trim() : '';

    if (label === 'Historical Averages') {
      result.averages = { bull, neu, bear };
    } else if (label.includes('1-Year Bullish High')) {
      result.highs.bull = { val: bull, date };
    } else if (label.includes('1-Year Neutral High')) {
      result.highs.neu  = { val: neu,  date };
    } else if (label.includes('1-Year Bearish High')) {
      result.highs.bear = { val: bear, date };
    } else if (/\d+\/\d+\/\d+/.test(label) && bull !== null) {
      result.weekly.push({ date: label, bull, neu, bear });
    }
  }
  return result;
}

function corsHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.includes(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
