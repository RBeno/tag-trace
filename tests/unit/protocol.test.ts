/**
 * El guardián de mensajes caducados del protocolo Worker↔UI.
 *
 * Es una función de dos líneas y estaba sin probar, que es como suelen estar las funciones de dos
 * líneas de las que depende que una respuesta tardía no pise la vista. RSK-007 es exactamente esa
 * carrera: un trabajo se cancela, se lanza otro, y el primero contesta después.
 */

import { describe, expect, it } from "vitest";

import { isCurrent, PROTOCOL_VERSION, type FromWorker } from "../../src/application/protocol.js";

function message(jobId: string, protocolVersion = PROTOCOL_VERSION): FromWorker {
  return { type: "cancelled", stage: "parsing", protocolVersion, jobId, seq: 1 } as FromWorker;
}

describe("mensajes caducados · RSK-007", () => {
  it("acepta el del trabajo vigente", () => {
    expect(isCurrent(message("trabajo-2"), "trabajo-2")).toBe(true);
  });

  it("descarta la respuesta tardía de un trabajo anterior", () => {
    // El caso real: se cancela una importación, se lanza otra, y la primera contesta después.
    expect(isCurrent(message("trabajo-1"), "trabajo-2")).toBe(false);
  });

  it("descarta un mensaje de otra versión del protocolo", () => {
    // Un Worker viejo cacheado por el service worker hablaría un protocolo distinto. Hacerle caso
    // sería peor que ignorarlo: los campos podrían coincidir de nombre y no de significado.
    expect(isCurrent(message("trabajo-2", PROTOCOL_VERSION + 1), "trabajo-2")).toBe(false);
  });
});
