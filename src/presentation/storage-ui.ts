/**
 * El almacenamiento del dispositivo (`UX_SPEC.md` §8, F6 entrega 5): cuánto ocupa la aplicación, si el
 * navegador lo guarda de forma persistente y borrar un circuito.
 *
 * Borrar es lo único destructivo de la aplicación, así que antes se enumera lo que se pierde —contado
 * en el almacén, sin leer el contenido—, se ofrece exportar la copia y se pide escribir el nombre del
 * circuito. El borrado es una sola transacción: o se va todo o no se va nada.
 *
 * El guardado persistente lo concede el navegador, no la aplicación: sin él, el navegador puede borrar
 * los datos de un sitio cuando le falta espacio. Se pide al guardar por primera vez y se dice si lo hay.
 */

import { circuitInventory, deleteCircuit, isAvailable, isStorageFull, type CircuitInventory } from "../persistence/store.js";

const MB = 1024 * 1024;

/** Cuánto se usa y si es persistente, en palabras. Puro. */
export function storageText(estimate: { readonly usage: number; readonly quota: number } | null, persisted: boolean | null): string {
  const used =
    estimate === null
      ? "Este navegador no dice cuánto espacio usa la aplicación."
      : `La aplicación usa ${(estimate.usage / MB).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB de los ${Math.round(estimate.quota / MB).toLocaleString("es-ES")} MB que este navegador le deja.`;
  const keep =
    persisted === true
      ? "Guardado persistente: el navegador no lo borrará por falta de espacio."
      : persisted === false
        ? "Guardado no persistente: si el navegador se queda sin espacio puede borrarlo; exporta la copia de cada circuito."
        : "";
  return `${used} ${keep}`.trim();
}

/** Lo que se pierde al borrar, en palabras; solo lo que hay. Puro. */
export function inventoryLines(inventory: CircuitInventory): readonly string[] {
  const of = (count: number, one: string, many: string): string | null => (count === 0 ? null : `${count.toLocaleString("es-ES")} ${count === 1 ? one : many}`);
  return [
    of(inventory.sources, "fichero de lecturas con lo acumulado", "ficheros de lecturas con lo acumulado"),
    of(inventory.archived, "original archivado", "originales archivados"),
    of(inventory.snapshots, "instantánea", "instantáneas"),
    of(inventory.memoryVersions, "versión de la memoria consolidada", "versiones de la memoria consolidada"),
    of(inventory.planEvents, "cambio del plano", "cambios del plano"),
    of(inventory.plantValues, "valor de planta confirmado", "valores de planta confirmados"),
    inventory.cases === 0 ? null : `${of(inventory.cases, "expediente de incidencia", "expedientes de incidencia")} (${of(inventory.caseRevisions, "revisión", "revisiones")})`,
    of(inventory.reviewed, "hallazgo revisado en campo", "hallazgos revisados en campo"),
  ].filter((line): line is string => line !== null);
}

export interface StoragePanel {
  readonly node: HTMLElement;
  /** Vuelve a mirar el espacio; tras una importación, pide el guardado persistente si aún no lo hay. */
  refresh(afterSaving?: boolean): void;
  setBusy(busy: boolean): void;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createStoragePanel(hooks: {
  /** El circuito escrito en el campo, recortado. */
  readonly circuitName: () => string;
  /** Marca la aplicación como ocupada (nada más arranca mientras se borra). */
  readonly lock: (busy: boolean) => void;
  readonly notify: (kind: "info" | "error", title: string, lines: readonly string[]) => void;
  readonly onDeleted: (circuitId: string) => void;
}): StoragePanel {
  const node = element("div", "storage");
  const usage = element("p", "muted storage-usage");
  const start = element("button", "danger storage-delete", "Borrar el circuito…");
  start.type = "button";
  const confirm = element("div", "storage-confirm");
  confirm.hidden = true;
  node.append(element("h3", undefined, "Espacio en este dispositivo"), usage, start, confirm);
  let busy = false;

  const refresh = (afterSaving = false): void => {
    void (async () => {
      const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
      let persisted: boolean | null = null;
      try {
        persisted = storage?.persisted === undefined ? null : await storage.persisted();
        // Se pide al guardar por primera vez: es cuando hay algo que perder.
        if (afterSaving && persisted === false && storage?.persist !== undefined) persisted = await storage.persist();
      } catch {
        persisted = null;
      }
      let estimate: { usage: number; quota: number } | null = null;
      try {
        const value = storage?.estimate === undefined ? undefined : await storage.estimate();
        if (value?.usage !== undefined && value.quota !== undefined) estimate = { usage: value.usage, quota: value.quota };
      } catch {
        estimate = null;
      }
      usage.textContent = storageText(estimate, persisted);
    })();
  };

  const close = (): void => {
    confirm.replaceChildren();
    confirm.hidden = true;
    start.disabled = busy;
  };

  start.addEventListener("click", () => {
    void (async () => {
      const circuitId = hooks.circuitName();
      if (circuitId === "") {
        hooks.notify("error", "Falta el circuito", ["Escribe el nombre del circuito que quieres borrar."]);
        return;
      }
      if (!isAvailable()) return;
      const inventory = await circuitInventory(circuitId);
      if (!inventory.exists) {
        hooks.notify("error", "No hay ese circuito", [`En este dispositivo no hay ningún circuito «${circuitId}».`]);
        return;
      }
      confirm.replaceChildren();
      const lost = element("ul", "storage-lost");
      for (const line of inventoryLines(inventory)) lost.append(element("li", undefined, line));
      const label = element("label", undefined, `Para confirmar, escribe «${circuitId}»`);
      const field = element("input");
      field.type = "text";
      field.id = "storage-confirm-name";
      label.htmlFor = field.id;
      const go = element("button", "danger", "Borrar para siempre");
      go.type = "button";
      go.disabled = true;
      const cancel = element("button", undefined, "No borrar");
      cancel.type = "button";
      field.addEventListener("input", () => {
        go.disabled = busy || field.value !== circuitId;
      });
      cancel.addEventListener("click", close);
      go.addEventListener("click", () => {
        void (async () => {
          if (field.value !== circuitId || busy) return;
          go.disabled = true;
          hooks.lock(true);
          try {
            await deleteCircuit(circuitId);
            close();
            hooks.notify("info", `Circuito «${circuitId}» borrado`, ["Se ha borrado entero de este dispositivo. Las copias exportadas (.agvproj) no se tocan."]);
            hooks.onDeleted(circuitId);
          } catch (error) {
            go.disabled = false;
            hooks.notify("error", "No se pudo borrar el circuito", [
              isStorageFull(error) ? "El navegador no dejó escribir." : "El almacén rechazó la operación.",
              "No se ha borrado nada: el borrado es entero o nada. Vuelve a intentarlo.",
            ]);
          } finally {
            hooks.lock(false);
            refresh();
          }
        })();
      });
      confirm.append(
        element("p", "storage-warning", `Se borrará de este dispositivo todo lo del circuito «${circuitId}», sin vuelta atrás:`),
        lost,
        element("p", "muted", "Si quieres conservarlo, antes «Exportar circuito (.agvproj)»: la copia se puede volver a abrir."),
        label,
        field,
        element("div", "storage-actions"),
      );
      (confirm.lastElementChild as HTMLElement).append(go, cancel);
      confirm.dataset["circuit"] = circuitId;
      confirm.hidden = false;
      start.disabled = true;
      field.focus();
    })();
  });

  refresh();
  return {
    node,
    refresh,
    setBusy(next: boolean): void {
      busy = next;
      if (confirm.hidden) start.disabled = busy;
      const go = confirm.querySelector<HTMLButtonElement>("button.danger");
      const field = confirm.querySelector<HTMLInputElement>("input");
      if (go !== null && field !== null) go.disabled = busy || field.value !== confirm.dataset["circuit"];
    },
  };
}
