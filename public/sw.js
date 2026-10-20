// Dogwise Academy app: install support, an offline screen, and push notifications.
// Speed first: pages are never slowed down. On iPhone there's no page handling at all (Safari would wake this
// worker before every page); elsewhere the page request starts straight away (navigation preload) and the
// worker only steps in if there's no connection.
const OFFLINE = "/offline.html";
const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent);
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("dogwise-v2").then((c) => c.addAll([OFFLINE])).catch(() => {})); // never fail install over the offline page
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    for (const k of await caches.keys()) if (k !== "dogwise-v2") await caches.delete(k);
    await self.clients.claim();
  })());
});
if (!IOS) {
  self.addEventListener("fetch", (e) => {
    if (e.request.mode !== "navigate") return;
    e.respondWith((async () => {
      try { return (await e.preloadResponse) || await fetch(e.request); }
      catch { return (await caches.match(OFFLINE)) || Response.error(); }
    })());
  });
}
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Dogwise Academy", {
    body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-64.png", tag: d.tag, renotify: !!d.tag, data: { url: d.url || "/" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
