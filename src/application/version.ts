/**
 * La versión de la aplicación, para sellar cada instantánea (`CircuitSnapshot.appVersion`).
 *
 * Sale del `CHANGELOG.md` en tiempo de compilación (`vite.config.ts` la inyecta como
 * `__APP_VERSION__`): el registro de cambios es la fuente de verdad de la versión del producto, y
 * copiarla a mano aquí sería tener dos. En Node —pruebas unitarias— no hay compilación y vale «dev».
 */

declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
