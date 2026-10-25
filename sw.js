/* Yukon service worker.

   What it does: keeps a saved copy of the app page, its manifest and its icons, so Yukon opens fast and also opens
   with no connection. The saved copy is refreshed in the background every time the app is opened.

   What it never does: it does not touch recordings (those live in the phone's own database, not on the network),
   audio of any kind, the AI service, the transcription service, or any request that is not for the app page itself.
   Everything it does not list below goes straight to the network exactly as if it were not installed.

   When the page on the website changes, the app itself notices (it compares build labels) and shows
   "Update available, tap to refresh". Tapping it opens the page with ?v=... in the address, which this worker
   always loads from the network and then saves as the new copy. */

const SCOPE = new URL(self.registration.scope);
const PREFIX = 'yukon:' + SCOPE.pathname + ':'; /* named by folder, so another copy of the app on the same website keeps its own saved files */
const CACHE = PREFIX + 'v1';
const PAGE = new URL('index.html', SCOPE).href;
const EXTRAS = ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.add(new Request(PAGE, { cache: 'reload' })); /* the page must be saved, or the install is dropped */
    await Promise.allSettled(EXTRAS.map(n => c.add(new Request(new URL(n, SCOPE).href, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  /* not ours: anything that is not a plain GET, any range request, any audio or video */
  if (r.method !== 'GET' || r.headers.has('range')) return;
  if (r.destination === 'audio' || r.destination === 'video' || r.destination === 'track') return;
  const u = new URL(r.url);
  /* not ours: anything on another website (the AI and transcription services) or outside the app's folder */
  if (u.origin !== SCOPE.origin || !u.pathname.startsWith(SCOPE.pathname)) return;
  const name = u.pathname.slice(SCOPE.pathname.length);
  if (r.mode === 'navigate' && (name === '' || name === 'index.html')) {
    e.respondWith(u.search ? fromNetwork(e) : fromSaved(e)); /* an address with ?v=... asks for the newest page */
    return;
  }
  if (!u.search && EXTRAS.includes(name)) e.respondWith(asset(r));
  /* every other request, including the app's own "is there a newer version" check, is left alone */
});

async function fromSaved(e) { /* opens at once from the saved copy, and refreshes it for next time */
  const c = await caches.open(CACHE);
  const saved = await c.match(PAGE);
  const fresh = refresh(c);
  e.waitUntil(fresh.catch(() => {}));
  if (saved) return saved;
  try { return await fresh; } catch (_) { return offline(); }
}

async function refresh(c) {
  const r = await fetch(PAGE, { cache: 'no-cache' });
  if (!r.ok || r.redirected) throw new Error('page not available');
  await c.put(PAGE, r.clone());
  return r;
}

async function fromNetwork(e) { /* the newest page when there is a connection, the saved copy when there is not */
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(e.request);
    if (r.ok && !r.redirected && (r.headers.get('content-type') || '').includes('text/html')) e.waitUntil(c.put(PAGE, r.clone()));
    return r;
  } catch (_) {
    return (await c.match(PAGE)) || offline();
  }
}

async function asset(r) {
  const c = await caches.open(CACHE);
  const hit = await c.match(r.url);
  if (hit) return hit;
  const n = await fetch(r);
  if (n.ok) c.put(r.url, n.clone());
  return n;
}

function offline() {
  return new Response('Yukon cannot open right now. Connect to the internet once, then open it again.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
