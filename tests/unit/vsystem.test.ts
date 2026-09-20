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
});
