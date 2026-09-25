/**
 * Contraste contra Vsystem (R-GRA-001).
 *
 * El caso de oro es literal: una sustitución en medio de un anillo casi idéntico, que es
 * exactamente lo que el contraste manual de PC2 encontró (90,8 % de coincidencia, tags sustituidos
 * detectados por posición). La prueba no es que el algoritmo funcione en abstracto: es que
 * reproduce ese hallazgo concreto sin que se le dé la respuesta de antemano.
 */

import { describe, expect, it } from "vitest";

import { compareAgainstVsystem } from "../../src/domain/vsystem.js";

describe("contraste contra Vsystem", () => {
  it("un anillo idéntico sale todo coincide", () => {
    const anillo = ["0100", "0200", "0300", "0400"];
    const rows = compareAgainstVsystem(anillo, anillo, new Set(anillo));

    expect(rows.every((row) => row.verdict === "coincide")).toBe(true);
    expect(rows).toHaveLength(4);
  });

  it("detecta una sustitución candidata: el declarado sin lecturas, el observado en su hueco", () => {
    // Vsystem declara 0100→0200→0300→0400. El anillo real tiene 0100→0999→0300→0400: 0200 se
    // sustituyó por 0999, y 0200 nunca aparece en ninguna lectura.
    const declarado = ["0100", "0200", "0300", "0400"];
    const observado = ["0100", "0999", "0300", "0400"];
    const rows = compareAgainstVsystem(declarado, observado, new Set(["0100", "0300", "0400", "0999"]));

    const sustitucion = rows.find((row) => row.verdict === "sustituido-candidato");
    expect(sustitucion?.declaredTag).toBe("0200");
    expect(sustitucion?.observedTag).toBe("0999");
    // El sitio lo prueba; el número no decide si es sustitución o errata al escribirlo (R-GRA-015).
    expect(sustitucion?.evidence).toContain("donde la lista lo pone (entre 0100 y 0300)");
    expect(sustitucion?.evidence).toContain("o el número está mal escrito en la lista");
  });

  it("un declarado sin lecturas y sin sustituto sale no-observado, nunca se inventa un sustituto", () => {
    const declarado = ["0100", "0200", "0300"];
    const observado = ["0100", "0300"]; // 0200 simplemente falta, nada lo reemplaza
    const rows = compareAgainstVsystem(declarado, observado, new Set(["0100", "0300"]));

    const fila = rows.find((row) => row.declaredTag === "0200");
    expect(fila?.verdict).toBe("no-observado");
    expect(fila?.observedTag).toBeNull();
    expect(fila?.truth).toBe("unknown");
  });

  it("un declarado que sobra en un hueco pero se lee en otro sitio no sale «sin lecturas»", () => {
    // 0200 no está en el recorrido dominante y nada ocupa su sitio, pero tiene lecturas (una rama, o
    // el sucesor más frecuente lo salta). Llamarlo «sin lecturas» era falso (CHANGELOG [3.30.1]).
    const declarado = ["0100", "0200", "0300"];
    const observado = ["0100", "0300"];
    const rows = compareAgainstVsystem(declarado, observado, new Set(["0100", "0200", "0300"]));

    const fila = rows.find((row) => row.declaredTag === "0200");
    expect(fila?.verdict).toBe("fuera-del-anillo");
    expect(fila?.truth).toBe("observed");
    expect(fila?.evidence).not.toContain("sin lecturas");
  });

  it("un tag observado que Vsystem no declara sale no-declarado, con estado observed", () => {
    const declarado = ["0100", "0300"];
    const observado = ["0100", "0250", "0300"]; // 0250 es nuevo, no está en la lista
    const rows = compareAgainstVsystem(declarado, observado, new Set(["0100", "0250", "0300"]));

    const fila = rows.find((row) => row.observedTag === "0250");
    expect(fila?.verdict).toBe("no-declarado");
    expect(fila?.truth).toBe("observed");
  });

  it("un declarado que sí se lee en otro sitio no se confunde con una sustitución", () => {
    // 0200 tiene lecturas en algún otro tramo del anillo (por ejemplo, es parte de una rama): no
    // hay que llamarlo "sustituido" solo porque no está en esta posición exacta.
    const declarado = ["0100", "0200", "0300"];
    const observado = ["0100", "0999", "0300"];
    const rows = compareAgainstVsystem(declarado, observado, new Set(["0100", "0200", "0300", "0999"]));

    const fila = rows.find((row) => row.declaredTag === "0200");
    expect(fila?.verdict).toBe("no-declarado");
    expect(fila?.evidence).toContain("sí se lee");
  });

  it("es invariante a por dónde se corte el anillo observado (R-GRA-009)", () => {
    // El anillo es cíclico: el ancla puede ser inferida (ciclo dominante) o declarada en un tag
    // distinto del primero de la lista Vsystem, así que `observedRing` puede llegar cortado por
    // cualquier punto. El contraste no debe depender de eso: cortar en mitad de un tramo idéntico
    // no puede partir una coincidencia larga en dos más cortas.
    const declarado = ["0100", "0200", "0300", "0400", "0500", "0600"];
    // Mismo anillo, pero cortado empezando por "0400" en vez de por "0100".
    const rotado = ["0400", "0500", "0600", "0100", "0200", "0300"];
    const leidos = new Set(declarado);

    const sinRotar = compareAgainstVsystem(declarado, declarado, leidos);
    const conRotacion = compareAgainstVsystem(declarado, rotado, leidos);

    const coincidencias = (rows: readonly { readonly verdict: string }[]): number =>
      rows.filter((row) => row.verdict === "coincide").length;

    expect(coincidencias(conRotacion)).toBe(coincidencias(sinRotar));
    expect(coincidencias(conRotacion)).toBe(declarado.length);
  });

  it("sin ningún tag en común, se deja el anillo como está en vez de fallar", () => {
    const declarado = ["0100", "0200"];
    const observado = ["0900", "0910"];
    const rows = compareAgainstVsystem(declarado, observado, new Set([...declarado, ...observado]));

    expect(rows.every((row) => row.verdict !== "coincide")).toBe(true);
  });

  it("un declarado que la lista pone en otro sitio sale una vez, como «otro-orden», y manda lo leído", () => {
    // 0400 está declarado al final y los AGV lo leen entre 0100 y 0200. Antes salía dos veces y
    // contradiciéndose: «se lee fuera del recorrido» y «no declarado» (CHANGELOG [3.31.0]).
    const declarado = ["0100", "0200", "0300", "0400"];
    const observado = ["0100", "0400", "0200", "0300"];
    const rows = compareAgainstVsystem(declarado, observado, new Set(declarado));

    const delTag = rows.filter((row) => row.declaredTag === "0400" || row.observedTag === "0400");
    expect(delTag).toHaveLength(1);
    expect(delTag[0]?.verdict).toBe("otro-orden");
    expect(delTag[0]?.evidence).toContain("Las lecturas lo sitúan entre 0100 y 0200; la lista, después de 0300");
    expect(delTag[0]?.evidence).toContain("es la lista la que hay que corregir");
    expect(rows.some((row) => row.verdict === "no-declarado" || row.verdict === "fuera-del-anillo")).toBe(false);
  });
});
