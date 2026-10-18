/**
 * Service worker: cada versión publicada, entera y disponible sin red, y el cambio de versión en
 * manos de la persona (NFR-011, NFR-016, `UX_SPEC.md` §9).
 *
 * La compilación sustituye las tres marcas de abajo (`vite.config.ts`, `serviceWorkerManifest`):
 * la versión del `CHANGELOG.md`, la versión del almacén local y la lista de ficheros de esa
 * compilación. Así cada publicación produce un `sw.js` distinto, el navegador lo descubre solo y lo
 * instala **en espera**; mientras tanto sigue sirviendo la versión con la que se abrió la página.
 *
 * Reglas que no son opcionales:
 *
 * 1. **Solo el propio origen.** Ni CDN ni nada externo (ADR-0014). Una petición ajena no se cachea
 *    ni se sirve.
 * 2. **Una versión no se activa sola.** Nada de `skipWaiting` al instalar: la página pide activarla
 *    cuando la persona lo decide y no hay ninguna importación, análisis, exportación o consolidación
 *    en curso. Antes se activaba en el acto.
 * 3. **La versión abierta se sirve de su caché.** Primero la caché de la versión activa; si falta
 *    algo, la de la anterior (una pestaña abierta antes del cambio sigue pidiendo sus ficheros, que
 *    en el servidor ya no existen); solo después, la red.
 */

const VERSION = "__TT_APP_VERSION__";
const STORE_VERSION = "__TT_STORE_VERSION__";
const PRECACHE = ["__TT_PRECACHE__"];

const PREFIX = "tag-trace-";
const CACHE = `${PREFIX}${VERSION}`;

self.addEventListener("install", (event) => {
  // Se guarda la compilación entera antes de dar la versión por instalada: si falta un fichero, la
  // instalación falla y el navegador lo reintenta más tarde, en vez de dejar una versión a medias.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Se conservan la caché de esta versión y la de la inmediatamente anterior, que puede seguir
      // sirviendo a una pestaña abierta antes del cambio; las más viejas se borran.
      const names = (await caches.keys()).filter((name) => name.startsWith(PREFIX) || name === "tag-trace-v1");
      const others = names.filter((name) => name !== CACHE);
      const keep = others.length > 0 ? others[others.length - 1] : undefined;
      await Promise.all(others.filter((name) => name !== keep).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === null || typeof data !== "object") return;
  if (data.type === "version") {
    event.ports[0]?.postMessage({ version: VERSION, storeVersion: Number(STORE_VERSION) });
  } else if (data.type === "activate") {
    // Solo por petición de la página, que ya comprobó que no hay trabajo en curso.
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Todo lo que no sea de este origen se deja pasar sin tocarlo: no se cachea ni se intercepta.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // `ignoreVary`: un servidor que responde con `Vary: Origin` —el de vista previa lo hace— haría
      // que la petición de un módulo, que lleva `Origin`, no encontrara la copia guardada sin él, y
      // la aplicación no abriría sin red una vez de cada pocas. Aquí solo se guardan ficheros
      // estáticos del propio origen, así que la cabecera no distingue nada.
      const options = { ignoreVary: true };
      // Una navegación abre siempre el documento de esta versión, venga con la ruta que venga.
      const own = request.mode === "navigate" ? await cache.match("./", options) : await cache.match(request, options);
      if (own !== undefined) return own;
      const older = await caches.match(request, options);
      if (older !== undefined) return older;
      const response = await fetch(request);
      // Lo que no estaba en la lista y salió bien se guarda con esta versión; una respuesta de
      // error cacheada es una avería que sobrevive a la reparación.
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    })(),
  );
});
