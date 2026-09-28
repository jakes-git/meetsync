// Serves calendar files at real URLs (/ics/<data>/<name>.ics) with a text/calendar content type.
// A real text/calendar response is what makes iPhone, iPad and Mac Safari open the native
// "Add to Calendar" sheet; data: and blob: downloads are just saved as files.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/\/ics\/([A-Za-z0-9_-]+)\/([^/]+\.ics)$/);
  if (!m || url.origin !== self.location.origin) return;
  let body;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    body = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return;
  }
  e.respondWith(new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${decodeURIComponent(m[2]).replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  }));
});
