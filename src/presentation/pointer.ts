/**
 * Leer un gráfico con ratón, con el panel táctil de un portátil o con el dedo (UX_SPEC §7).
 *
 * Con ratón la lectura sigue al puntero y se va al salir del gráfico. Con el dedo eso no sirve: un
 * toque no mueve ningún puntero, y al levantar el dedo el navegador dispara `pointerleave`, que
 * borraba la lectura en el mismo instante en que aparecía. Así que con el dedo **un toque fija la
 * lectura**, y se queda hasta el siguiente toque.
 *
 * Y un dedo no acierta una marca de 3 px: si el toque no cae sobre una marca, se elige la más
 * cercana dentro de un radio, medida sobre su rectángulo en pantalla. Arrastrar sigue desplazando
 * la página —no se toca `touch-action`—, así que una matriz ancha se sigue pudiendo recorrer.
 */

/** Hasta dónde busca el imán una marca alrededor del toque, en píxeles de pantalla. */
const SNAP_RADIUS = 22;

export interface InspectPoint {
  readonly target: Element;
  readonly clientX: number;
  readonly clientY: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * La caja más cercana a un punto dentro de `radius`, o `-1`. Un punto dentro de una caja está a
 * distancia 0 de ella, así que gana siempre sobre una vecina.
 */
export function nearestWithin(x: number, y: number, boxes: readonly Box[], radius: number): number {
  let best = -1;
  let bestDistance = radius;
  boxes.forEach((box, index) => {
    const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
    const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance && (best === -1 || distance < bestDistance)) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Engancha la lectura de un gráfico. `show(null)` es volver al texto de reposo.
 *
 * `snap` es el selector de las marcas que se leen por su elemento (`[data-k]`, por ejemplo). Sin él,
 * el gráfico lee por coordenadas y no hace falta imán.
 */
export function inspect(
  surface: Element,
  show: (point: InspectPoint | null) => void,
  options: { readonly snap?: string } = {},
): void {
  let lastType = "mouse";
  surface.addEventListener("pointerdown", (event) => {
    lastType = (event as PointerEvent).pointerType || "mouse";
  });
  surface.addEventListener("pointermove", (event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== "mouse") return;
    show({ target: pointer.target as Element, clientX: pointer.clientX, clientY: pointer.clientY });
  });
  surface.addEventListener("pointerleave", (event) => {
    if ((event as PointerEvent).pointerType === "mouse") show(null);
  });
  surface.addEventListener("click", (event) => {
    if (lastType === "mouse") return;
    const click = event as MouseEvent;
    let target = click.target as Element;
    if (options.snap !== undefined && target.closest(options.snap) === null) {
      const candidates = [...surface.querySelectorAll(options.snap)];
      const index = nearestWithin(
        click.clientX,
        click.clientY,
        candidates.map((candidate) => candidate.getBoundingClientRect()),
        SNAP_RADIUS,
      );
      if (index !== -1) target = candidates[index] as Element;
    } else if (options.snap !== undefined) {
      target = target.closest(options.snap) as Element;
    }
    show({ target, clientX: click.clientX, clientY: click.clientY });
  });
}
