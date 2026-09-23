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
 *   fetch(`${PROXY}/meteoalarm?countries=austria,belgium,…`)   // all feeds, one request
 */

// ── Allowlist ────────────────────────────────────────────────────────────────
// Only hostnames listed here will be proxied. Add new sources here as needed.
// These are the only sources the dashboard routes through the proxy;
// everything else it loads sends CORS headers itself.
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

// ── Meteoalarm bundle ────────────────────────────────────────────────────────
// GET /meteoalarm?countries=austria,belgium,…  →  {"austria":<feed>,"belgium":<feed>,…}
// One invocation instead of one per country. Every feed is downloaded in
// parallel (their bodies must all be read at once — reading them one after
// another stalls the rest behind the slowest), then written out in order
// without being parsed, so CPU time stays tiny although the feeds total ~15 MB.
// A feed that fails, times out or looks truncated becomes null.
// Every country is a subrequest; the free tier allows 50 per invocation.
const METEOALARM_FEED = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-';
const METEOALARM_SLUG = /^[a-z]+(?:-[a-z]+)*$/;
const METEOALARM_MAX  = 45;

// Last non-whitespace byte is "}" — a cheap guard against a cut-off body
function endsLikeJsonObject(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] > 0x20) return bytes[i] === 0x7d;
  }
  return false;
}

function meteoalarmBundle(countries) {
  const pending = countries.map(async slug => {
    try {
      const upstream = await fetch(METEOALARM_FEED + slug, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'weatherdash/1.0 (CORS proxy)' },
        signal:  AbortSignal.timeout(25_000),
      });
      if (!upstream.ok || !/json/i.test(upstream.headers.get('Content-Type') || '')) {
        upstream.body?.cancel();
        return null;
      }
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      return endsLikeJsonObject(bytes) ? bytes : null;
    } catch {
      return null;
    }
  });

  const { readable, writable } = new TransformStream();
  const encoder = new TextEncoder();

  const writer = writable.getWriter();
  (async () => {
    for (const [index, slug] of countries.entries()) {
      await writer.write(encoder.encode(`${index ? ',' : '{'}"${slug}":`));
      await writer.write((await pending[index]) || encoder.encode('null'));
    }
    await writer.write(encoder.encode('}'));
    await writer.close();
  })().catch(e => writer.abort(e).catch(() => {}));

  return new Response(readable, {
    headers: {
      'Content-Type':  'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Proxied-By':  'weatherdash',
      ...CORS,
    },
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

    const incoming = new URL(request.url);

    if (incoming.pathname === '/meteoalarm') {
      const countries = (incoming.searchParams.get('countries') || '').split(',').filter(Boolean);
      if (!countries.length || countries.length > METEOALARM_MAX || !countries.every(slug => METEOALARM_SLUG.test(slug))) {
        return err(400, `countries= must list 1–${METEOALARM_MAX} lowercase feed slugs`);
      }
      return meteoalarmBundle(countries);
    }

    // Parse ?url= parameter.
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
