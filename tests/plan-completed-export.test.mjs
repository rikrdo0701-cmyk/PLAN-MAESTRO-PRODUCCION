import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * DECISION DEL USUARIO 2026-11-10 (OT 3608): una operacion COMPLETADA del plan sigue listada en
 * "Detalle de OT" y en el borrador de una OT fija, pero NO consume tiempo. Eso incluye lo que se
 * exporta: `TIEMPO_SETUP` y `TIEMPO_PROD` salen en 0 en esa fila, sin cambiar `PLAN_HEADERS`.
 *
 * El codigo se prueba ejecutando `operationToRow` tal como lo arma el build: se recorta el fuente de
 * app.js y se le inyectan las dependencias minimas, igual que en build.test.mjs.
 */
async function cargarOperationToRow() {
  const app = await readFile(path.join(process.cwd(), "src", "web", "planning", "app.js"), "utf8");
  const rowSource = app.slice(
    app.indexOf("function operationToRow("),
    app.indexOf("function exportCtForOperation(", app.indexOf("function operationToRow(")),
  );
  let exportado = 0;
  const operationToRow = Function(
    "PLAN_HEADERS", "FIELD_MAP", "scheduledProductionMinutesForExport",
    "effectiveUnitPriceForOt", "amountForOt",
    `${rowSource}; return operationToRow;`,
  )(
    ["TIEMPO_SETUP", "TIEMPO_PROD", "SECUENCIA"],
    { TIEMPO_SETUP: "tiempoSetup", TIEMPO_PROD: "tiempoProd", SECUENCIA: "secuencia" },
    (op) => { exportado += 1; return Number(op.tiempoProd || 0); },
    () => 0,
    () => 0,
  );
  return { operationToRow, exportado: () => exportado };
}

test("operationToRow exporta con 0 minutos de setup y de produccion una operacion completada", async () => {
  const { operationToRow, exportado } = await cargarOperationToRow();
  const fila = operationToRow({
    ot: "3608", secuencia: 1, planStatus: "COMPLETADA_PLAN", tiempoSetup: 12, tiempoProd: 45,
  });
  assert.deepEqual(fila, [0, 0, 1]);
  assert.equal(exportado(), 0, "no tiene que calcular minutos de produccion para una completada");
});

test("operationToRow conserva los tiempos de una operacion pendiente", async () => {
  const { operationToRow } = await cargarOperationToRow();
  const fila = operationToRow({
    ot: "3608", secuencia: 3, planStatus: "PENDIENTE", tiempoSetup: 12, tiempoProd: 45,
  });
  assert.deepEqual(fila, [12, 45, 3]);
});
