/**
 * Cloudflare Worker — CORS Proxy for BullTherapy
 *
 * Deploy this at: https://dash.cloudflare.com → Workers → Create Worker
 * Then set a route or use the workers.dev URL.
 *
 * Usage: https://your-worker.workers.dev/?url=https://query1.finance.yahoo.com/...
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
];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing ?url= parameter', {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    // Validate target host
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: corsHeaders(origin) });
    }

    if (!ALLOWED_HOSTS.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.' + h))) {
      return new Response('Host not allowed', { status: 403, headers: corsHeaders(origin) });
    }

    // Forward the request
    try {
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      const response = await fetch(proxyReq);

      // Return response with CORS headers added
      const newHeaders = new Headers(response.headers);
      const cors = corsHeaders(origin);
      for (const [k, v] of Object.entries(cors)) {
        newHeaders.set(k, v);
      }
      // Remove headers that cause issues
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

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
