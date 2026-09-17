/**
 * Service worker: el esqueleto de la aplicación disponible sin red.
 *
 * Deliberadamente pequeño. No precarga una lista de ficheros porque los nombres del `build` llevan
 * hash y esa lista se queda obsoleta en cuanto se publica una versión; en su lugar guarda lo que la
 * propia aplicación pide, que es exactamente lo que necesita para volver a arrancar.
 *
 * Dos reglas que no son opcionales:
 *
 * 1. **Solo el propio origen.** Ni CDN ni nada externo (ADR-0014). Una petición ajena no se cachea
 *    ni se sirve: si algún día apareciera, el service worker no la haría más fácil.
 * 2. **La red manda cuando hay red.** Se sirve de la caché solo si la petición falla. Así una
 *    versión nueva se recoge al primer arranque con conexión, y no queda un `bundle` viejo
 *    hablando un protocolo que el Worker ya no entiende.
 */

const CACHE = "tag-trace-v1";

self.addEventListener("install", (event) => {
  // Sin precarga: lo que haya que guardar se guarda al pedirlo. `skipWaiting` evita que una
  // pestaña abierta se quede indefinidamente con la versión anterior.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Todo lo que no sea de este origen se deja pasar sin tocarlo: no se cachea ni se intercepta.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        // Solo se guarda lo que salió bien; una respuesta de error cacheada es una avería que
        // sobrevive a la reparación.
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached !== undefined) return cached;
        // Sin red y sin copia: para una navegación se devuelve el documento de arranque, que es lo
        // que permite abrir la aplicación estando desconectado.
        if (request.mode === "navigate") {
          const shell = await caches.match("./");
          if (shell !== undefined) return shell;
        }
        throw error;
      }
    })(),
  );
});
