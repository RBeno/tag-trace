/**
 * Actualización de la aplicación sin interrumpir (NFR-011, NFR-016, `UX_SPEC.md` §9).
 *
 * Cada publicación trae su service worker (`public/sw.js`, sellado al compilar), que el navegador
 * instala **en espera**. Aquí se avisa sin interrumpir, se dice qué versión se abrirá y qué pasa con
 * lo guardado, y se activa solo cuando la persona lo pide y no hay nada en curso: ni en esta pestaña
 * —importación, análisis, exportación o consolidación, todo lo que pasa por `setBusy`— ni en otra
 * pestaña de la aplicación, a la que se pregunta antes.
 *
 * Una versión que cambia el formato del almacén lo convierte al abrirse y ya no se puede volver a la
 * anterior con esos datos; por eso entonces se pide antes exportar una copia.
 */

/** Lo que dice de sí mismo un service worker (`message` `version`). */
export interface WorkerVersion {
  readonly version: string;
  readonly storeVersion: number;
}

export interface UpdateText {
  readonly title: string;
  readonly compatibility: string;
  /** Por qué no se puede actualizar ahora; `null` si se puede. */
  readonly blocked: string | null;
}

/** Compara dos versiones `a.b.c`; positivo si `a` es posterior. Lo que no sea `a.b.c` vale 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string): number[] => (/^\d+\.\d+\.\d+$/.test(version) ? version.split(".").map(Number) : [0, 0, 0]);
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * El aviso de una versión en espera, en palabras. Puro: se prueba sin navegador. Si la publicada es
 * anterior a la abierta —un retorno—, se dice así y no «nueva».
 */
export function updateText(input: {
  readonly current: WorkerVersion;
  readonly next: WorkerVersion;
  readonly busy: boolean;
  readonly otherTabBusy: boolean;
}): UpdateText {
  const { current, next } = input;
  const compatibility =
    next.storeVersion === current.storeVersion
      ? "Lo guardado en este dispositivo se abre igual."
      : next.storeVersion > current.storeVersion
        ? `Al abrirse convertirá lo guardado en este dispositivo del formato ${current.storeVersion} al ${next.storeVersion}, y esta versión ya no podrá leerlo. Antes de actualizar, exporta una copia de cada circuito (.agvproj).`
        : `Usa un formato anterior (${next.storeVersion}) al de lo guardado en este dispositivo (${current.storeVersion}) y no podrá abrirlo. Antes de cambiar, exporta una copia de cada circuito (.agvproj).`;
  const blocked = input.busy
    ? "Se podrá actualizar cuando termine la operación en curso."
    : input.otherTabBusy
      ? "Otra pestaña de TAG TRACE está trabajando; actualiza cuando termine."
      : null;
  const title =
    compareVersions(next.version, current.version) < 0
      ? `Se ha vuelto a publicar una versión anterior: ${next.version} (abierta: ${current.version}).`
      : `Hay una versión nueva: ${next.version} (abierta: ${current.version}).`;
  return { title, compatibility, blocked };
}

/** Pregunta su versión a un service worker. */
function askVersion(worker: ServiceWorker): Promise<WorkerVersion | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3_000);
    channel.port1.onmessage = (event: MessageEvent<WorkerVersion>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type: "version" }, [channel.port2]);
  });
}

/** El canal entre pestañas de la aplicación: «¿alguna está trabajando?». */
const CHANNEL = "tag-trace-trabajo";

export interface UpdateControls {
  /** El aviso; vacío y oculto mientras no hay versión en espera. */
  readonly node: HTMLElement;
  /** Avisa de que esta pestaña empieza o termina un trabajo. */
  setBusy(busy: boolean): void;
}

/**
 * Registra el service worker y gestiona el aviso. `currentVersion` es la versión compilada en esta
 * página (la del `CHANGELOG.md`); `storeVersion`, la del almacén que abre.
 */
export function startUpdates(input: { readonly currentVersion: string; readonly storeVersion: number }): UpdateControls {
  const node = document.createElement("section");
  node.className = "panel update-notice";
  node.setAttribute("role", "status");
  node.hidden = true;
  let busy = false;
  let waiting: { worker: ServiceWorker; version: WorkerVersion } | null = null;
  let otherTabBusy = false;
  let activating = false;
  const current: WorkerVersion = { version: input.currentVersion, storeVersion: input.storeVersion };

  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  channel?.addEventListener("message", (event: MessageEvent<{ type: string }>) => {
    if (event.data?.type === "pregunta" && busy) channel.postMessage({ type: "ocupada" });
  });

  /** ¿Trabaja alguna otra pestaña? Se pregunta y se espera un momento a que conteste. */
  const askOtherTabs = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (channel === null) {
        resolve(false);
        return;
      }
      let answered = false;
      const listener = (event: MessageEvent<{ type: string }>): void => {
        if (event.data?.type === "ocupada") answered = true;
      };
      channel.addEventListener("message", listener);
      channel.postMessage({ type: "pregunta" });
      setTimeout(() => {
        channel.removeEventListener("message", listener);
        resolve(answered);
      }, 300);
    });

  const render = (): void => {
    node.replaceChildren();
    if (waiting === null) {
      node.hidden = true;
      return;
    }
    const text = updateText({ current, next: waiting.version, busy, otherTabBusy });
    const heading = document.createElement("h2");
    heading.textContent = text.title;
    const compatibility = document.createElement("p");
    compatibility.textContent = text.compatibility;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Cambiar a ${waiting.version.version}`;
    button.disabled = text.blocked !== null || activating;
    button.addEventListener("click", () => void activate());
    node.append(heading, compatibility, button);
    if (text.blocked !== null) {
      const note = document.createElement("p");
      note.className = "muted update-blocked";
      note.textContent = text.blocked;
      node.append(note);
    } else {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "La página se recargará con la versión nueva. Lo guardado en este dispositivo se conserva.";
      node.append(note);
    }
    node.hidden = false;
  };

  const activate = async (): Promise<void> => {
    if (waiting === null || busy) return;
    otherTabBusy = await askOtherTabs();
    if (otherTabBusy || busy) {
      render();
      return;
    }
    activating = true;
    render();
    waiting.worker.postMessage({ type: "activate" });
  };

  const offer = async (worker: ServiceWorker): Promise<void> => {
    const version = await askVersion(worker);
    if (version === null || version.version === current.version) return;
    waiting = { worker, version };
    otherTabBusy = false;
    render();
  };

  if ("serviceWorker" in navigator) {
    // Tras activar la versión nueva —desde aquí o desde otra pestaña— el service worker que manda es
    // otro. Esta pestaña recarga solo si fue ella quien lo pidió o si no está trabajando; si está a
    // mitad de algo, termina con su versión y el aviso dice qué ha pasado.
    let hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (activating || !busy) {
        window.location.reload();
        return;
      }
      waiting = null;
      node.replaceChildren();
      const heading = document.createElement("h2");
      heading.textContent = "Se ha actualizado la aplicación desde otra pestaña.";
      const note = document.createElement("p");
      note.textContent = "Termina lo que estás haciendo y recarga la página para usar la versión nueva.";
      node.append(heading, note);
      node.hidden = false;
    });
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register("./sw.js", { scope: "./" })
        .then((registration) => {
          if (registration.waiting !== null && navigator.serviceWorker.controller !== null) void offer(registration.waiting);
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            installing?.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller !== null) void offer(installing);
            });
          });
          // Al volver a la pestaña se mira si hay versión nueva; sin red, simplemente no la hay.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
          });
        })
        .catch(() => {
          // No se informa al usuario: no ha perdido ninguna capacidad, solo la de abrir sin red.
        });
    });
  }

  return {
    node,
    setBusy(next: boolean): void {
      if (next === busy) return;
      busy = next;
      if (!busy) otherTabBusy = false;
      if (waiting !== null) render();
    },
  };
}
