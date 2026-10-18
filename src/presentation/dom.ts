/**
 * Lo poco de DOM que todos los paneles repiten: crear un elemento con clase y texto, un botón que
 * no envía formularios y descargar un fichero generado en la página.
 *
 * Hasta 3.89.0 cada panel llevaba su propia copia de `node` (nueve, iguales byte a byte) y de
 * `button` (cuatro), y la descarga estaba escrita diez veces con dos políticas distintas para
 * revocar el `blob:`. Aquí hay una sola copia de cada cosa, y la política segura.
 */

/**
 * Crea un elemento. El texto va siempre como texto: un valor importado nunca se interpreta como
 * marcado (TH-007).
 */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Un botón que no envía ningún formulario: `type="button"` siempre. */
export function button(text: string, className?: string): HTMLButtonElement {
  const out = node("button", className, text);
  out.type = "button";
  return out;
}

/**
 * Descarga un fichero generado en la página: un `Blob` local, nada sale del dispositivo (NFR-001).
 *
 * El `blob:` se revoca con retraso. Revocarlo justo después de `click()` deja la descarga vacía en
 * algunos navegadores, que leen la URL cuando el clic ya ha vuelto.
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = node("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
