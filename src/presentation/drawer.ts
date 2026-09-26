/**
 * El cajón lateral único de tablas (UX_SPEC §5.3, 3.49.0).
 *
 * Hasta 3.48.0 cada gráfico y cada sección llevaba su tabla en un `<details>` plegado. Abrir uno en
 * medio de una pestaña empujaba todo lo demás hacia abajo —una matriz de 145 × 40 desplazaba la
 * página varias pantallas— y, abiertos dos o tres, la pestaña volvía a ser la lista larga que las
 * pestañas existen para evitar. Ahora hay **un solo cajón** para toda la aplicación: un botón
 * pequeño con icono de tabla abre un `aside` a la derecha (a pantalla completa en el móvil), la
 * página sigue visible y no se mueve, y abrir otra tabla sustituye a la anterior.
 *
 * El contenido se construye **al abrir**, con la misma función perezosa que antes alimentaba el
 * `<details>`: una tabla que nadie abre no cuesta nada (UX_SPEC §4.2).
 *
 * Accesibilidad: `role="dialog"` con `aria-modal="false"` —la página no se bloquea—, `aria-labelledby`
 * con el título de la tabla, botón «Cerrar», Escape cierra, el foco entra al abrir y vuelve al botón
 * que lo abrió al cerrar.
 */

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  // Siempre como texto: un valor importado nunca se interpreta como marcado (TH-007).
  if (text !== undefined) element.textContent = text;
  return element;
}

const drawer = node("aside", "drawer");
drawer.setAttribute("role", "dialog");
drawer.setAttribute("aria-modal", "false");
drawer.setAttribute("aria-labelledby", "drawer-title");
drawer.hidden = true;
drawer.tabIndex = -1;
const head = node("div", "drawer-head");
const title = node("h2", "drawer-title");
title.id = "drawer-title";
const where = node("p", "muted drawer-where");
const closeButton = node("button", "drawer-close", "Cerrar");
closeButton.type = "button";
const body = node("div", "drawer-body");
const titles = node("div");
titles.append(title, where);
head.append(titles, closeButton);
drawer.append(head, body);

/** El botón que abrió el cajón, para devolverle el foco al cerrar. */
let opener: HTMLElement | null = null;

export function closeDrawer(): void {
  if (drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove("has-drawer");
  body.replaceChildren();
  const back = opener;
  opener = null;
  if (back !== null && back.isConnected) back.focus();
}

closeButton.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawer.hidden) {
    event.preventDefault();
    closeDrawer();
  }
});

/**
 * Abre el cajón con una tabla o lista larga. `label` es lo que decía el desplegable («Ver los 145
 * tags del anillo, en orden»), y `section` la figura o el encabezado de donde viene, para que el
 * cajón diga de qué es la tabla aunque la página de detrás se haya desplazado.
 */
export function openDrawer(label: string, section: string, build: () => HTMLElement, from: HTMLElement): void {
  if (!drawer.isConnected) document.body.append(drawer);
  opener = from;
  title.textContent = label;
  where.textContent = section;
  where.hidden = section === "";
  body.replaceChildren(build());
  body.scrollTop = 0;
  drawer.hidden = false;
  document.body.classList.add("has-drawer");
  drawer.focus();
}

/** El icono de tabla del botón: tres filas y un borde, en el color del texto. */
function tableIcon(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(NS, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M1.5 2.5h13v11h-13zM1.5 6h13M1.5 9.5h13M1.5 13h13M6 2.5v11");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.2");
  icon.append(path);
  return icon;
}

/**
 * De dónde es la tabla: el título de la figura si el botón está en una, y si no el último
 * encabezado `h3` o `h2` antes del botón. Se mira al abrir, cuando el botón ya está en la página.
 */
function sectionOf(button: HTMLElement): string {
  const figure = button.closest("figure");
  if (figure !== null) return figure.querySelector("h3")?.textContent ?? "";
  let cursor: Element | null = button;
  while (cursor !== null) {
    let sibling = cursor.previousElementSibling;
    while (sibling !== null) {
      if (sibling.matches("h3, h2")) return sibling.textContent ?? "";
      const inner = [...sibling.querySelectorAll("h3, h2")].filter((heading) => heading.closest("figure") === null).pop();
      if (inner !== undefined) return inner.textContent ?? "";
      sibling = sibling.previousElementSibling;
    }
    cursor = cursor.parentElement;
    if (cursor === null || cursor.matches("[role='tabpanel']")) break;
  }
  return "";
}

/**
 * El botón que abre el cajón con `build()`. Enseña el icono de tabla y el texto del desplegable de
 * antes; «Ver los mismos datos en tabla» se abrevia a «Tabla» y el texto largo queda como
 * `aria-label` y `title`, que es lo que leen el lector de pantalla y el tooltip.
 */
export function tableDrawer(label: string, build: () => HTMLElement): HTMLButtonElement {
  const button = node("button", "drawer-open");
  button.type = "button";
  const short = label === "Ver los mismos datos en tabla" ? "Tabla" : label;
  button.append(tableIcon(), " ", node("span", undefined, short));
  if (short !== label) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  button.addEventListener("click", () => openDrawer(label, sectionOf(button), build, button));
  return button;
}
