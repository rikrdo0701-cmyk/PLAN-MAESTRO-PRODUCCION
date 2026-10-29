import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

/**
 * LAS INSTANTANEAS DEL PLAN, Y POR QUE ESTE ARCHIVO.
 *
 * MEDIDO 2026-10-02 en la base: `plan_snapshots` tiene UNA fila, `snapshot_id='draft'`,
 * 101603 bytes de payload, 67 claves, 129 operaciones, y dentro `status='BORRADOR'`,
 * `generatedAt='2026-10-02T01:38:40.191Z'`, `planStart='2026-09-28'`,
 * `weekStart='2026-09-28'`, `revision=3`, `selectedOts` con 10 OTs. O sea que el
 * borrador SI se guardaba y no se podia leer.
 *
 * LA CAUSA, MEDIDA TAMBIEN. `payload` es `jsonb`, PostgREST lo devuelve ya parseado y
 * `readTable` hace `response.json()` sin transformar nada, o sea que llega como OBJETO.
 * Las tres lecturas hacian `JSON.parse(row.payload || "{}")`, que con un objeto es
 * `JSON.parse("[object Object]")`: lanza, y el `catch` devolvia la fila CRUDA con
 * `snapshot_id` y `generated_at`. Todo lo que consume la lista lee camelCase, asi que
 * en cascada: el borrador no se reconocia, el selector de planes guardados salia
 * vacio y `loadPlanSnapshotById` se llamaba con `undefined`.
 *
 * POR QUE HAY QUE PROBAR LAS DOS FORMAS DE `payload`. El defecto es SILENCIOSO: la
 * pagina sigue funcionando, no sale ningun error y lo unico que falta es el borrador.
 * Un arreglo que solo aceptara texto volveria a romperse en el proximo despliegue sin
 * que nadie se entere, porque el fallo se ve igual que antes. Por eso el texto tambien
 * tiene que funcionar: `plan_guardar` inserta el objeto que le mandan tal cual, asi que
 * si alguien manda un string sigue siendo un payload valido.
 *
 * POR QUE SE CARGA EL ARCHIVO ENTERO Y NO UN TROZO. Las dos funciones puras se sacaron
 * del modulo para poder probarlas sin red, pero el modulo se evalua entero porque su
 * cierre es lo que las monta en el global, y un trozo pegado al que le agregan un
 * `return` probaria una copia y no el codigo que corre.
 */
const RAIZ = new URL("../", import.meta.url);

async function cargarModulo(ruta, nombreGlobal) {
  const fuente = await readFile(new URL(ruta, RAIZ), "utf8");
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx, { filename: ruta });
  return ctx[nombreGlobal];
}

const reemplazo = await cargarModulo("src/web/shared/supabase-bridge-replacement.js", "PPSupabaseBridgeReplacement");
const nucleo = await cargarModulo("src/web/planning/planning-workflow-core.js", "PlanningWorkflowCore");

const { planSnapshotPayload, planSnapshotFromRow } = reemplazo;

// LA FILA REAL, con los valores que salio de la base el 2026-10-02. `payload` va como
// OBJETO a proposito: es como llega de verdad, y es el caso que estaba roto.
const FILA_REAL = {
  id: "0f4d0a2e-0000-0000-0000-000000000001",
  snapshot_id: "draft",
  operations: [],
  payload: {
    snapshotId: "draft",
    status: "BORRADOR",
    generatedAt: "2026-10-02T01:38:40.191Z",
    planStart: "2026-09-28",
    weekStart: "2026-09-28",
    revision: 3,
    savedAt: "2026-10-02T01:38:40.191Z",
    horizonDays: 15,
    selectedOts: ["3316", "3317", "3318", "3319", "3320", "3321", "3322", "3323", "3324", "3325"],
    workOrders: [],
    lockedOts: [],
    operations: Array.from({ length: 129 }, (_, i) => ({ ot: `33${i}`, secuencia: 1, ct: "5514" })),
  },
  generated_at: null,
  plan_start: "",
  version: "",
  usuario: "",
  change_summary: null,
  published_at: null,
  publication_reason: "",
  created_at: "2026-10-02T01:38:40.191+00:00",
};

test("el payload llega como objeto y no se parsea dos veces", () => {
  // El caso que estaba roto. Con un objeto, `JSON.parse` lanzaba y el `catch`
  // devolvia la fila cruda; aqui tiene que devolver el payload tal cual.
  assert.equal(JSON.stringify(planSnapshotPayload(FILA_REAL)), JSON.stringify(FILA_REAL.payload));
  // Y una fila sin payload no puede reventar: da objeto vacio, no undefined.
  assert.equal(JSON.stringify(planSnapshotPayload({ snapshot_id: "draft" })), "{}");
  assert.equal(JSON.stringify(planSnapshotPayload({ payload: null })), "{}");
  assert.equal(JSON.stringify(planSnapshotPayload({ payload: "" })), "{}");
  assert.equal(JSON.stringify(planSnapshotPayload(null)), "{}");
});

test("el payload tambien se acepta como texto, y lo que no es objeto da vacio", () => {
  const texto = JSON.stringify({ snapshotId: "draft", status: "BORRADOR", operations: [1] });
  assert.equal(planSnapshotPayload({ payload: texto }).status, "BORRADOR");
  // Un texto que no es JSON no puede reventar la lectura de la lista entera.
  assert.equal(JSON.stringify(planSnapshotPayload({ payload: "{no es json" })), "{}");
  // Un array no es un estado de plan: se rechaza en vez de pasarlo por objeto.
  assert.equal(JSON.stringify(planSnapshotPayload({ payload: [1, 2, 3] })), "{}");
  assert.equal(JSON.stringify(planSnapshotPayload({ payload: 42 })), "{}");
});

test("la fila se vuelve el objeto que la pagina lee, con los nombres que usa", () => {
  const snap = planSnapshotFromRow(FILA_REAL);
  assert.equal(snap.snapshotId, "draft");
  assert.equal(snap.status, "BORRADOR");
  assert.equal(snap.generatedAt, "2026-10-02T01:38:40.191Z");
  assert.equal(snap.planStart, "2026-09-28");
  assert.equal(snap.weekStart, "2026-09-28");
  // El resto del estado sigue disponible para `restorePublishedPlanAsDraft`, que lo
  // devuelve como `state`.
  assert.equal(snap.revision, 3);
  assert.equal(snap.selectedOts.length, 10);
});

test("en la lista `operations` es el CONTEO, que es como lo lee la pagina", () => {
  // MEDIDO del consumidor: `Number(draftMeta.operations || 0) <= 0` decide si hay
  // borrador (app.js:757) y `${s.operations || 0} ops` lo etiqueta (app.js:6968). Con
  // el ARRAY de 129, `Number([...])` da NaN y el guarda pasaba por accidente.
  const snap = planSnapshotFromRow(FILA_REAL);
  assert.equal(snap.operations, 129);
  assert.equal(Number(snap.operations || 0) > 0, true);
  assert.equal(`${snap.operations || 0} ops`, "129 ops");
  // Sin operaciones se queda en 0, que es lo que el guarda necesita para decir que no hay.
  assert.equal(planSnapshotFromRow({ snapshot_id: "draft", payload: { operations: [] } }).operations, 0);
  assert.equal(planSnapshotFromRow({ snapshot_id: "draft", payload: {} }).operations, 0);
});

test("al abrir UNA instantanea, `operations` vuelve a ser la lista", () => {
  // `loadPlanSnapshotById` necesita el ARRAY: recorre `reportSnapshot.operations` para
  // pintar el plan de esa semana. Por eso la version ligera existe.
  const snap = planSnapshotFromRow(FILA_REAL, { operacionesComoNumero: false });
  assert.ok(Array.isArray(snap.operations));
  assert.equal(snap.operations.length, 129);
  assert.equal(snap.operations[0].ct, "5514");
  // Y el identificador no depende de que el payload lo traiga: `snapshot_id` es la
  // clave NOT NULL UNIQUE, y es lo que el filtro de la lectura usa.
  assert.equal(planSnapshotFromRow({ ...FILA_REAL, payload: { ...FILA_REAL.payload, snapshotId: null } },
    { snapshotId: "draft", operacionesComoNumero: false }).snapshotId, "draft");
});

test("`generatedAt` cae a `created_at` y `status` NO se inventa desde la fila", () => {
  // MEDIDO: `plan_guardar` solo NOMBRA `snapshot_id`, `payload` y `created_at` en su
  // insert, asi que `created_at` es el unico instante que se escribe de verdad.
  const sinFecha = planSnapshotFromRow({ ...FILA_REAL, payload: { status: "BORRADOR" } });
  assert.equal(sinFecha.generatedAt, "2026-10-02T01:38:40.191+00:00");
  // Y `status` en la FILA no existe (medido: `select=status` da 400 42703). Su
  // equivalente es `published_at`, y de ahi no se deduce un estado: una fila sin publicar
  // tiene que salir con `status` vacio, no con "PUBLICADO" inventado.
  assert.equal(sinFecha.status, "BORRADOR");
  assert.equal(planSnapshotFromRow({ snapshot_id: "draft", payload: {} }).status, "");
  assert.equal(planSnapshotFromRow({ snapshot_id: "draft", payload: {}, published_at: "2026-10-01T00:00:00Z" }).status, "");
  assert.equal(planSnapshotFromRow({ snapshot_id: "draft", payload: {}, published_at: "2026-10-01T00:00:00Z" }).publishedAt, "2026-10-01T00:00:00Z");
});

test("el selector de planes guardados ya no sale vacio", () => {
  // LA REGRESION, con el nucleo REAL y no una copia de su logica.
  // `planSourceOptionsMarkup` (app.js:7655) mapea la lista a `{...snapshot, id: snapshot.snapshotId,
  // status: ...}` y filtra `id !== 'draft'`; despues `operationalPlanOptions`
  // (planning-workflow-core.js) antepone su propia entrada 'draft' y deja solo lo PUBLICADO.
  // Se replican los dos pasos porque son los que se consumen, no una version idealizada.
  const cruda = { ...FILA_REAL, snapshot_id: "plan-sem-1", payload: JSON.stringify({ status: "PUBLICADO", planStart: "2026-09-28", weekStart: "2026-09-28", operations: FILA_REAL.payload.operations }) };
  const mapeadas = [planSnapshotFromRow(cruda), planSnapshotFromRow(FILA_REAL)]
    .map((snapshot) => ({ ...snapshot, id: snapshot.snapshotId, status: snapshot.status || "GUARDADO" }))
    .filter((item) => item.id !== "draft");
  const lista = nucleo.operationalPlanOptions(mapeadas);
  // El borrador fijo del nucleo mas el plan publicado, que es lo que ve la persona.
  assert.equal(JSON.stringify(Array.from(lista, (item) => item.id)), JSON.stringify(["draft", "plan-sem-1"]));
  // Con la fila CRUDA, que es lo que devolvia el `catch`, esto era solo ['draft']: el
  // selector salia sin planes guardados y nadie recibia un aviso.
  const antesCrudo = nucleo.operationalPlanOptions([cruda]
    .map((snapshot) => ({ ...snapshot, id: snapshot.snapshot_id, status: snapshot.status || "GUARDADO" }))
    .filter((item) => item.id !== "draft"));
  assert.equal(JSON.stringify(Array.from(antesCrudo, (item) => item.id)), JSON.stringify(["draft"]));
});

test("el borrador restaurado llega con el estado entero y su identidad", () => {
  // `restorePublishedPlanAsDraft` (supabase-bridge-replacement.js) hace
  // `{...snapshot, draftVersionId, planStatus:'BORRADOR'}` y lo devuelve como `state`.
  const fila = { ...FILA_REAL, snapshot_id: "plan-sem-1", payload: { ...FILA_REAL.payload, snapshotId: "plan-sem-1", status: "PUBLICADO" } };
  const restaurado = { ...planSnapshotFromRow(fila, { operacionesComoNumero: false }), draftVersionId: "plan-sem-1", planStatus: "BORRADOR" };
  assert.equal(restaurado.snapshotId, "plan-sem-1");
  assert.equal(restaurado.draftVersionId, "plan-sem-1");
  assert.equal(restaurado.planStatus, "BORRADOR");
  assert.ok(Array.isArray(restaurado.selectedOts) && restaurado.selectedOts.length === 10);
  assert.ok(Array.isArray(restaurado.workOrders));
});