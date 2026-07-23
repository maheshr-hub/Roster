/**
 * Roster service worker.
 *
 * Caches the app shell (HTML, JS, manifest, icons) so the PWA installs
 * and opens offline. Deliberately does NOT cache the Apps Script
 * endpoint, the roster payload is a fetch RosterAPI makes from inside
 * the page and manages in localStorage, not a resource this worker sees
 * as a normal navigation or asset request in most cases. Even if it did
 * pass through here, caching it would fight the etag logic in
 * roster-api.js, so network requests to script.google.com are left
 * alone and simply proxied.
 *
 * Bump CACHE whenever index.html or roster-api.js changes, or returning
 * visitors keep seeing the old shell.
 */

const CACHE = 'roster-shell-v1';

const SHELL = [
  './',
  './index.html',
  './roster-api.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Never intercept the roster data endpoint. Let the page's own fetch,
  // with its own cache-busting and etag handling, run untouched.
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return;
  }

  // Shell assets: cache-first, so the app opens instantly and offline.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
