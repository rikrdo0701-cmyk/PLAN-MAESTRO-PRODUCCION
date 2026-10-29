import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/inspection/inspection-core.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const core = context.window.InspectionCore;

test("selecciona todas las operaciones al cargar y compacta la impresion", () => {
  const operations = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(structuredClone(core.initialOperationSelection(operations)), { a: true, b: true, c: true });
  assert.deepEqual(structuredClone(core.printableOperations(operations, { a: true, b: false, c: true })).map((item) => item.id), ["a", "c"]);
});

test("compacta operaciones visibles y agrega vacias solamente al final", () => {
  const operations = [{ id: "a", code: "10C" }, { id: "b", code: "20C" }, { id: "c", code: "30C" }];
  const rows = core.inspectionRows(operations, { a: true, b: false, c: true }, 4);
  assert.deepEqual(structuredClone(rows).map((row) => row.operation?.code || ""), ["10C", "30C", "", ""]);
});

test("reiniciar seleccion incluye todas las operaciones", () => {
  assert.deepEqual(structuredClone(core.initialOperationSelection([{ id: "x" }, { code: "20C" }])), { x: true, "20C": true });
});

test("diagnostico de impresion replica pendientes, tramos y deficit del original", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 1.5, available: 1, route: "", deficitNeto: 0.5 },
    { material: "INSERTO", required: 2, available: 1, route: "", deficit: 1 }
  ], true);

  assert.equal(diagnostic.status, "block");
  assert.equal(diagnostic.pending.length, 2);
  assert.deepEqual(diagnostic.missingRoutes.map((item) => item.material), ["TUBO"]);
  assert.equal(diagnostic.deficit.length, 2);
});

test("operaciones ocultas no cambian el semaforo y el deficit solo advierte", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 2, available: 1, route: "", deficitNeto: 1 }
  ], true);

  assert.equal(diagnostic.status, "warn");
  assert.equal(diagnostic.label, "Revisar");
  assert.equal(diagnostic.pending.length, 1);
  assert.equal(diagnostic.missingRoutes.length, 0);
});

test("usa deficit neto del backend y filtra costo cero o sin requerido", () => {
  const diagnostic = core.inspectionPrintDiagnostic([
    { material: "TUBO", required: 2, available: 0, deficitNeto: 0, deficit: 0 },
    { material: "Costo 0 ajuste", required: 4, deficitNeto: 4 },
    { material: "SIN REQUERIR", required: 0, deficitNeto: 2 }
  ], true);

  assert.equal(diagnostic.status, "ok");
  assert.deepEqual(diagnostic.materials.map((item) => item.material), ["TUBO"]);
  assert.equal(diagnostic.deficit.length, 0);
});

test("normaliza, ordena y filtra las filas del catalogo de tramos", () => {
  const rows = core.inspectionRouteRows([
    { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b.pdf", ACTUALIZADO: "02/07/2026" },
    { article: "A-100", material: "TUBO 1", route: "650 mm", drawing: "a.pdf", updated: "01/07/2026" },
    { article: "", material: "SIN ARTICULO" },
    // MEDIDO 2026-10-01 (RULE-INS-001): esta fila SE QUEDA. Con el material vacio es
    // el DIBUJO A NIVEL DE ORDEN DE TRABAJO, la que usa
    // PP_Inspection_articleDrawingMatchV2_ para el articulo entero. Antes se
    // descartaba porque `inspectionRouteRows` exigia material, y eso no biteba
    // mientras la fuente sea `materials` (donde el componente siempre viene) pero
    // si con `inspection_routes`, que si tiene la fila. Descartarla seria quitarle
    // a la pagina el dibujo del conjunto.
    { article: "C-300", material: "", drawing: "c300-completo.pdf" }
  ]);

  assert.deepEqual(structuredClone(rows), [
    { article: "A-100", material: "TUBO 1", route: "650 mm", drawing: "a.pdf", updated: "01/07/2026" },
    { article: "B-200", material: "MP-2", route: "420 mm", drawing: "b.pdf", updated: "02/07/2026" },
    { article: "C-300", material: "", route: "", drawing: "c300-completo.pdf", updated: "" }
  ]);
  assert.deepEqual(structuredClone(core.filterInspectionRouteRows(rows, "mp-2")).map((row) => row.material), ["MP-2"]);
  assert.deepEqual(structuredClone(core.filterInspectionRouteRows(rows, "a-100")).map((row) => row.article), ["A-100"]);
  assert.deepEqual(structuredClone(core.filterInspectionRouteRows(rows, "")), structuredClone(rows));
});

/**
 * Y el filtro de busqueda tambien tiene que encontrar la fila del dibujo por
 * ARTICULO, no solo por material. Con el material vacio, un search por "tube" (que
 * es como se busca en la pestana) tiene que devolverla igual: si no, la unica fila
 * que se puede ver en la tabla es la que se ve sin buscar, y alguien que busca
 * para saber si el dibujo del articulo existe concludes que no existe.
 */
test("el filtro del catalogo encuentra la fila del dibujo por su articulo", () => {
  const rows = core.inspectionRouteRows([
    { article: "C-300", material: "", drawing: "c300-completo.pdf" }
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(structuredClone(core.filterInspectionRouteRows(rows, "c-300")).map((row) => row.drawing), ["c300-completo.pdf"]);
});

test("prepara el guardado route-only del catalogo sin enviar dibujo cacheado", () => {
  const payload = core.inspectionRouteSavePayload({
    article: " A-100 ",
    material: " TUBO 1 ",
    route: "600 mm",
    drawing: " a100.pdf ",
    updated: "01/07/2026"
  }, " 650 mm ");

  assert.deepEqual(structuredClone(payload), {
    article: "A-100",
    material: "TUBO 1",
    route: "650 mm"
  });
});

/**
 * MEDIDO 2026-10-04 en la base en vivo (697 filas de `materials`): habia DOS filas por
 * cada (ot, componente) y la hoja de inspeccion sacaba cada MP DOS VECES, lado a lado. La
 * hoja de la OT 3374, que tiene UNA sola MP (MP00153), mostraba MP00153 en la columna
 * izquierda y MP00153 en la derecha.
 *
 * LA CAUSA, Y NO ES SUPOSICION. `materials` tiene dos escritores con dos claves distintas:
 * la ingesta (RESTlet 2246, `materiales_`) escribe `line_id` = `comp.id`, el id de renglon de
 * NetSuite, que es SIEMPRE un entero (medidos '2', '3', '4', '24'); la pagina escribia
 * `line_id` = `id`, el UUID de la fila que acababa de LEER (medido: la copia tiene `id`
 * '68d0519a-...' y `line_id` 'c1f3421a-...', y la original de la misma MP tiene `id`
 * 'c1f3421a-...'). El UNIQUE es (ot, line_id): con dos claves para el mismo renglon de BOM
 * no se emparejan y el merge-duplicates INSERTA en vez de actualizar. 348 (ot, componente)
 * distintos, 348 con mas de una fila, 349 filas de mas, y uno con tres.
 *
 * Y EL CASO QUE HACE QUE LA CLAVE NO SEA EL NOMBRE DEL COMPONENTE: la OT 3776 tiene
 * MP00094 en DOS renglones de verdad del BOM (`comp.id` 2 con 6.27 y `comp.id` 3 con 330).
 * Son dos lineas con cantidades distintas, no un duplicado, y juntarlas perderia el 330 (o
 * sumaria 336.27, que no existe en ninguna parte). Es 1 caso de 348, y por eso la regla es
 * "una fila por RENGLON DEL BOM", no "una fila por MP".
 */
test("una sola MP se queda con una sola fila, y la copia del escritor se va", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00153", description: 'Tubo de 2" x 6mts', required: 1.666, requiredOriginal: 1.666, route: "500 mm", lineId: "2" },
    { material: "MP00153", description: 'Tubo de 2" x 6mts', required: 1.666, requiredOriginal: 1.666, route: "500 mm", lineId: "c1f3421a-29e6-4491-8701-1321c95251a5" }
  ]);

  assert.equal(unicos.length, 1, "una MP, una vez: la hoja no puede repetirla");
  assert.equal(unicos[0].material, "MP00153");
  assert.equal(unicos[0].lineId, "2", "gana el renglon del BOM, no la copia");
  assert.equal(unicos[0].required, 1.666, "la cantidad no se suma: las dos traian 1.666");
  assert.equal(unicos[0].route, "500 mm");
});

test("la misma MP escrita con espacios o distinta caja es la misma MP", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00153", required: 2, lineId: "2" },
    { material: " mp00153 ", required: 2, lineId: "c1f3421a" }
  ]);

  assert.equal(unicos.length, 1, "la clave del grupo es el componente normalizado, no el crudo");
  assert.equal(unicos[0].lineId, "2", "gana el renglon del BOM");
});

test("dos renglones REALES del BOM con la misma MP se conservan los dos", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00094", required: 6.27, requiredOriginal: 6.27, lineId: "2" },
    { material: "MP00094", required: 330, requiredOriginal: 330, lineId: "3" },
    { material: "MP00094", required: 6.27, requiredOriginal: 6.27, lineId: "bda4aa98-5b50-4156-81f4-45bea8c5fbde" }
  ]);

  assert.deepEqual(structuredClone(unicos).map((item) => item.lineId), ["2", "3"], "la de 330 es un renglon real: juntarla perderia el dato");
  assert.deepEqual(structuredClone(unicos).map((item) => item.required), [6.27, 330], "y las cantidades no se suman: 336.27 no existe");
});

test("si no hay ningun renglon del BOM, se conserva uno en vez de dejar la hoja vacia", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00070", required: 1, lineId: "" },
    { material: "MP00070", required: 1, lineId: "a1b2c3d4-0000-0000-0000-000000000000" }
  ]);

  assert.equal(unicos.length, 1, "un material sin clave del ERP se muestra, no se borra");
  assert.equal(unicos[0].material, "MP00070");
});

test("la descripcion vacia se rescata de la copia, y la ruta NO se toca", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00153", description: "", route: "500 mm", lineId: "2" },
    { material: "MP00153", description: 'Tubo de 2" x 6mts', route: "", lineId: "c1f3421a" }
  ]);

  assert.equal(unicos.length, 1);
  assert.equal(unicos[0].description, 'Tubo de 2" x 6mts');
  assert.equal(unicos[0].route, "500 mm", "la ruta sale del catalogo por componente, no de la fila");
});

test("el renglon del BOM se reconoce por ser un entero, no por parecer un UUID", () => {
  // Los `line_id` de la ingesta son '2', '3', '4', '24'. Un UUID es lo que invento el
  // escritor de la pagina. La regla no dice "no es UUID" para no atarse al formato de una
  // clave ajena: dice "es el id de renglon de NetSuite", y eso es un entero.
  assert.equal(core.inspectionLineaDelBom("2"), true);
  assert.equal(core.inspectionLineaDelBom(" 24 "), true);
  assert.equal(core.inspectionLineaDelBom("c1f3421a-29e6-4491-8701-1321c95251a5"), false);
  assert.equal(core.inspectionLineaDelBom(""), false);
  assert.equal(core.inspectionLineaDelBom(null), false);
});

test("la deduplicacion no cambia el orden de los materiales", () => {
  const unicos = core.inspectionMaterialsUnicos([
    { material: "MP00219", lineId: "a-1" },
    { material: "MP00153", lineId: "2" },
    { material: "MP00219", lineId: "b-2" },
    { material: "BRIDA-2668", lineId: "3" }
  ]);

  assert.deepEqual(structuredClone(unicos).map((item) => item.material), ["MP00219", "MP00153", "BRIDA-2668"],
    "la hoja se llena en el orden de la tabla de materiales");
});

test("el detalle de la OT ya no trae la copia: una MP, una fila", () => {
  // El filtro de la hoja (`inspectionMaterials`) es el que decide que se imprime, asi que
  // con la copia en `detail.materials` el semaforo, el contador de materiales y el dialogo
  // de editar tramo tambien la contaban dos veces. Por eso la deduplicacion va en
  // `inspectionDetail` y no solo en el render.
  const detail = core.inspectionDetail({
    workOrder: { item: "C 290 UID", ot: "3374", quantity: 20 },
    materials: [
      { component: "MP00153", description: 'Tubo de 2" x 6mts', required: 1.666, pending: 1.666, lineId: "2" },
      { component: "MP00153", description: 'Tubo de 2" x 6mts', required: 1.666, pending: 1.666, lineId: "c1f3421a" }
    ],
    routes: { byMaterialDrawing: {}, rows: [] },
    disponibles: {}
  });

  assert.equal(detail.materials.length, 1);
  assert.deepEqual(structuredClone(core.inspectionMaterials(detail.materials)).map((item) => item.material), ["MP00153"]);
  assert.equal(core.inspectionMaterials(detail.materials).length, 1, "la hoja imprime una vez");
});
test("aplica el guardado a la fila vigente por clave aunque la cache se reemplace", () => {
  const selectedBeforeRefresh = {
    article: " A-100 ",
    material: "TUBO 1",
    route: "600 mm",
    drawing: "viejo.pdf",
    updated: "ayer"
  };
  const refreshedRows = core.inspectionRouteRows([
    { article: "a-100", material: " tubo 1 ", route: "625 mm", drawing: "vigente.pdf", updated: "hoy" },
    { article: "B-200", material: "MP-2", route: "400 mm", drawing: "b.pdf", updated: "hoy" }
  ]);

  const result = core.applyInspectionRouteSave(
    refreshedRows,
    selectedBeforeRefresh,
    { route: "650 mm", drawing: "servidor.pdf", updated: "ahora" },
  );

  assert.notEqual(refreshedRows[0], selectedBeforeRefresh);
  assert.deepEqual(structuredClone(result), [
    { article: "a-100", material: "tubo 1", route: "650 mm", drawing: "servidor.pdf", updated: "ahora" },
    { article: "B-200", material: "MP-2", route: "400 mm", drawing: "b.pdf", updated: "hoy" }
  ]);
});
