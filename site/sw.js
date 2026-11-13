const CACHE_NAME = "plan-maestro-9cb50e197eb7-sheets-ot-v2";
const APP_SHELL = ["./", "./index.html", "./operator.html", "./skills.html", "./prd.html", "./manifest.webmanifest", "./prd.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/prd.html");
  if (navigation) {
    // Cada navegacion se guarda bajo SU pagina y se responde desde ahi si no hay red.
    // Antes todo se guardaba como "./index.html", asi que abrir /prd.html sin senal
    // entregaba la pagina de planeacion (o fallaba por falta de datos): la camara
    // nunca arrancaba y el operador creia que la pagina estaba rota.
    const destino = url.pathname.endsWith("/prd.html") ? "./prd.html" : "./index.html";
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(destino, response.clone()));
      return response;
    }).catch(() => caches.match(destino).then((cached) => cached || caches.match("./"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
