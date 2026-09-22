/**
 * Candidatos a punto crítico (R-GRA-007), leídos como reparto de sucesores con cuota comparable.
 *
 * Un tag crítico es el que cumple una función de la que depende que el vehículo haga lo correcto:
 * parada precisa, cruce, semáforo, dejar/recoger carro, cambio de mapa o bifurcación. La función es
 * dato de planta declarado, **nunca se deduce del fichero** — lo que el dato sí deja es una firma
 * por clase, que sirve para proponer candidatos al propietario, nunca para asignar la función.
 *
 * Esta entrega construye solo la firma de **bifurcación**: un tag cuyas salidas se reparten entre
 * dos o más sucesores con cuota comparable, ninguno dominante. Es la única de las clases con firma
 * cuyo cálculo ya está disponible sin inventar estadística nueva — el mismo recuento de sucesores
 * por tag que `findDominantCycle` (`laps.ts`) ya reduce para encontrar el sucesor mayoritario.
 *
 * Parada-precisa y semáforo necesitan una firma de tiempo de permanencia (baja varianza y larga
 * para una, bimodal para la otra) que no existe todavía en el proyecto. Cruce resultó ser un
 * problema distinto: `assignCohorts` fusiona dos vehículos en un cohorte en cuanto comparten una
 * sola transición, así que un cruce real entre circuitos no sobrevive como dos cohortes unidos por
 * una arista rara — se fusiona, y la bifurcación resultante es indistinguible de una bifurcación
 * normal sin una segunda comprobación de reconvergencia que esta entrega no construye. Las dos
 * quedan fuera, documentadas, no silenciadas.
 */

/** Un sucesor de un tag, con cuánto tráfico sostiene esa rama. */
export interface BranchShare {
  readonly tagId: string;
  readonly support: number;
  readonly share: number;
}

export interface CriticalPointCandidate {
  readonly tagId: string;
  readonly suggestedFunction: "bifurcacion";
  /** Transiciones totales salientes del tag, sumando todas sus ramas. */
  readonly support: number;
  /** Las ramas que sostienen el candidato, ordenadas por cuota descendente. */
  readonly branches: readonly BranchShare[];
  readonly evidence: string;
}

export interface BifurcationThresholds {
  /** Cuota mínima de cada rama para contar como reparto real y no como excepción rara. */
  readonly minBranchShare: number;
  /** Transiciones mínimas por rama: una cuota del 50 % sobre dos pasadas no es consenso. */
  readonly minBranchSupport: number;
  /**
   * Cuota mínima de cada rama en **cada mitad** de las pasadas del tag, por recuento y no por
   * tiempo.
   *
   * Sin esta guarda, un tag que deja de leerse aguas abajo (una rotura súbita, por ejemplo) hace
   * parecer bifurcado al tag anterior: antes de la rotura casi todas las salidas van al sucesor de
   * siempre, después van todas al que lo sustituye por saltarse el tramo roto, y esas dos cuotas
   * agregadas sobre toda la ventana pueden ser perfectamente comparables sin que exista ningún
   * reparto real y estable. Una bifurcación real sostiene las dos ramas en las dos mitades; un
   * cambio de régimen sostiene una en cada una y desaparece en la otra.
   */
  readonly minBranchShareEachHalf: number;
}

/** Agrupador para cuando se añadan parada-precisa/semáforo/cruce, sin reabrir esta forma. */
export interface CriticalPointThresholds {
  readonly bifurcacion: BifurcationThresholds;
}

function formatShare(branch: BranchShare): string {
  return `${branch.tagId} (${Math.round(branch.share * 100)} %, ${branch.support} pasadas)`;
}

/**
 * Busca tags cuyas salidas se reparten entre dos o más sucesores con cuota comparable, sostenida en
 * el tiempo.
 *
 * Sin guarda de reconvergencia: no comprueba que las ramas se reencuentren más adelante. Eso exige
 * un segundo recorrido con su propio umbral de cuántos saltos esperar antes de rendirse, y queda
 * para cuando haga falta — un límite conocido, no un defecto oculto.
 */
export function findBifurcationCandidates(
  transitions: readonly { readonly from: string; readonly to: string; readonly fromTime: number }[],
  thresholds: BifurcationThresholds,
): readonly CriticalPointCandidate[] {
  const outgoing = new Map<string, { readonly to: string; readonly fromTime: number }[]>();
  for (const { from, to, fromTime } of transitions) {
    let hits = outgoing.get(from);
    if (hits === undefined) {
      hits = [];
      outgoing.set(from, hits);
    }
    hits.push({ to, fromTime });
  }

  const candidates: CriticalPointCandidate[] = [];
  for (const [tagId, hits] of outgoing) {
    const total = hits.length;
    const counts = new Map<string, number>();
    for (const hit of hits) counts.set(hit.to, (counts.get(hit.to) ?? 0) + 1);

    const surviving = [...counts.entries()]
      .map(([to, support]) => ({ tagId: to, support, share: support / total }))
      .filter((branch) => branch.share >= thresholds.minBranchShare && branch.support >= thresholds.minBranchSupport);
    if (surviving.length < 2) continue;

    // Persistencia temporal, por recuento y no por tiempo (misma razón que `read-rate-trend.ts`: la
    // densidad de pasadas no es uniforme). Una rama que no se sostiene en las dos mitades es un
    // cambio de régimen, no una bifurcación real.
    const byTime = [...hits].sort((a, b) => a.fromTime - b.fromTime);
    const middle = Math.floor(byTime.length / 2);
    const firstHalf = byTime.slice(0, middle);
    const secondHalf = byTime.slice(middle);
    const shareIn = (half: readonly { readonly to: string }[], to: string): number =>
      half.length === 0 ? 0 : half.filter((hit) => hit.to === to).length / half.length;

    const branches: BranchShare[] = surviving
      .filter(
        (branch) =>
          shareIn(firstHalf, branch.tagId) >= thresholds.minBranchShareEachHalf &&
          shareIn(secondHalf, branch.tagId) >= thresholds.minBranchShareEachHalf,
      )
      .sort((a, b) => b.share - a.share);

    if (branches.length < 2) continue;

    candidates.push({
      tagId,
      suggestedFunction: "bifurcacion",
      support: total,
      branches,
      evidence:
        `Reparte sus salidas entre ${branches.length} sucesores con cuota comparable: ` +
        `${branches.map(formatShare).join(" y ")}. Ninguno domina.`,
    });
  }

  return candidates.sort((a, b) => b.support - a.support);
}
