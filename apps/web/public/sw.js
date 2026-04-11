/**
 * Studioflow Service Worker
 *
 * Caching strategy:
 *  - Hashed static assets (/assets/*):  cache-first  (immutable, safe to cache forever)
 *  - Google Fonts CSS:                  stale-while-revalidate
 *  - Font files (gstatic.com):          cache-first  (immutable once fetched)
 *  - API requests (/api/*):             network-first, fall back to cached copy
 *  - HTML navigation (SPA shell):       network-first, fall back to cached /, then /offline.html
 *  - Everything else (same-origin):     stale-while-revalidate
 *
 * Cache names are versioned. Bump CACHE_VER to force all clients to update.
 */

const CACHE_VER = 'v2';
const STATIC  = `sf-static-${CACHE_VER}`;   // immutable assets + fonts
const DYNAMIC = `sf-dynamic-${CACHE_VER}`;  // SPA shell + misc same-origin
const API     = `sf-api-${CACHE_VER}`;      // API responses (short-lived)

/** Files to pre-cache on install so the offline page is available immediately. */
const PRECACHE = ['/', '/offline.html'];

// ─── Install ────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(DYNAMIC)
      .then(cache => cache.addAll(PRECACHE))
      // Take over immediately — don't wait for old SW to die.
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  const current = new Set([STATIC, DYNAMIC, API]);

  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            // Only touch caches that belong to this app (prefix guard).
            .filter(k => k.startsWith('sf-') && !current.has(k))
            .map(k => {
              console.log('[SW] deleting old cache:', k);
              return caches.delete(k);
            })
        )
      )
      // Claim all open clients so the new SW applies immediately.
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET — POST/PUT/DELETE go straight to the network.
  if (request.method !== 'GET') return;

  // ── Google Fonts CSS (googleapis.com) ──
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC));
    return;
  }

  // ── Google Font files (gstatic.com) ──
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  // Ignore all other cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // ── Vite-hashed static assets — cache forever ──
  // These filenames contain a content hash, so they are safe to cache indefinitely.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  // ── API requests — network-first ──
  if (url.pathname.startsWith('/api/')) {
    // Skip media streaming endpoints entirely — let the browser handle range
    // requests natively. Service worker interception breaks audio/video duration
    // detection and seeking on iOS Safari PWA (range responses aren't handled
    // correctly when proxied through a SW fetch).
    if (/\/assets\/[^/]+\/(stream|download)$/.test(url.pathname)) return;

    // Force credentials: 'include' for all API requests so that session cookies
    // are sent even for requests initiated by <img> or <audio> elements, which
    // default to credentials: 'same-origin' and lose cookies in iOS PWA mode.
    const apiRequest = new Request(request, { credentials: 'include' });
    event.respondWith(networkFirst(apiRequest, API));
    return;
  }

  // ── HTML / navigation — network-first, offline fallback ──
  if (request.mode === 'navigate') {
    event.respondWith(navigateWithFallback(request));
    return;
  }

  // ── Everything else same-origin — stale-while-revalidate ──
  event.respondWith(staleWhileRevalidate(request, DYNAMIC));
});

// ─── Strategies ─────────────────────────────────────────────────────────────

/**
 * Cache-first: return from cache instantly; fetch and cache on miss.
 * Ideal for assets with content-hash filenames or immutable CDN resources.
 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network-first: try the network; fall back to cache on failure.
 * Ideal for API calls where freshness matters but offline resilience is needed.
 * Returns a JSON error envelope when completely offline and no cache exists.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Return a structured JSON offline indicator so the app can show a message.
    return new Response(
      JSON.stringify({ offline: true, error: 'You are offline.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Stale-while-revalidate: serve from cache immediately, update cache in background.
 * Ideal for resources where slight staleness is acceptable (fonts, misc assets).
 */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);

  // Always kick off a background revalidation.
  const revalidate = fetch(request)
    .then(response => {
      if (response.ok) {
        caches.open(cacheName).then(cache => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached); // swallow network errors when we have a cache hit

  // Return cached immediately if available, otherwise await the network.
  return cached ?? revalidate;
}

/**
 * Navigation fallback chain:
 *   1. Network response (fresh page)
 *   2. Cached version of this exact URL
 *   3. Cached root `/` (the SPA shell — covers all client-side routes)
 *   4. /offline.html
 *
 * This ensures React Router's client-side routes work offline after the first visit.
 */
async function navigateWithFallback(request) {
  try {
    const response = await fetch(request);
    // Cache the shell so future navigations can fall back to it.
    if (response.ok) {
      const cache = await caches.open(DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const exactMatch = await caches.match(request);
    if (exactMatch) return exactMatch;

    // Any React Router route can be served from the cached root shell.
    const shell = await caches.match('/');
    if (shell) return shell;

    return caches.match('/offline.html');
  }
}
