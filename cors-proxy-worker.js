/**
 * WeatherDash — CORS Proxy Worker
 *
 * Validates the ?url= parameter against a hostname allowlist,
 * forwards the request upstream, and injects CORS headers on the response.
 *
 * Deploy to Cloudflare Workers (Free tier: 100k req/day, no bandwidth cap).
 * Worker URL format after deploy: https://<name>.<account>.workers.dev
 *
 * Usage from the dashboard:
 *   const PROXY = 'https://<name>.<account>.workers.dev';
 *   fetch(`${PROXY}/?url=${encodeURIComponent(targetUrl)}`)
 */

// ── Allowlist ────────────────────────────────────────────────────────────────
// Only hostnames listed here will be proxied. Add new sources here as needed.
// These are the only three sources the dashboard still routes through the
// proxy — everything else it loads serves CORS headers directly.
const ALLOWLIST = new Set([
  'feeds.meteoalarm.org',             // Meteoalarm Europe country feeds
  'severeweather.wmo.int',            // WMO SWIC global alerts (WFS)
  'www.gdacs.org',                    // GDACS RSS
]);

// ── Standard CORS headers added to every response ───────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age':       '86400',
};

// ── Helper — build an error response with CORS headers ──────────────────────
function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Only GET / HEAD pass through
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return err(405, 'Only GET requests are supported');
    }

    // Parse ?url= parameter.
    const incoming = new URL(request.url);
    const raw = incoming.searchParams.get('url');
    if (!raw) return err(400, 'Missing required ?url= query parameter');

    // Validate target URL
    let target;
    try {
      target = new URL(raw);
    } catch {
      return err(400, 'Invalid URL in ?url= parameter');
    }

    // Enforce HTTPS
    if (target.protocol !== 'https:') {
      return err(400, 'Only HTTPS upstream URLs are allowed');
    }

    // Allowlist check
    if (!ALLOWLIST.has(target.hostname)) {
      return err(403, `Hostname not in allowlist: ${target.hostname}`);
    }

    // Forward request upstream
    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method:  request.method,
        headers: {
          'Accept':          request.headers.get('Accept') || 'application/json, */*',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent':      'weatherdash/1.0 (CORS proxy)',
        },
        // Cloudflare edge cache — short TTL, data changes frequently
        cf: { cacheTtl: 120, cacheEverything: false },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return err(502, `Upstream fetch failed: ${e.message}`);
    }

    // Non-2xx from upstream — forward status but still add CORS headers
    if (!upstream.ok && upstream.status !== 304) {
      return new Response(upstream.body, {
        status:  upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          ...CORS,
        },
      });
    }

    // Success — clone body and inject CORS headers
    const contentType = upstream.headers.get('Content-Type') || 'application/json';
    return new Response(upstream.body, {
      status:  upstream.status,
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'no-store',
        'X-Proxied-By':  'weatherdash',
        ...CORS,
      },
    });
  },
};
