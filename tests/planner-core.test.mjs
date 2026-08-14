import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const source = await readFile(path.resolve("src/web/planning/planner-core.js"), "utf8");

function loadPlannerCore() {
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: "planner-core.js" });
  return context.globalThis.PlannerCore;
}

function loadPlannerCoreWithSinglePass() {
  const context = { globalThis: {} };
  const instrumented = source.replace("\n    evaluatePlan,", "\n    schedulePlanOnce,\n    evaluatePlan,");
  vm.runInNewContext(instrumented, context, { filename: "planner-core.js" });
  return context.globalThis.PlannerCore;
}

test("PlannerCore expone el programador principal", () => {
  const core = loadPlannerCore();
  assert.equal(typeof core.schedulePlan, "function");
  assert.equal(typeof core.operationToolKey, "function");
});

test("una OT cancelada nunca es movible para planeacion", () => {
  const core = loadPlannerCore();
  for (const status of ["Cancelada", "Cancelado", "Canceled", "Cancelled"]) {
    assert.equal(core.isMovablePlanningStatus(status), false, status);
  }
  assert.equal(core.isMovablePlanningStatus("En curso"), true);
});

test("filtra capacidades parcialmente por nombre o CT sin acentos, mayusculas ni espacios extra", () => {
  const core = loadPlannerCore();
  const capabilities = [
    { key: "5459::DOBLEZ_DE_TUBERIA", ct: "5459", label: "Dóblez   de tubería" },
    { key: "100::CORTE", ct: "100", label: "Corte" },
  ];

  assert.deepEqual(
    [...core.filterCapabilities(capabilities, "  doblez de TUBERIA ")],
    [capabilities[0]],
  );
  assert.deepEqual([...core.filterCapabilities(capabilities, "459")], [capabilities[0]]);
  assert.deepEqual([...core.filterCapabilities(capabilities, "   ")], capabilities);
});

test("clasifica todas las variantes especiales de subcontrato por contenido", () => {
  const core = loadPlannerCore();
  for (const label of [
    "Envío a subcontrato externo",
    "Servicio de cromado brillante",
    "Acabado Metokote negro",
    "Proceso MAKA final",
    "Baño galvanizado",
  ]) {
    assert.equal(core.isSpecialSubcontractCapability({ ct: "999", label }), true, label);
  }
  assert.equal(core.isSpecialSubcontractCapability({ ct: "100", label: "CORTE" }), false);
  assert.equal(core.isSpecialSubcontractCapability({ ct: "6462", label: "PINTURA EXTERIOR" }), true);
  assert.equal(core.isSpecialSubcontractCapability({ ct: "5495", label: "E-COAT PINTURA" }), true);
  assert.equal(core.isSpecialSubcontractCapability({ ct: "5495", label: "67OTD ENVIO A PINTURA" }), true);
});

test("identifica y filtra operaciones por la clave normalizada CT::NOMBRE", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "excluded", ct: " 54á ", descripcion: "  Dóblez   especial " },
    { id: "included", ct: "100", descripcion: "CORTE" },
  ];
  const state = { excludedCapabilities: ["54A::DOBLEZ_ESPECIAL"] };

  assert.equal(core.isOperationCapabilityExcluded(state, operations[0]), true);
  assert.equal(core.isOperationCapabilityExcluded(state, operations[1]), false);
  assert.deepEqual([...core.filterExcludedOperations(state, operations)], [operations[1]]);
  assert.deepEqual([...core.filterExcludedOperations({}, operations)], operations);
});

test("precalcula las exclusiones y permite reutilizarlas al filtrar operaciones", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "excluded", ct: " 54á ", descripcion: "  Dóblez   especial " },
    { id: "included", ct: "100", descripcion: "CORTE" },
    { id: "tool-change", ct: "TOOL_CHANGE", descripcion: "CAMBIO DE HERRAMENTAL", tipoInsercion: "CAMBIO_HERRAMENTAL" },
  ];
  const state = { excludedCapabilities: ["54A::DOBLEZ_ESPECIAL", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"] };

  const excludedSet = core.excludedCapabilityKeySet(state);

  assert.deepEqual([...excludedSet], ["54A::DOBLEZ_ESPECIAL", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"]);
  assert.deepEqual(
    [...core.filterExcludedOperations(state, operations, excludedSet)].map((operation) => operation.id),
    ["included", "tool-change"],
  );
  assert.deepEqual([...core.excludedCapabilityKeySet({ excludedCapabilities: "54A::DOBLEZ_ESPECIAL" })], []);
});

test("PlannerCore acepta un estado vacio", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({ operations: [], workOrders: [], settings: {}, workSchedule: {} }, {
    planStart: "2026-07-13",
    horizonDays: 5,
    executionTime: "2026-07-13T07:00:00",
  });
  assert.ok(Array.isArray(result.operations));
  assert.equal(result.operations.length, 0);
  assert.equal(result.horizonDays, 5);
});

test("respeta el inicio del Gantt aunque la ejecucion ocurra despues", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100"],
    operations: [
      { id: "op-1", ot: "100", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
    ],
    workOrders: [{ ot: "100" }],
    matrix: { "100::CORTE": ["OP 1"] },
    configuredCapabilities: ["100::CORTE"],
    operators: ["OP 1"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-08-03",
    horizonDays: 5,
    executionTime: "2026-08-13T10:30:00",
    respectPlanStart: true,
  });

  const operation = result.operations.find((item) => item.id === "op-1");
  assert.equal(result.planStart, "2026-08-03");
  assert.equal(operation.fechaInicio, "2026-08-03");
  assert.equal(operation.horaInicio, "07:00");
});

test("OT bloqueada antes del Gantt queda fija completa y reserva carga", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    operations: [
      {
        id: "fixed-before-gantt", ot: "100", secuencia: 1, ct: "100", descripcion: "CORTE",
        estatus: "PROGRAMADA", planStatus: "PENDIENTE", operador: "OP 1",
        fechaInicio: "2026-08-12", horaInicio: "15:00", fechaFin: "2026-08-13", horaFin: "08:00",
        tiempoProd: 60,
      },
      { id: "new-op", ot: "200", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { "100::CORTE": ["OP 1"] },
    configuredCapabilities: ["100::CORTE"],
    operators: ["OP 1"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-08-13",
    horizonDays: 5,
    executionTime: "2026-08-13T10:30:00",
    respectPlanStart: true,
  });

  const fixed = result.operations.find((item) => item.id === "fixed-before-gantt");
  const newOp = result.operations.find((item) => item.id === "new-op");
  assert.equal(fixed.fechaInicio, "2026-08-12");
  assert.equal(fixed.horaInicio, "15:00");
  assert.equal(fixed.fechaFin, "2026-08-13");
  assert.equal(fixed.horaFin, "08:00");
  assert.equal(newOp.fechaInicio, "2026-08-13");
  assert.equal(newOp.horaInicio, "08:00");
});

test("OT no bloqueada con operacion pendiente programada antes del Gantt se replanea desde INICIO", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100"],
    lockedOts: [],
    operations: [
      {
        id: "movable-before-gantt", ot: "100", secuencia: 1, ct: "100", descripcion: "CORTE",
        estatus: "PROGRAMADA", planStatus: "PENDIENTE", operador: "OP 1", locked: true,
        fechaInicio: "2026-08-12", horaInicio: "15:00", fechaFin: "2026-08-12", horaFin: "16:00",
        tiempoProd: 60,
      },
    ],
    workOrders: [{ ot: "100" }],
    matrix: { "100::CORTE": ["OP 1"] },
    configuredCapabilities: ["100::CORTE"],
    operators: ["OP 1"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-08-13",
    horizonDays: 5,
    executionTime: "2026-08-13T10:30:00",
    respectPlanStart: true,
  });

  const operation = result.operations.find((item) => item.id === "movable-before-gantt");
  assert.equal(operation.fechaInicio, "2026-08-13");
  assert.equal(operation.horaInicio, "07:00");
  assert.equal(operation.fechaFin, "2026-08-13");
  assert.equal(operation.horaFin, "08:00");
});

test("una operacion excluida no se agenda, bloquea recursos ni genera errores de configuracion", () => {
  const core = loadPlannerCore();
  const excluded = {
    id: "excluded", ot: "100", secuencia: 1, ct: "999", descripcion: "SIN CONFIGURAR",
    estatus: "PLAN", operador: "OP 1", tiempoProd: 120,
  };
  const excludedBlocker = {
    id: "excluded-blocker", ot: "101", secuencia: 1, ct: "999", descripcion: "SIN CONFIGURAR",
    estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 120,
    fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00",
  };
  const included = {
    id: "included", ot: "200", secuencia: 1, ct: "100", descripcion: "CORTE",
    estatus: "PLAN", operador: "OP 1", tiempoProd: 20,
  };
  const state = {
    excludedCapabilities: ["999::SIN_CONFIGURAR"],
    selectedOts: ["100", "101", "200"],
    operations: [excluded, excludedBlocker, included],
    workOrders: [{ ot: "100" }, { ot: "101" }, { ot: "200" }],
    matrix: { "100::CORTE": ["OP 1"] },
    configuredCapabilities: ["100::CORTE"],
    operators: ["OP 1"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  };

  assert.deepEqual([...core.planningConfigurationIssues(state, state.operations)], []);
  const result = core.schedulePlan(state, {
    planStart: "2026-07-13",
    horizonDays: 5,
    executionTime: "2026-07-13T07:00:00",
  });
  const excludedResult = result.operations.find((operation) => operation.id === "excluded");
  const includedResult = result.operations.find((operation) => operation.id === "included");
  assert.equal(excludedResult.fechaInicio, undefined);
  assert.equal(excludedResult.operador, "OP 1");
  assert.equal(includedResult.horaInicio, "07:00");
  assert.equal(result.lastSchedule.scheduled, 1);
  assert.equal(result.lastSchedule.unscheduled, 0);
  assert.equal(result.lastSchedule.diagnostics.some((item) => item.operationId === "excluded"), false);
});

test("al excluir una operacion intermedia la sucesora depende de la ultima incluida de la OT", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    excludedCapabilities: ["200::INSPECCION"],
    selectedOts: ["300"],
    operations: [
      { id: "first", ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
      { id: "middle", ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "last", ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "300" }],
    matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-13",
    horizonDays: 5,
    executionTime: "2026-07-13T07:00:00",
  });
  const first = result.operations.find((operation) => operation.id === "first");
  const middle = result.operations.find((operation) => operation.id === "middle");
  const last = result.operations.find((operation) => operation.id === "last");

  assert.equal(middle.fechaInicio, undefined);
  assert.ok(last.fechaInicio, JSON.stringify(result.lastSchedule.diagnostics));
  assert.ok(
    new Date(`${last.fechaInicio}T${last.horaInicio}:00`) >= new Date(`${first.fechaFin}T${first.horaFin}:00`),
  );
});

test("una sucesora conserva precedencia si la ultima incluida anterior esta fija", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    excludedCapabilities: ["200::INSPECCION"],
    selectedOts: ["300"],
    operations: [
      {
        id: "fixed", ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN",
        planStatus: "COMPLETADA_PLAN", locked: true, operador: "OP 1", tiempoProd: 120,
        fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00",
      },
      { id: "middle", ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "last", ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "300" }],
    matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-13",
    horizonDays: 5,
    executionTime: "2026-07-13T07:00:00",
  });
  const fixed = result.operations.find((operation) => operation.id === "fixed");
  const last = result.operations.find((operation) => operation.id === "last");

  assert.ok(last.fechaInicio, JSON.stringify(result.lastSchedule.diagnostics));
  assert.ok(
    new Date(`${last.fechaInicio}T${last.horaInicio}:00`) >= new Date(`${fixed.fechaFin}T${fixed.horaFin}:00`),
  );
});

test("un antecedente fijo que cruza tiempo no laborable limita por su fin real", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    excludedCapabilities: ["200::INSPECCION"],
    selectedOts: ["300"],
    operations: [
      {
        id: "fixed-weekend", ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN",
        planStatus: "COMPLETADA_PLAN", locked: true, operador: "OP 1", tiempoProd: 120,
        fechaInicio: "2026-07-17", horaInicio: "16:00", fechaFin: "2026-07-20", horaFin: "08:00",
      },
      { id: "middle-weekend", ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "last-weekend", ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "300" }],
    matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-17",
    horizonDays: 5,
    executionTime: "2026-07-17T07:00:00",
  });
  const last = result.operations.find((operation) => operation.id === "last-weekend");

  assert.deepEqual([last.fechaInicio, last.horaInicio], ["2026-07-20", "08:00"]);
});

test("un solapamiento parcial usa la duracion productiva del antecedente fijo", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    excludedCapabilities: ["200::INSPECCION"],
    selectedOts: ["300"],
    operations: [
      {
        id: "fixed-partial", ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN",
        planStatus: "COMPLETADA_PLAN", locked: true, operador: "OP 1", tiempoProd: 120,
        fechaInicio: "2026-07-17", horaInicio: "16:00", fechaFin: "2026-07-20", horaFin: "08:00",
      },
      { id: "middle-partial", ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "last-partial", ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "300" }],
    matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
    operationRules: { "100::CORTE": { overlap: 0.5 } },
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-17",
    horizonDays: 5,
    executionTime: "2026-07-17T07:00:00",
  });
  const last = result.operations.find((operation) => operation.id === "last-partial");

  assert.deepEqual([last.fechaInicio, last.horaInicio], ["2026-07-20", "07:00"]);
});

test("un solapamiento parcial sin duracion productiva respeta el fin fijo", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    excludedCapabilities: ["200::INSPECCION"],
    selectedOts: ["300"],
    operations: [
      {
        id: "fixed-no-duration", ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN",
        planStatus: "COMPLETADA_PLAN", locked: true, operador: "OP 1",
        fechaInicio: "2026-07-17", horaInicio: "16:00", fechaFin: "2026-07-20", horaFin: "08:00",
      },
      { id: "middle-no-duration", ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "last-no-duration", ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "300" }],
    matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
    operationRules: { "100::CORTE": { overlap: 0.5 } },
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-17",
    horizonDays: 5,
    executionTime: "2026-07-17T07:00:00",
  });
  const last = result.operations.find((operation) => operation.id === "last-no-duration");

  assert.deepEqual([last.fechaInicio, last.horaInicio], ["2026-07-20", "08:00"]);
});

test("un hito parcial nunca supera el fin real del antecedente fijo", () => {
  const core = loadPlannerCore();
  const starts = [0.5, 1].map((overlap) => {
    const result = core.schedulePlan({
      excludedCapabilities: ["200::INSPECCION"],
      selectedOts: ["300"],
      operations: [
        {
          id: `fixed-${overlap}`, ot: "300", secuencia: 1, ct: "100", descripcion: "CORTE", estatus: "PLAN",
          planStatus: "COMPLETADA_PLAN", locked: true, operador: "OP 1", tiempoProd: 180,
          fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00",
        },
        { id: `middle-${overlap}`, ot: "300", secuencia: 2, ct: "200", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 30 },
        { id: `last-${overlap}`, ot: "300", secuencia: 3, ct: "300", descripcion: "EMPAQUE", estatus: "PLAN", tiempoProd: 20 },
      ],
      workOrders: [{ ot: "300" }],
      matrix: { "100::CORTE": ["OP 1"], "300::EMPAQUE": ["OP 2"] },
      configuredCapabilities: ["100::CORTE", "300::EMPAQUE"],
      operationRules: { "100::CORTE": { overlap } },
      operators: ["OP 1", "OP 2"],
      settings: { optimizationPasses: 1 },
      workSchedule: {},
    }, {
      planStart: "2026-07-13",
      horizonDays: 5,
      executionTime: "2026-07-13T07:00:00",
    });
    const last = result.operations.find((operation) => operation.id === `last-${overlap}`);
    return [last.fechaInicio, last.horaInicio];
  });

  assert.deepEqual(starts, [
    ["2026-07-13", "08:00"],
    ["2026-07-13", "08:00"],
  ]);
});

test("nextResourceAvailability ignora intervalos de operaciones excluidas", () => {
  const core = loadPlannerCore();
  const availability = core.nextResourceAvailability({
    excludedCapabilities: ["999::SIN_CONFIGURAR"],
    selectedOts: ["100"],
    planStart: "2026-07-13",
    horizonDays: 5,
    operations: [{
      id: "excluded-blocker", ot: "100", secuencia: 1, ct: "999", descripcion: "SIN CONFIGURAR",
      estatus: "PLAN", locked: true, operador: "OP 1",
      fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00",
    }],
    workSchedule: {},
  }, "OP 1", "", "2026-07-13");

  assert.equal(availability?.getHours(), 7);
});

test("un subcontrato puede terminar despues del horizonte visible", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{
      id: "ot-1325-maka",
      ot: "1325",
      secuencia: 1,
      ct: "519",
      descripcion: "MAKA",
      tipoInsercion: "SUBCONTRATO",
      estatus: "PLAN",
    }],
    workOrders: [{ ot: "1325", item: "CCA 519 CM" }],
    otConfigurations: {
      1325: { ot: "1325", subcontractType: "MAKA", subcontractDays: 15 },
    },
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-13",
    horizonDays: 15,
    executionTime: "2026-07-13T14:50:00",
  });

  const operation = result.operations.find((item) => item.id === "ot-1325-maka");
  assert.equal(operation.fechaInicio, "2026-07-13");
  assert.equal(operation.horaInicio, "14:50");
  assert.equal(operation.fechaFin, "2026-08-03");
  assert.equal(operation.horaFin, "07:00");
});

test("una sucesora nunca viola el fin real de un subcontrato fuera del horizonte", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [
      { id: "sub", ot: "1325", secuencia: 1, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", estatus: "PLAN" },
      { id: "prod", ot: "1325", secuencia: 2, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoCiclo: 1, cantidadPendiente: 1 },
    ],
    workOrders: [{ ot: "1325", item: "CCA 519 CM" }],
    otConfigurations: { 1325: { ot: "1325", subcontractType: "MAKA", subcontractDays: 15 } },
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    operationRules: { 519: { overlap: 0.25 } },
    settings: { optimizationPasses: 1, finiteCapacity: false },
    workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const subcontract = result.operations.find((item) => item.id === "sub");
  const successor = result.operations.find((item) => item.id === "prod");
  const subcontractEnd = new Date(`${subcontract.fechaFin}T${subcontract.horaFin}:00`);
  const successorStart = successor.fechaInicio && new Date(`${successor.fechaInicio}T${successor.horaInicio}:00`);
  assert.ok(subcontractEnd > new Date("2026-07-18T07:00:00"));
  assert.ok(successorStart, "el horizonte visual no debe impedir programar la sucesora");
  assert.ok(successorStart >= subcontractEnd, "un subcontrato exige precedencia completa aunque configure overlap menor a 1");
});

test("OT tipo 1325 respeta secuencia despues de subcontrato largo", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["1325"],
    operations: [
      { id: "seq-10", ot: "1325", secuencia: 10, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
      { id: "seq-11", ot: "1325", secuencia: 11, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
      { id: "seq-12-sub", ot: "1325", secuencia: 12, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", estatus: "PLAN" },
      { id: "seq-13", ot: "1325", secuencia: 13, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
      { id: "seq-14", ot: "1325", secuencia: 14, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
    ],
    workOrders: [{ ot: "1325", item: "CCA 519 CM" }],
    otConfigurations: { 1325: { ot: "1325", subcontractType: "MAKA", subcontractDays: 15 } },
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1, finiteCapacity: false },
    workSchedule: {},
  }, { planStart: "2026-08-10", horizonDays: 5, executionTime: "2026-08-10T07:00:00" });

  const sub = result.operations.find((item) => item.id === "seq-12-sub");
  const seq13 = result.operations.find((item) => item.id === "seq-13");
  const seq14 = result.operations.find((item) => item.id === "seq-14");
  assert.deepEqual([sub.fechaInicio, sub.horaInicio, sub.fechaFin, sub.horaFin], ["2026-08-10", "07:02", "2026-08-31", "07:00"]);
  assert.ok(new Date(`${seq13.fechaInicio}T${seq13.horaInicio}:00`) >= new Date(`${sub.fechaFin}T${sub.horaFin}:00`));
  assert.ok(new Date(`${seq14.fechaInicio}T${seq14.horaInicio}:00`) >= new Date(`${seq13.fechaFin}T${seq13.horaFin}:00`));
});

test("una movible respeta la operacion anterior incluida con fin real mas tardio aunque haya secuencias completadas intermedias", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["1325"],
    operations: [
      {
        id: "completed-long", ot: "1325", secuencia: 10, ct: "SUB", descripcion: "SUBCONTRATO LARGO",
        estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "SUBCONTRATO",
        fechaInicio: "2026-08-10", horaInicio: "07:00", fechaFin: "2026-08-31", horaFin: "07:00", tiempoProd: 30240,
      },
      {
        id: "completed-short", ot: "1325", secuencia: 11, ct: "CORTE", descripcion: "CORTE YA REPORTADO",
        estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "OP 1",
        fechaInicio: "2026-08-10", horaInicio: "07:01", fechaFin: "2026-08-10", horaFin: "07:02", tiempoProd: 1,
      },
      { id: "pending-after-completed", ot: "1325", secuencia: 12, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
    ],
    workOrders: [{ ot: "1325" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1, finiteCapacity: false },
    workSchedule: {},
  }, { planStart: "2026-08-10", horizonDays: 5, executionTime: "2026-08-10T07:00:00" });

  const pending = result.operations.find((item) => item.id === "pending-after-completed");
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-08-31", "07:00"]);
});

test("una completada conserva fechas y no consume capacidad pendiente", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [
      { id: "done", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "OP 1", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoCiclo: 1, cantidadPendiente: 300 },
      { id: "pending", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "PENDIENTE", operador: "OP 1", tiempoSetup: 0, tiempoCiclo: 1, cantidadPendiente: 1 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const done = result.operations.find((item) => item.id === "done");
  const pending = result.operations.find((item) => item.id === "pending");
  assert.deepEqual([done.fechaInicio, done.horaInicio, done.fechaFin, done.horaFin], ["2026-07-13", "07:00", "2026-07-13", "12:00"]);
  assert.equal(result.lastSchedule.scheduled, 1);
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "07:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("una operacion fantasma no seleccionada no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "ghost", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoProd: 300 },
      { id: "selected", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const selected = result.operations.find((item) => item.id === "selected");
  assert.deepEqual([selected.fechaInicio, selected.horaInicio], ["2026-07-13", "07:00"]);
  assert.deepEqual([...result.lastSchedule.scheduledOts], ["200"]);
  assert.ok(result.operations.some((item) => item.id === "ghost"));
});

test("un cambio antiguo pendiente desaparece y no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "old-change", ot: "200", secuencia: 0, ct: "TOOL_CHANGE", descripcion: "CAMBIO DE HERRAMENTAL", tipoInsercion: "CAMBIO_HERRAMENTAL", estatus: "PLAN", planStatus: "PENDIENTE", generatedBy: "PLANNER_CORE_V2", locked: true, operador: "AJUSTADOR", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoSetup: 120 },
      { id: "selected", ot: "200", secuencia: 1, ct: "AJUSTE", descripcion: "AJUSTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "AJUSTADOR", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { AJUSTE: ["AJUSTADOR"] }, operators: ["AJUSTADOR"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const selected = result.operations.find((item) => item.id === "selected");
  assert.equal(result.operations.some((item) => item.id === "old-change"), false);
  assert.deepEqual([selected.fechaInicio, selected.horaInicio], ["2026-07-13", "07:00"]);
});

test("un cambio antiguo completado permanece pero no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "old-completed-change", ot: "100", secuencia: 1, ct: "TOOL_CHANGE", descripcion: "CAMBIO DE HERRAMENTAL", tipoInsercion: "CAMBIO_HERRAMENTAL", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", generatedBy: "PLANNER_CORE_V2", operador: "AJUSTADOR", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoSetup: 120 },
      { id: "pending", ot: "200", secuencia: 1, ct: "AJUSTE", descripcion: "AJUSTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "PENDIENTE", operador: "AJUSTADOR", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { AJUSTE: ["AJUSTADOR"] }, operators: ["AJUSTADOR"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const completed = result.operations.find((item) => item.id === "old-completed-change");
  const pending = result.operations.find((item) => item.id === "pending");
  assert.ok(completed);
  assert.deepEqual([completed.fechaInicio, completed.horaInicio, completed.fechaFin, completed.horaFin], ["2026-07-13", "07:00", "2026-07-13", "09:00"]);
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "07:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("una OT seleccionada y bloqueada conserva su asignacion y reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    operations: [
      { id: "locked", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", locked: true, operador: "OP 1", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 60 },
      { id: "movable", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T08:00:00" });

  const locked = result.operations.find((item) => item.id === "locked");
  const movable = result.operations.find((item) => item.id === "movable");
  assert.deepEqual(
    [locked.fechaInicio, locked.horaInicio, locked.fechaFin, locked.horaFin, locked.operador, locked.maquina],
    ["2026-07-13", "08:00", "2026-07-13", "09:00", "OP 1", "M1"],
  );
  const lockedStart = new Date(`${locked.fechaInicio}T${locked.horaInicio}:00`);
  const lockedEnd = new Date(`${locked.fechaFin}T${locked.horaFin}:00`);
  const movableStart = new Date(`${movable.fechaInicio}T${movable.horaInicio}:00`);
  const movableEnd = new Date(`${movable.fechaFin}T${movable.horaFin}:00`);
  assert.ok(movableEnd <= lockedStart || movableStart >= lockedEnd, "la OT movible no debe solaparse con el bloqueo");
});

test("operaciones no finitas simultaneas no generan conflicto de operador", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2159", "1325"],
    operations: [
      { id: "op-2159", ot: "2159", secuencia: 1, ct: "NOFIN", descripcion: "INSPECCION", estatus: "PLAN", operador: "OPERADOR 2", tiempoSetup: 0, tiempoProd: 20 },
      { id: "op-1325", ot: "1325", secuencia: 1, ct: "NOFIN", descripcion: "INSPECCION", estatus: "PLAN", operador: "OPERADOR 2", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "2159" }, { ot: "1325" }],
    matrix: { NOFIN: ["OPERADOR 2"] }, operators: ["OPERADOR 2"],
    capacityModes: { NOFIN: "NO_FINITA" },
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const first = result.operations.find((item) => item.id === "op-2159");
  const second = result.operations.find((item) => item.id === "op-1325");
  assert.deepEqual([first.fechaInicio, first.horaInicio], ["2026-07-13", "07:00"]);
  assert.deepEqual([second.fechaInicio, second.horaInicio], ["2026-07-13", "07:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("registra la operacion bloqueadora que causa la espera", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    operations: [
      { id: "locked", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 120 },
      { id: "pending", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const pending = result.operations.find((item) => item.id === "pending");
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "09:00"]);
  assert.equal(pending.esperaMinutos, 120);
  assert.equal(pending.causaEspera, "OPERADOR");
  assert.equal(pending.recursoEspera, "OP 1");
  assert.equal(pending.otBloqueadora, "100");
  assert.equal(pending.secuenciaBloqueadora, 1);
});

test("sin espera registra diagnostico vacio", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{ id: "pending", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 }],
    workOrders: [{ ot: "200" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const pending = result.operations.find((item) => item.id === "pending");
  assert.equal(pending.esperaMinutos, 0);
  assert.equal(pending.causaEspera, "");
});

test("una pausa intermedia extiende el intervalo sin aumentar tiempo productivo", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{ id: "pause", ot: "500", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 }],
    workOrders: [{ ot: "500" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
    dailyBreaks: { pause: { enabled: true, start: "15:00", end: "15:05" } },
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T14:50:00" });

  const operation = result.operations.find((item) => item.id === "pause");
  assert.deepEqual([operation.fechaInicio, operation.horaInicio, operation.fechaFin, operation.horaFin], ["2026-07-13", "14:50", "2026-07-13", "15:15"]);
  assert.equal(core.operationDuration(operation, 100, 100), 20);
});

test("una operacion iniciada al cierre del viernes termina el lunes", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{ id: "weekend", ot: "600", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 }],
    workOrders: [{ ot: "600" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 },
    workSchedule: {
      MON: { enabled: true, start: "07:00", end: "17:00" }, FRI: { enabled: true, start: "07:00", end: "17:00" },
      SAT: { enabled: false, start: "07:00", end: "17:00" }, SUN: { enabled: false, start: "07:00", end: "17:00" },
    },
  }, { planStart: "2026-07-17", horizonDays: 5, executionTime: "2026-07-17T16:50:00" });

  const operation = result.operations.find((item) => item.id === "weekend");
  assert.deepEqual([operation.fechaInicio, operation.horaInicio, operation.fechaFin, operation.horaFin], ["2026-07-17", "16:50", "2026-07-20", "07:10"]);
  assert.equal(core.operationDuration(operation, 100, 100), 20);
});

test("un limite de calendario posterior al conflicto corto determina la espera", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      { id: "short", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00", tiempoProd: 60 },
      { id: "pending", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"], settings: { optimizationPasses: 1 }, workSchedule: {},
    calendarExceptions: [{ date: "2026-07-13", concept: "OPERADOR", resource: "OP 1", start: "07:00", end: "09:00" }],
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const pending = result.operations.find((item) => item.id === "pending");
  assert.equal(pending.horaInicio, "09:00");
  assert.equal(pending.causaEspera, "CALENDARIO");
  assert.equal(pending.otBloqueadora, "");
  assert.equal(pending.secuenciaBloqueadora, "");
});

test("registra una maquina como causa de espera", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      { id: "machine-lock", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", locked: true, operador: "OP A", maquina: "M1", herramental: "H1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 120 },
      { id: "pending", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", operador: "OP B", maquina: "M1", herramental: "H1", tiempoProd: 20 },
    ], workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OP A", "OP B", "AJUSTADOR"], matrix: { "5459::DOBLEZ": ["OP A", "OP B"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] }, configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const pending = result.operations.find((item) => item.id === "pending");
  assert.ok(pending?.fechaInicio, JSON.stringify({ operations: result.operations, diagnostics: result.lastSchedule.diagnostics }));
  assert.equal(pending.causaEspera, "MAQUINA");
  assert.equal(pending.recursoEspera, "M1");
  assert.equal(pending.otBloqueadora, "100");
});

test("un cambio requerido determina la espera antes de produccion", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      { id: "prior", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", locked: true, operador: "OP B", maquina: "M1", herramental: "H1", fechaInicio: "2026-07-13", horaInicio: "06:00", fechaFin: "2026-07-13", horaFin: "07:00", tiempoProd: 60 },
      { id: "pending", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", operador: "OP B", maquina: "M1", herramental: "H2", tiempoProd: 20 },
    ], workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OP B", "AJUSTADOR"], matrix: { "5459::DOBLEZ": ["OP B"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] }, configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"], settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const pending = result.operations.find((item) => item.id === "pending");
  assert.equal(pending.esperaMinutos, 30);
  assert.equal(pending.causaEspera, "CAMBIO_HERRAMENTAL");
  assert.equal(pending.otBloqueadora, "");
});

test("entre bloqueadores simultaneos elige el que determina el inicio", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "101", "200"], lockedOts: ["100", "101"],
    operations: [
      { id: "operator-lock", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP B", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00", tiempoProd: 60 },
      { id: "machine-lock", ot: "101", secuencia: 2, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", locked: true, operador: "OP A", maquina: "M1", herramental: "H1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 120 },
      { id: "pending", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", operador: "OP B", maquina: "M1", herramental: "H1", tiempoProd: 20 },
    ], workOrders: [{ ot: "100" }, { ot: "101" }, { ot: "200" }], operators: ["OP A", "OP B", "AJUSTADOR"], matrix: { CORTE: ["OP B"], "5459::DOBLEZ": ["OP B"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] }, configuredCapabilities: ["CORTE::CORTE", "5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const pending = result.operations.find((item) => item.id === "pending");
  assert.ok(pending?.fechaInicio, JSON.stringify({ operations: result.operations, diagnostics: result.lastSchedule.diagnostics }));
  assert.equal(pending.causaEspera, "MAQUINA");
  assert.equal(pending.otBloqueadora, "101");
  assert.equal(pending.secuenciaBloqueadora, 2);
});

test("la produccion se calcula como TC por piezas aunque NetSuite envie otro tiempo", () => {
  const core = loadPlannerCore();
  const operation = {
    tiempoCiclo: 1.5,
    cantidadPendiente: 30,
    tiempoSetup: 15,
    tiempoProd: 15,
  };
  assert.equal(core.productionMinutes(operation), 45);
  assert.equal(core.operationDuration(operation, 100, 100), 60);
});

test("la capacidad programada conserva un segundo solo con la marca de fallback", () => {
  const core = loadPlannerCore();

  assert.equal(core.operationDuration({ tiempoProd: 1 / 60, tiempoFallback: true }, 100, 100), 1 / 60);
  assert.equal(core.operationDuration({ tiempoProd: 0.5 }, 100, 100), 1);
});

test("una operacion marcada como fallback conserva setup fraccional y un segundo", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{
      id: "setup-fallback", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE",
      estatus: "PLAN", operador: "OP 1", tiempoSetup: 0.5, tiempoProd: 1 / 60, tiempoFallback: true,
    }],
    workOrders: [{ ot: "100" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const operation = result.operations.find((item) => item.id === "setup-fallback");
  assert.deepEqual(
    [operation.fechaInicio, operation.horaInicio, operation.fechaFin, operation.horaFin],
    ["2026-07-13", "07:00", "2026-07-13", "07:00:31"],
  );
});

test("un setup de un segundo sin fallback conserva el redondeo de produccion normal", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{
      id: "normal-one-second-setup", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE",
      estatus: "PLAN", operador: "OP 1", tiempoSetup: 1 / 60, tiempoProd: 1,
    }],
    workOrders: [{ ot: "100" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const operation = result.operations.find((item) => item.id === "normal-one-second-setup");
  assert.equal(operation.horaFin, "07:02");
});

test("una asignacion bloqueada conserva segundos y bloquea la recarga siguiente", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      {
        id: "fixed-fallback", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE",
        estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 1 / 60,
        fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "07:00:01",
      },
      { id: "pending-after-fallback", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 1 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }], matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const fixed = result.operations.find((item) => item.id === "fixed-fallback");
  const pending = result.operations.find((item) => item.id === "pending-after-fallback");
  assert.equal(fixed.horaFin, "07:00:01");
  assert.equal(pending.horaInicio, "07:01");
});

test("el motor toma el herramental guardado en la configuracion de la OT", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2433"],
    operations: [{ id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", estatus: "PLAN", maquina: "211", herramental: "5 x 6", tiempoCiclo: 1, cantidadPendiente: 1 }],
    workOrders: [{ ot: "2433" }],
    otConfigurations: { "2433": { ot: "2433", machine: "211", herramental: "4 x 5" } },
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA"], operators: ["OPERADOR 2"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  assert.equal(result.operations.find((op) => op.id === "bend-2433").herramental, "4 x 5");
});

test("la validacion usa herramental persistido en configuracion de la OT", () => {
  const core = loadPlannerCore();
  const issues = core.planningConfigurationIssues({
    selectedOts: ["2433"],
    operations: [{ id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", estatus: "PLAN", maquina: "211", herramental: "", tiempoCiclo: 1, cantidadPendiente: 1 }],
    otConfigurations: { "2433": { ot: "2433", machine: "211", herramental: "4 x 5" } },
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA"],
    operators: ["OPERADOR 2"],
    workSchedule: {},
  }, [{ id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", estatus: "PLAN", maquina: "211", herramental: "", tiempoCiclo: 1, cantidadPendiente: 1 }]);
  assert.equal(issues.some((issue) => issue.code === "MISSING_TOOL"), false);
});

test("la validacion usa dias y tipo de subcontrato persistidos por OT", () => {
  const core = loadPlannerCore();
  const operation = { id: "sub-100", ot: "100", secuencia: 2, ct: "SUB", descripcion: "CROMADO", contenido: "SUBCONTRATO", estatus: "PLAN", subcontractType: "", subcontractDays: 0, tiempoProd: 0 };
  const issues = core.planningConfigurationIssues({
    selectedOts: ["100"],
    operations: [operation],
    otConfigurations: { "100": { ot: "100", subcontractType: "CROMADO", subcontractDays: 3 } },
    matrix: {},
    configuredCapabilities: [],
    operators: [],
    workSchedule: {},
  }, [operation]);
  assert.equal(issues.some((issue) => issue.code === "MISSING_SUBCONTRACT_TYPE"), false);
  assert.equal(issues.some((issue) => issue.code === "MISSING_SUBCONTRACT_DAYS"), false);
});

test("dos doblados en la misma maquina conservan operaciones y generan cambio de herramental", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "bend-a", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLADO A", parte: "A", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "DOBLADORA 2", herramental: "H1", kitHerramental: "K1", tiempoProd: 20 },
    { id: "bend-b", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLADO B", parte: "B", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "DOBLADORA 2", herramental: "H2", kitHerramental: "K2", tiempoProd: 20 },
  ];
  const result = core.schedulePlan({
    operations, workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OPERADOR 1", "OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLADO_A": ["OPERADOR 1"], "5459::DOBLADO_B": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLADO_A", "5459::DOBLADO_B", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const productive = result.operations.filter((op) => ["bend-a", "bend-b"].includes(op.id));
  const changes = result.operations.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");
  assert.equal(productive.length, 2);
  assert.ok(productive.every((op) => op.fechaInicio && op.fechaFin), "ambos doblados deben quedar programados");
  assert.deepEqual(new Set(productive.map((op) => op.operador)), new Set(["OPERADOR 1", "OPERADOR 2"]));
  assert.ok(changes.length >= 1);
  assert.ok(changes.every((change) => change.operador === "AJUSTADOR" && change.maquina === "DOBLADORA 2"));
  const transition = changes.find((change) => change.toolChangeFromHerramental && change.toolChangeToHerramental && change.toolChangeFromHerramental !== change.toolChangeToHerramental);
  assert.ok(transition, "debe existir la transicion real entre H1 y H2");
  const changedProduct = productive.find((op) => op.herramental === transition.toolChangeToHerramental);
  assert.ok(new Date(`${changedProduct.fechaInicio}T${changedProduct.horaInicio}:00`) >= new Date(`${transition.fechaFin}T${transition.horaFin}:00`));
});

test("dos herramentales sin kit generan cambio aunque el catalogo tenga duracion cero", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "AM M66-2843", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "211", herramental: "4 x 5", tiempoCiclo: 1.5, cantidadPendiente: 30, tiempoSetup: 15 },
    { id: "bend-2436", ot: "2436", secuencia: 2, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "AM 17123-002", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "211", herramental: "5 x 6", tiempoCiclo: 4, cantidadPendiente: 48, tiempoSetup: 12 },
  ];
  const result = core.schedulePlan({
    selectedOts: ["2433", "2436"], operations, workOrders: [{ ot: "2433" }, { ot: "2436" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [
      { part: "AM M66-2843", herramental: "4 x 5", toolSetupMinutes: 0, active: true },
      { part: "AM 17123-002", herramental: "5 x 6", toolSetupMinutes: 0, active: true },
    ],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const change = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeFromHerramental === "4 x 5" && op.toolChangeToHerramental === "5 x 6");
  assert.ok(change, "debe proyectar el cambio 4 x 5 a 5 x 6");
  assert.equal(change.tiempoSetup, 30);
});

test("balanceo prefiere agrupar doblados con herramental montado en la misma maquina", () => {
  const core = loadPlannerCoreWithSinglePass();
  const operations = [
    { id: "prev-a", ot: "100", secuencia: 1, ct: "100", descripcion: "PREVIO", estatus: "PLAN", operationState: "COMPLETADA", fechaInicio: "2026-07-13", horaInicio: "06:00", fechaFin: "2026-07-13", horaFin: "06:10", tiempoProd: 10 },
    { id: "prev-b", ot: "200", secuencia: 1, ct: "100", descripcion: "PREVIO", estatus: "PLAN", operationState: "COMPLETADA", fechaInicio: "2026-07-13", horaInicio: "06:00", fechaFin: "2026-07-13", horaFin: "06:10", tiempoProd: 10 },
    { id: "change-first", ot: "100", secuencia: 2, ct: "5459", descripcion: "DOBLEZ", parte: "A", estatus: "PLAN", maquina: "211", herramental: "H2", tiempoProd: 5 },
    { id: "keep-mounted", ot: "200", secuencia: 2, ct: "5459", descripcion: "DOBLEZ", parte: "B", estatus: "PLAN", maquina: "211", herramental: "H1", tiempoProd: 40 },
  ];
  const state = {
    selectedOts: ["100", "200"], operations, workOrders: [{ ot: "100" }, { ot: "200" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    operationPlanStatuses: [{ ot: "200", status: "COMPLETADA_PLAN", machine: "211", toToolKey: "H1/SIN_KIT" }],
    settings: { toolChangeMinutes: 30 }, workSchedule: {},
  };

  for (const strategy of ["balanced", "flow_balanced", "tools"]) {
    const result = core.schedulePlanOnce(state, { strategy, planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
    const scheduled = result.operations
      .filter((op) => ["change-first", "keep-mounted"].includes(op.id))
      .sort((a, b) => new Date(`${a.fechaInicio}T${a.horaInicio}:00`) - new Date(`${b.fechaInicio}T${b.horaInicio}:00`));
    assert.equal(scheduled[0].id, "keep-mounted", strategy);
  }
});

test("un herramental adicional genera una operacion artificial de doblado con capacidad propia", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200", "300"],
    operations: [
      { id: "bend-a", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", maquina: "211", herramental: "H1", additionalHerramentales: ["H2"], tiempoSetup: 3, tiempoProd: 10 },
      { id: "bend-b", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", maquina: "211", herramental: "H3", tiempoProd: 10 },
      { id: "cut-after", ot: "100", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 5 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }, { ot: "300" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "CORTE::CORTE": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "CORTE::CORTE", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
  const artificial = result.operations.find((op) => op.generatedAdditionalTool === true);
  const base = result.operations.find((op) => op.id === "bend-a");
  const successor = result.operations.find((op) => op.id === "cut-after");
  assert.equal(artificial.herramental, "H2");
  assert.equal(artificial.maquina, "211");
  assert.equal(artificial.tiempoSetup, 3);
  assert.equal(artificial.tiempoProd, 10);
  assert.equal(artificial.ct, "5459");
  assert.equal(artificial.operador, "OPERADOR 2");
  assert.ok(new Date(`${artificial.fechaInicio}T${artificial.horaInicio}:00`) >= new Date(`${base.fechaFin}T${base.horaFin}:00`));
  assert.ok(new Date(`${successor.fechaInicio}T${successor.horaInicio}:00`) >= new Date(`${artificial.fechaFin}T${artificial.horaFin}:00`));
  assert.ok(result.operations.some((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeToHerramental === "H2"));
});

test("un herramental adicional puede usar una maquina propia y legacy sigue heredando", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100"],
    operations: [
      { id: "bend-a", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", maquina: "211", herramental: "H1", additionalHerramentales: [{ herramental: "H2", machine: "212" }, "H3"], tiempoProd: 10 },
    ],
    workOrders: [{ ot: "100" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
  const artificial = result.operations.filter((op) => op.generatedAdditionalTool === true).sort((a, b) => a.secuencia - b.secuencia);
  assert.deepEqual(structuredClone(artificial.map((op) => [op.herramental, op.maquina])), [["H2", "212"], ["H3", "211"]]);
});

test("un doblado sin parte en la operacion hereda el herramental usando el articulo de la OT", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2159", "2436"],
    operations: [
      { id: "bend-2159", ot: "2159", secuencia: 2, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "", estatus: "PLAN", maquina: "211", tiempoCiclo: 1.33, cantidadPendiente: 35 },
      { id: "bend-2436", ot: "2436", secuencia: 2, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "AM 17123-002", estatus: "PLAN", maquina: "211", herramental: "5 x 6", tiempoCiclo: 4, cantidadPendiente: 48 },
    ],
    workOrders: [{ ot: "2159", item: "C 490 UND" }, { ot: "2436", item: "AM 17123-002" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [
      { part: "C 490 UND", herramental: "4 x 5", active: true },
      { part: "AM 17123-002", herramental: "5 x 6", active: true },
    ],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-14", horizonDays: 5, executionTime: "2026-07-14T07:00:00" });

  assert.equal(result.operations.find((op) => op.id === "bend-2159").herramental, "4 x 5");
  assert.ok(result.operations.some((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" &&
    op.toolChangeFromHerramental === "4 x 5" && op.toolChangeToHerramental === "5 x 6"));
});

test("un cambio sin tiempo configurado usa el estandar de 120 minutos", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "a", ot: "1", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", parte: "A", estatus: "PLAN", maquina: "211", herramental: "H1", tiempoCiclo: 1, cantidadPendiente: 1 },
    { id: "b", ot: "2", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", parte: "B", estatus: "PLAN", maquina: "211", herramental: "H2", tiempoCiclo: 1, cantidadPendiente: 1 },
  ];
  const result = core.schedulePlan({
    selectedOts: ["1", "2"], operations, workOrders: [{ ot: "1" }, { ot: "2" }], operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [{ part: "A", herramental: "H1", toolSetupMinutes: 0 }, { part: "B", herramental: "H2", toolSetupMinutes: 0 }],
    settings: { optimizationPasses: 1, toolChangeMinutes: 0 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const change = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeFromHerramental === "H1" && op.toolChangeToHerramental === "H2");
  assert.equal(change?.tiempoSetup, 120);
});

test("el primer herramental sin antecedente usa el estandar de 120 minutos", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["1"],
    operations: [
      { id: "initial-bend", ot: "1", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", parte: "A", estatus: "PLAN", maquina: "211", herramental: "H1", tiempoCiclo: 1, cantidadPendiente: 1 },
    ],
    workOrders: [{ ot: "1", item: "A" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [{ part: "A", herramental: "H1", toolSetupMinutes: 0, kitSetupMinutes: 0 }],
    settings: { optimizationPasses: 1, toolChangeMinutes: 0 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const change = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" &&
    !op.toolChangeFromHerramental && op.toolChangeToHerramental === "H1");
  assert.equal(change?.tiempoSetup, 120);
});

test("una fecha vieja del borrador movible no cuenta como antecedente de herramental", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2159"],
    operations: [
      { id: "bend-2159", ot: "2159", secuencia: 10, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "C 490 UND", estatus: "PLAN", maquina: "211", herramental: "4 x 5", tiempoCiclo: 1.33, cantidadPendiente: 35, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "07:57" },
    ],
    workOrders: [{ ot: "2159", item: "C 490 UND" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [{ part: "C 490 UND", herramental: "4 x 5", toolSetupMinutes: 0 }],
    settings: { optimizationPasses: 1, toolChangeMinutes: 120 }, workSchedule: {},
  }, { planStart: "2026-07-14", horizonDays: 5, executionTime: "2026-07-14T07:00:00" });

  const initialChange = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" &&
    !op.toolChangeFromHerramental && op.toolChangeToHerramental === "4 x 5");
  assert.equal(initialChange?.tiempoSetup, 120);
});

test("un plan historico pendiente no cuenta como herramental colocado", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2159"],
    operations: [
      { id: "bend-2159", ot: "2159", secuencia: 10, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "C 490 UND", estatus: "PLAN", maquina: "211", herramental: "4 x 5", tiempoCiclo: 1.33, cantidadPendiente: 35 },
    ],
    machineToolHistory: [
      { id: "published-old", snapshotId: "published-1", ot: "2159", machine: "211", herramental: "4 x 5", endDate: "2026-07-13", endTime: "09:00" },
    ],
    workOrders: [{ ot: "2159", item: "C 490 UND" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [{ part: "C 490 UND", herramental: "4 x 5", toolSetupMinutes: 0 }],
    settings: { optimizationPasses: 1, toolChangeMinutes: 120 }, workSchedule: {},
  }, { planStart: "2026-07-14", horizonDays: 5, executionTime: "2026-07-14T07:00:00" });

  const initialChange = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" &&
    !op.toolChangeFromHerramental && op.toolChangeToHerramental === "4 x 5");
  assert.equal(initialChange?.tiempoSetup, 120);
});

test("un doblado sin recursos conserva identidad y diagnostica maquina y herramental", () => {
  const core = loadPlannerCore();
  const operation = {
    id: "ct-5459-real", ot: "2159", secuencia: 10, ct: "5459", descripcion: "DOBLEZ DE TUBO",
    parte: "C 490 UND", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "", herramental: "", kitHerramental: "",
  };
  const issues = core.planningConfigurationIssues({
    operations: [operation], operators: ["OPERADOR 2"],
    matrix: { "5459::DOBLEZ_DE_TUBO": ["OPERADOR 2"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBO"], machines: [], toolCatalog: [],
  }, [operation]);
  assert.equal(operation.id, "ct-5459-real");
  assert.equal(operation.ot, "2159");
  assert.equal(operation.secuencia, 10);
  assert.ok(issues.some((issue) => issue.code === "MISSING_MACHINE" && issue.operationId === operation.id));
  assert.ok(issues.some((issue) => issue.code === "MISSING_TOOL" && issue.operationId === operation.id));
});

test("la validacion reconstruye el indice de OTs serializado como objeto", () => {
  const core = loadPlannerCore();
  const operation = {
    id: "bend-2786", ot: "2786", secuencia: 10, ct: "5459", descripcion: "DOBLEZ DE TUBO",
    parte: "", estatus: "PLAN", maquina: "211", herramental: "",
  };
  const state = {
    __workOrdersByOt: {},
    workOrders: [{ ot: "2786", item: "E01980780MS" }],
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBO"],
    matrix: { "5459::DOBLEZ_DE_TUBO": ["OPERADOR 2"] },
    operators: ["OPERADOR 2"],
    toolCatalog: [{ part: "E01980780MS", herramental: "H-2786" }],
  };

  const issues = core.planningConfigurationIssues(state, [operation]);

  assert.equal(issues.some((issue) => issue.code === "MISSING_TOOL"), false);
});

test("una operacion sin hueco conserva OT, secuencia y causa diagnostica", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{ id: "missing", ot: "300", secuencia: 7, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", tiempoProd: 20 }],
    workOrders: [{ ot: "300" }], matrix: { "CORTE::CORTE": [] }, operators: [], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
  const diagnostic = result.lastSchedule.diagnostics.find((item) => item.code === "UNSCHEDULED");
  assert.equal(diagnostic.ot, "300");
  assert.equal(diagnostic.sequence, 7);
  assert.match(diagnostic.cause, /operador|capacidad|horizonte/i);
});

test("expone metricas comunes finitas para comparar estrategias", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    operations: [
      { id: "first", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaReq: "2026-07-12", prioridad: 1, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
      { id: "second", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 2", tiempoProd: 60, fechaReq: "2026-07-13", prioridad: 50, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }], matrix: { "CORTE::CORTE": ["OP 1", "OP 2"] }, configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1", "OP 2"], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
  const metrics = result.lastSchedule.optimization.metrics;

  for (const key of ["weightedTardinessMinutes", "averageFlowMinutes", "avoidableIdleMinutes", "toolChanges", "maxWip", "score"]) {
    assert.equal(Number.isFinite(metrics[key]), true, key);
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify({
      weightedTardinessMinutes: metrics.weightedTardinessMinutes,
      averageFlowMinutes: metrics.averageFlowMinutes,
      avoidableIdleMinutes: metrics.avoidableIdleMinutes,
      toolChanges: metrics.toolChanges,
      maxWip: metrics.maxWip,
      resourceUtilization: metrics.resourceUtilization,
    })),
    {
      weightedTardinessMinutes: 90000,
      averageFlowMinutes: 60,
      avoidableIdleMinutes: 0,
      toolChanges: 0,
      maxWip: 2,
      resourceUtilization: { "OPERADOR:OP 1": 1, "OPERADOR:OP 2": 1 },
    },
  );
});

test("flow balanced agrega como maximo una estrategia y conserva el conjunto legado al desactivarse", () => {
  const core = loadPlannerCore();
  const state = {
    operations: [], workOrders: [], settings: { optimizationPasses: 4 }, workSchedule: {},
  };
  const options = { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" };
  const disabled = core.schedulePlan({ ...state, settings: { ...state.settings, flowBalancedEnabled: false } }, options);
  const enabled = core.schedulePlan({ ...state, settings: { ...state.settings, flowBalancedEnabled: true } }, options);
  const disabledNames = disabled.lastSchedule.optimization.strategiesEvaluated.map((item) => item.strategy);
  const enabledNames = enabled.lastSchedule.optimization.strategiesEvaluated.map((item) => item.strategy);

  assert.deepEqual([...disabledNames].sort(), ["balanced", "finish", "idle", "load", "makespan", "tools"]);
  assert.deepEqual([...enabledNames.filter((name) => !disabledNames.includes(name))], ["flow_balanced"]);
  assert.ok(enabledNames.length <= disabledNames.length + 1);
});

test("lastSchedule registra metricas completas por estrategia para auditoria y reversion", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({ operations: [], workOrders: [], settings: { optimizationPasses: 1 }, workSchedule: {} }, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });
  const optimization = result.lastSchedule.optimization;
  const metricKeys = ["operatorConflicts", "unscheduled", "weightedTardinessMinutes", "averageFlowMinutes", "avoidableIdleMinutes", "toolChanges", "score"];

  assert.ok(optimization.strategiesEvaluated.length > 0);
  for (const item of optimization.strategiesEvaluated) {
    assert.ok(item.metrics, item.strategy);
    for (const key of metricKeys) assert.equal(Number.isFinite(item.metrics[key]), true, `${item.strategy}.${key}`);
  }
  assert.deepEqual(
    optimization.strategiesEvaluated.find((item) => item.strategy === optimization.selectedStrategy).metrics,
    optimization.metrics,
  );
});

function legacySelectionFixture(flowBalancedEnabled) {
  return {
    selectedOts: ["100", "101", "102", "103", "104"],
    operations: [
      { id: "o0", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 183, prioridad: 67, fechaReq: "2026-07-13" },
      { id: "o1", ot: "101", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 234, prioridad: 1, fechaReq: "2026-07-13" },
      { id: "o2", ot: "102", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 45, prioridad: 34, fechaReq: "2026-07-13" },
      { id: "o3", ot: "103", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 96, prioridad: 67, fechaReq: "2026-07-13" },
      { id: "o4", ot: "104", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 147, prioridad: 1, fechaReq: "2026-07-13" },
    ],
    workOrders: ["100", "101", "102", "103", "104"].map((ot) => ({ ot })),
    matrix: { "CORTE::CORTE": ["OP 1", "OP 2"] }, configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1", "OP 2"], settings: { optimizationPasses: 3, flowBalancedEnabled }, workSchedule: {},
  };
}

test("desactivar flow balanced conserva operaciones, fechas y recursos existentes", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan(legacySelectionFixture(false), {
    planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00",
  });

  assert.equal(result.lastSchedule.optimization.selectedStrategy, "balanced");
  assert.equal(result.lastSchedule.optimization.strategiesEvaluated.some((item) => item.strategy === "flow_balanced"), false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.operations.map(({ id, operador, fechaInicio, horaInicio, fechaFin, horaFin }) => ({ id, operador, fechaInicio, horaInicio, fechaFin, horaFin })))),
    [
      { id: "o1", operador: "OP 2", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "10:54" },
      { id: "o4", operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:27" },
      { id: "o2", operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "09:27", fechaFin: "2026-07-13", horaFin: "10:12" },
      { id: "o3", operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "10:12", fechaFin: "2026-07-13", horaFin: "11:48" },
      { id: "o0", operador: "OP 2", fechaInicio: "2026-07-13", horaInicio: "10:54", fechaFin: "2026-07-13", horaFin: "13:57" },
    ],
  );
});

test("flow balanced no desplaza al ganador legado con empate de puntuacion", () => {
  const core = loadPlannerCore();
  const options = { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" };
  const legacy = core.schedulePlan(legacySelectionFixture(false), options);
  const enabled = core.schedulePlan(legacySelectionFixture(true), options);
  const legacyMetrics = enabled.lastSchedule.optimization.strategiesEvaluated
    .find((item) => item.strategy === legacy.lastSchedule.optimization.selectedStrategy);
  const flowMetrics = enabled.lastSchedule.optimization.strategiesEvaluated
    .find((item) => item.strategy === "flow_balanced");

  assert.equal(flowMetrics.score, legacyMetrics.score);
  assert.equal(enabled.lastSchedule.optimization.selectedStrategy, legacy.lastSchedule.optimization.selectedStrategy);
});

test("flow balanced conserva subcontrato, exclusiones, completadas, bloqueos y calendario", () => {
  const core = loadPlannerCore();
  const baseState = {
    selectedOts: ["100", "200", "300", "400", "500"],
    lockedOts: ["400"],
    excludedCapabilities: ["999::SIN_CONFIGURAR"],
    operations: [
      { id: "sub", ot: "100", secuencia: 1, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", estatus: "PLAN" },
      { id: "excluded", ot: "200", secuencia: 1, ct: "999", descripcion: "SIN CONFIGURAR", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "17:00" },
      { id: "done", ot: "300", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoProd: 300 },
      { id: "locked", ot: "400", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 60 },
      { id: "pending", ot: "500", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 20 },
    ],
    workOrders: ["100", "200", "300", "400", "500"].map((ot) => ({ ot })),
    otConfigurations: { 100: { ot: "100", subcontractType: "MAKA", subcontractDays: 1 } },
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    calendarExceptions: [{ date: "2026-07-13", concept: "OPERADOR", resource: "OP 1", start: "09:00", end: "10:00" }],
    settings: { optimizationPasses: 1, finiteCapacity: true }, workSchedule: {},
  };
  const options = { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" };

  for (const flowBalancedEnabled of [false, true]) {
    const result = core.schedulePlan({ ...baseState, settings: { ...baseState.settings, flowBalancedEnabled } }, options);
    const byId = Object.fromEntries(result.operations.map((op) => [op.id, op]));
    assert.deepEqual([byId.done.fechaInicio, byId.done.horaInicio, byId.done.fechaFin, byId.done.horaFin], ["2026-07-13", "07:00", "2026-07-13", "12:00"]);
    assert.deepEqual([byId.locked.fechaInicio, byId.locked.horaInicio, byId.locked.fechaFin, byId.locked.horaFin], ["2026-07-13", "08:00", "2026-07-13", "09:00"]);
    assert.equal(byId.pending.horaInicio, "07:00");
    assert.equal(byId.sub.fechaFin, "2026-07-14");
    assert.equal(result.lastSchedule.operatorConflicts, 0);
    assert.equal(result.lastSchedule.diagnostics.some((item) => item.operationId === "excluded"), false);
  }
});

test("flow balanced conserva maquinas, herramentales y capacidad finita o no finita", () => {
  const core = loadPlannerCore();
  const options = { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" };
  const finiteState = {
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      { id: "prior", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", locked: true, operador: "OP B", maquina: "M1", herramental: "H1", fechaInicio: "2026-07-13", horaInicio: "06:00", fechaFin: "2026-07-13", horaFin: "07:00", tiempoProd: 60 },
      { id: "pending-bend", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", operador: "OP B", maquina: "M1", herramental: "H2", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OP B", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OP B"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, finiteCapacity: true, toolChangeMinutes: 30 }, workSchedule: {},
  };
  const nonFiniteState = {
    selectedOts: ["300", "400"],
    operations: ["300", "400"].map((ot) => ({ id: `nonfinite-${ot}`, ot, secuencia: 1, ct: "NOFIN", descripcion: "INSPECCION", estatus: "PLAN", tiempoProd: 20 })),
    workOrders: [{ ot: "300" }, { ot: "400" }], matrix: { NOFIN: ["OP N"] }, operators: ["OP N"],
    capacityModes: { NOFIN: "NO_FINITA" }, settings: { optimizationPasses: 1 }, workSchedule: {},
  };

  for (const flowBalancedEnabled of [false, true]) {
    const finite = core.schedulePlan({ ...finiteState, settings: { ...finiteState.settings, flowBalancedEnabled } }, options);
    const bend = finite.operations.find((op) => op.id === "pending-bend");
    const change = finite.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeToHerramental === "H2");
    assert.ok(change);
    assert.equal(bend.maquina, "M1");
    assert.ok(new Date(`${bend.fechaInicio}T${bend.horaInicio}:00`) >= new Date(`${change.fechaFin}T${change.horaFin}:00`));
    assert.equal(finite.lastSchedule.operatorConflicts, 0);

    const nonFinite = core.schedulePlan({ ...nonFiniteState, settings: { ...nonFiniteState.settings, flowBalancedEnabled } }, options);
    assert.deepEqual([...nonFinite.operations.map((op) => op.horaInicio)], ["07:00", "07:00"]);
    assert.equal(nonFinite.lastSchedule.operatorConflicts, 0);
  }
});

test("las metricas no cuentan como evitable la espera obligatoria por cambio de herramental", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"], lockedOts: ["100"],
    operations: [
      { id: "prior", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", locked: true, operador: "OP B", maquina: "M1", herramental: "H1", fechaInicio: "2026-07-13", horaInicio: "06:00", fechaFin: "2026-07-13", horaFin: "07:00", tiempoProd: 60 },
      { id: "pending", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", estatus: "PLAN", operador: "OP B", maquina: "M1", herramental: "H2", tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OP B", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OP B"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const metrics = result.lastSchedule.optimization.metrics;

  assert.equal(metrics.avoidableIdleMinutes, 0);
  assert.equal(metrics.toolChanges, 1);
});

test("las metricas cuentan trabajo diferido que cabe en un hueco disponible", () => {
  const core = loadPlannerCore();
  const metrics = core.evaluatePlan({
    lockedOts: ["100", "101"],
    operations: [
      { id: "before-gap", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
      { id: "after-gap", ot: "101", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
      { id: "deferred", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 30, fechaInicio: "2026-07-13", horaInicio: "10:00", fechaFin: "2026-07-13", horaFin: "10:30" },
    ],
    workOrders: [{ ot: "100" }, { ot: "101" }, { ot: "200" }],
    matrix: { "CORTE::CORTE": ["OP 1"] }, configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1"], settings: {}, workSchedule: {}, lastSchedule: { changes: 0, unscheduled: 0, operatorConflicts: 0 },
  });

  assert.equal(metrics.avoidableIdleMinutes, 30);
});

test("las metricas no reutilizan una operacion diferida entre dos huecos", () => {
  const core = loadPlannerCore();
  const metrics = core.evaluatePlan({
    lockedOts: ["100", "101", "102"],
    operations: [
      { id: "before-first-gap", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
      { id: "between-gaps", ot: "101", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
      { id: "after-second-gap", ot: "102", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "11:00", fechaFin: "2026-07-13", horaFin: "12:00" },
      { id: "deferred", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 30, fechaInicio: "2026-07-13", horaInicio: "12:00", fechaFin: "2026-07-13", horaFin: "12:30" },
    ],
    workOrders: ["100", "101", "102", "200"].map((ot) => ({ ot })),
    matrix: { "CORTE::CORTE": ["OP 1"] }, configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1"], settings: {}, workSchedule: {}, lastSchedule: { changes: 0, unscheduled: 0, operatorConflicts: 0 },
  });

  assert.equal(metrics.avoidableIdleMinutes, 30);
});

test("las metricas no inflan un hueco con una operacion que tarda mas por rendimiento", () => {
  const core = loadPlannerCore();
  const metrics = core.evaluatePlan({
    lockedOts: ["100", "101"],
    operations: [
      { id: "before-gap", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
      { id: "after-gap", ot: "101", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
      { id: "deferred", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "10:00", fechaFin: "2026-07-13", horaFin: "11:00" },
    ],
    workOrders: [{ ot: "100" }, { ot: "101" }, { ot: "200" }],
    matrix: { "CORTE::CORTE": ["OP 1"] }, configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1"], operatorPerformance: { "OP 1": 50 }, settings: {}, workSchedule: {},
    lastSchedule: { changes: 0, unscheduled: 0, operatorConflicts: 0 },
  });

  assert.equal(metrics.avoidableIdleMinutes, 0);
});

test("las metricas excluyen huecos sin capacidad elegible por calendario, maquina o ausencia de trabajo", () => {
  const core = loadPlannerCore();
  const fixed = [
    { id: "before-gap", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
    { id: "after-gap", ot: "101", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
  ];
  const deferred = { id: "deferred", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", operador: "OP 1", tiempoProd: 30, fechaInicio: "2026-07-13", horaInicio: "10:00", fechaFin: "2026-07-13", horaFin: "10:30" };
  const base = (operations, extra = {}) => ({
    operations, workOrders: [{ ot: "100" }, { ot: "101" }, { ot: "200" }], matrix: { "CORTE::CORTE": ["OP 1"] },
    lockedOts: ["100", "101", "300"],
    configuredCapabilities: ["CORTE::CORTE"], operators: ["OP 1", "OP 2"], settings: {}, workSchedule: {},
    lastSchedule: { changes: 0, unscheduled: 0, operatorConflicts: 0 }, ...extra,
  });

  const calendar = core.evaluatePlan(base([...fixed, deferred], {
    calendarExceptions: [{ date: "2026-07-13", concept: "OPERADOR", resource: "OP 1", start: "08:00", end: "09:00" }],
  }));
  const machine = core.evaluatePlan(base([...fixed, { ...deferred, maquina: "M1" }, {
    id: "machine-block", ot: "300", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 2", maquina: "M1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00",
  }]));
  const noWork = core.evaluatePlan(base(fixed));

  assert.equal(calendar.avoidableIdleMinutes, 0);
  assert.equal(machine.avoidableIdleMinutes, 0);
  assert.equal(noWork.avoidableIdleMinutes, 0);
});

test("un empate de puntuacion conserva la estrategia existente", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({ operations: [], workOrders: [], settings: { optimizationPasses: 1 }, workSchedule: {} }, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  assert.equal(result.lastSchedule.optimization.selectedStrategy, "balanced");
});

function flowFixture(operations, extra = {}) {
  const capabilities = [...new Set(operations.map((op) => `${op.ct}::${op.descripcion}`))];
  return {
    selectedOts: [...new Set(operations.map((op) => op.ot))],
    operations,
    workOrders: [...new Set(operations.map((op) => op.ot))].map((ot) => ({ ot })),
    matrix: Object.fromEntries(capabilities.map((key) => [key, ["OP 1"]])),
    configuredCapabilities: capabilities,
    operators: ["OP 1"],
    settings: { optimizationPasses: 1, flowWipTarget: 1 },
    workSchedule: {},
    ...extra,
  };
}

function assertFlowEvaluated(result) {
  assert.ok(
    result.lastSchedule.optimization.strategiesEvaluated.some((item) => item.strategy === "flow_balanced"),
    "flow_balanced no fue evaluada",
  );
}

test("flow balanced reduce flujo promedio y WIP terminando una OT antes de abrir otra", () => {
  const core = loadPlannerCore();
  const operations = ["100", "200"].flatMap((ot) => [1, 2].map((secuencia) => ({
    id: `${ot}-${secuencia}`, ot, secuencia, ct: "CORTE", descripcion: "CORTE",
    estatus: "PLAN", tiempoProd: 60, prioridad: 10, fechaReq: "2026-07-20",
  })));
  const options = {
    planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00",
  };
  const result = core.schedulePlan(flowFixture(operations), options);
  const legacy = core.schedulePlan(flowFixture(operations, {
    settings: { optimizationPasses: 1, flowWipTarget: 1, flowBalancedEnabled: false },
  }), options);
  const flowAudit = result.lastSchedule.optimization.strategiesEvaluated.find((item) => item.strategy === "flow_balanced");
  const legacyAudit = result.lastSchedule.optimization.strategiesEvaluated
    .find((item) => item.strategy === legacy.lastSchedule.optimization.selectedStrategy);

  assertFlowEvaluated(result);
  assert.equal(result.lastSchedule.optimization.strategiesEvaluated.length, 4);
  assert.equal(result.lastSchedule.optimization.selectedStrategy, "flow_balanced");
  assert.ok(flowAudit.metrics.score < legacyAudit.metrics.score);
  assert.ok(flowAudit.metrics.operatorConflicts <= legacyAudit.metrics.operatorConflicts);
  assert.ok(flowAudit.metrics.unscheduled <= legacyAudit.metrics.unscheduled);
  assert.equal(result.lastSchedule.optimization.metrics.averageFlowMinutes, 120);
  assert.equal(result.lastSchedule.optimization.metrics.maxWip, 1);
});

test("flow balanced abre otra OT si ninguna OT activa tiene operacion elegible", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "active-first", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
    { id: "active-blocked", ot: "100", secuencia: 2, ct: "PINTURA", descripcion: "PINTURA", estatus: "PLAN", tiempoProd: 60 },
    { id: "other", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "other-second", ot: "200", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "third", ot: "300", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "third-second", ot: "300", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
  ];
  const state = flowFixture(operations);
  state.matrix["PINTURA::PINTURA"] = [];
  const result = core.schedulePlan(state, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  assertFlowEvaluated(result);
  assert.equal(result.lastSchedule.optimization.selectedStrategy, "flow_balanced");
  assert.ok(result.operations.find((op) => op.id === "other").fechaInicio);
  assert.equal(result.operations.find((op) => op.id === "active-blocked").fechaInicio, undefined);
});

test("flow balanced reparte trabajo entre operadores equivalentes por carga proyectada", () => {
  const core = loadPlannerCore();
  const operations = [
    ...["100", "200"].flatMap((ot) => [1, 2].map((secuencia) => ({
      id: `serial-${ot}-${secuencia}`, ot, secuencia, ct: "SERIAL", descripcion: "SERIAL",
      estatus: "PLAN", tiempoProd: 60, prioridad: 1, fechaReq: "2026-07-14",
    }))),
    ...["300", "400"].map((ot) => ({
      id: `flex-${ot}`, ot, secuencia: 1, ct: "FLEX", descripcion: "FLEX",
      estatus: "PLAN", tiempoProd: 60, prioridad: 50, fechaReq: "2026-07-20",
    })),
  ];
  const state = flowFixture(operations, {
    matrix: { "SERIAL::SERIAL": ["OP 0"], "FLEX::FLEX": ["OP 1", "OP 2"] },
    configuredCapabilities: ["SERIAL::SERIAL", "FLEX::FLEX"],
    operators: ["OP 0", "OP 1", "OP 2"],
  });
  const result = core.schedulePlan(state, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  assertFlowEvaluated(result);
  assert.equal(result.lastSchedule.optimization.selectedStrategy, "flow_balanced");
  assert.deepEqual([...new Set(result.operations.filter((op) => op.ct === "FLEX").map((op) => op.operador))].sort(), ["OP 1", "OP 2"]);
});

test("flow balanced conserva el fallback de un minuto para una operacion sin tiempo", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "without-time", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN" },
    { id: "second", ot: "100", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 1 },
    { id: "other", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
    { id: "other-second", ot: "200", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
  ];
  const result = core.schedulePlan(flowFixture(operations), {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });
  const fallback = result.operations.find((op) => op.id === "without-time");

  assertFlowEvaluated(result);
  assert.equal(result.lastSchedule.optimization.selectedStrategy, "flow_balanced");
  assert.equal(
    new Date(`${fallback.fechaFin}T${fallback.horaFin}:00`) - new Date(`${fallback.fechaInicio}T${fallback.horaInicio}:00`),
    60000,
  );
});

test("flow balanced conserva precedencia y bloqueos", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "fixed", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 120, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00" },
    { id: "successor", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "other-first", ot: "300", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "other-second", ot: "300", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "third-first", ot: "400", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    { id: "third-second", ot: "400", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
  ];
  const result = core.schedulePlan(flowFixture(operations, { lockedOts: ["100"] }), {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });
  const fixed = result.operations.find((op) => op.id === "fixed");
  const successor = result.operations.find((op) => op.id === "successor");

  assertFlowEvaluated(result);
  assert.equal(result.lastSchedule.optimization.selectedStrategy, "flow_balanced");
  assert.equal(`${fixed.fechaInicio} ${fixed.horaInicio}-${fixed.horaFin}`, "2026-07-13 07:00-09:00");
  assert.ok(new Date(`${successor.fechaInicio}T${successor.horaInicio}:00`) >= new Date("2026-07-13T09:00:00"));
});

test("un asueto general detiene operaciones finitas y subcontratos al buscar el primer fin posible", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    operations: [
      { id: "finite-before-holiday", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 60 },
      { id: "sub-before-holiday", ot: "200", secuencia: 1, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", estatus: "PLAN" },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    otConfigurations: { 200: { ot: "200", subcontractType: "MAKA", subcontractDays: 1 } },
    matrix: { "CORTE::CORTE": ["OP 1"] },
    configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1"],
    calendarExceptions: [{ date: "2026-07-14", concept: "ASUETO", reason: "Validacion motor" }],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T16:30:00" });

  const finite = result.operations.find((op) => op.id === "finite-before-holiday");
  const subcontract = result.operations.find((op) => op.id === "sub-before-holiday");
  assert.deepEqual([finite.fechaInicio, finite.horaInicio, finite.fechaFin, finite.horaFin], ["2026-07-13", "16:30", "2026-07-15", "07:30"]);
  assert.deepEqual([subcontract.fechaInicio, subcontract.horaInicio, subcontract.fechaFin, subcontract.horaFin], ["2026-07-13", "16:30", "2026-07-15", "07:00"]);
  assert.equal(result.lastSchedule.unscheduled, 0);
});

test("una completada fija la precedencia de su sucesora sin consumir capacidad para otras OTs", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    operations: [
      { id: "completed-predecessor", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoProd: 300 },
      { id: "successor-after-completed", ot: "100", secuencia: 2, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
      { id: "other-ot-can-use-capacity", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { "CORTE::CORTE": ["OP 1"] },
    configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1"],
    settings: { optimizationPasses: 1, flowBalancedEnabled: true },
    workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });

  const successor = result.operations.find((op) => op.id === "successor-after-completed");
  const other = result.operations.find((op) => op.id === "other-ot-can-use-capacity");
  assert.deepEqual([other.fechaInicio, other.horaInicio], ["2026-07-13", "07:00"]);
  assert.deepEqual([successor.fechaInicio, successor.horaInicio], ["2026-07-13", "12:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("el motor elige el recurso factible mas rapido cuando el primero esta bloqueado", () => {
  const core = loadPlannerCoreWithSinglePass();
  const result = core.schedulePlanOnce({
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    operations: [
      { id: "blocked-op1", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "10:00", tiempoProd: 180 },
      { id: "fast-choice", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 30 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { "CORTE::CORTE": ["OP 1", "OP 2"] },
    configuredCapabilities: ["CORTE::CORTE"],
    operators: ["OP 1", "OP 2"],
    settings: {},
    workSchedule: {},
  }, { strategy: "balanced", planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });

  const operation = result.operations.find((op) => op.id === "fast-choice");
  assert.deepEqual([operation.operador, operation.fechaInicio, operation.horaInicio, operation.horaFin], ["OP 2", "2026-07-13", "07:00", "07:30"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("flow balanced no trata operation.locked como fija sin OT bloqueada", () => {
  const core = loadPlannerCoreWithSinglePass();
  const operations = [
    { id: "long-open", ot: "100", secuencia: 1, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", locked: true, operador: "OP 2", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
    { id: "long-current", ot: "100", secuencia: 2, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", tiempoProd: 60 },
    { id: "long-fixed", ot: "100", secuencia: 3, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", locked: true, operador: "OP 2", tiempoProd: 60, fechaInicio: "2026-07-14", horaInicio: "16:00", fechaFin: "2026-07-14", horaFin: "17:00" },
    { id: "short-open", ot: "200", secuencia: 1, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", locked: true, operador: "OP 3", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
    { id: "short-current", ot: "200", secuencia: 2, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", tiempoProd: 60 },
    { id: "short-fixed", ot: "200", secuencia: 3, ct: "SERIAL", descripcion: "SERIAL", estatus: "PLAN", locked: true, operador: "OP 3", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
  ];
  const result = core.schedulePlanOnce(flowFixture(operations, {
    matrix: { "SERIAL::SERIAL": ["OP 1"] },
    configuredCapabilities: ["SERIAL::SERIAL"],
    operators: ["OP 1", "OP 2", "OP 3"],
  }), {
    strategy: "flow_balanced", planStart: "2026-07-13", horizonDays: 2, executionTime: "2026-07-13T07:00:00",
  });

  assert.equal(result.operations.find((op) => op.id === "short-current").horaInicio, "11:00");
  assert.equal(result.operations.find((op) => op.id === "long-current").horaInicio, "08:00");
});

test("si flow balanced falla se excluye y las estrategias existentes continuan", () => {
  const core = loadPlannerCore();
  const settings = { optimizationPasses: 1 };
  Object.defineProperty(settings, "flowWipTarget", {
    get() { throw new Error("configuracion flow invalida"); },
  });

  const result = core.schedulePlan({ operations: [], workOrders: [], settings, workSchedule: {} }, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  assert.equal(result.lastSchedule.optimization.selectedStrategy, "balanced");
  assert.deepEqual([...result.lastSchedule.optimization.strategiesEvaluated].map((item) => item.strategy), ["balanced", "finish", "load"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.lastSchedule.optimization.strategyFailures)), [
    { strategy: "flow_balanced", message: "configuracion flow invalida" },
  ]);
});

function scheduleBeforeFixedSuccessor(operationRules = {}) {
  const core = loadPlannerCore();
  return core.schedulePlan({
    selectedOts: ["500"],
    lockedOts: ["500"],
    operations: [
      { id: "movable-predecessor", ot: "500", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 180 },
      { id: "fixed-successor", ot: "500", secuencia: 2, ct: "EMPAQUE", descripcion: "EMPAQUE", estatus: "PLAN", locked: true, operador: "OP 2", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00" },
    ],
    workOrders: [{ ot: "500" }],
    matrix: { "CORTE::CORTE": ["OP 1"], "EMPAQUE::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["CORTE::CORTE", "EMPAQUE::EMPAQUE"],
    operationRules,
    operators: ["OP 1", "OP 2"],
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });
}

test("una OT bloqueada conserva predecesora sin fecha y sucesora fija", () => {
  const result = scheduleBeforeFixedSuccessor();
  const predecessor = result.operations.find((op) => op.id === "movable-predecessor");
  const successor = result.operations.find((op) => op.id === "fixed-successor");

  assert.equal(predecessor.fechaInicio, undefined);
  assert.deepEqual([successor.fechaInicio, successor.horaInicio, successor.fechaFin, successor.horaFin], ["2026-07-13", "08:00", "2026-07-13", "09:00"]);
  assert.equal(result.lastSchedule.unscheduled, 0);
});

test("una OT bloqueada conserva predecesora sin fecha aunque exista hito de solapamiento", () => {
  const result = scheduleBeforeFixedSuccessor({ "CORTE::CORTE": { overlap: 0.5 } });
  const predecessor = result.operations.find((op) => op.id === "movable-predecessor");

  assert.equal(predecessor.fechaInicio, undefined);
  assert.equal(result.lastSchedule.unscheduled, 0);
});

test("el hito de solapamiento usa los segmentos productivos reales antes de una sucesora fija", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["600"],
    lockedOts: ["600"],
    operations: [
      { id: "segmented-predecessor", ot: "600", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 180 },
      { id: "fixed-at-nine", ot: "600", secuencia: 2, ct: "EMPAQUE", descripcion: "EMPAQUE", estatus: "PLAN", locked: true, operador: "OP 2", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
    ],
    workOrders: [{ ot: "600" }],
    matrix: { "CORTE::CORTE": ["OP 1"], "EMPAQUE::EMPAQUE": ["OP 2"] },
    configuredCapabilities: ["CORTE::CORTE", "EMPAQUE::EMPAQUE"],
    operationRules: { "CORTE::CORTE": { overlap: 0.5 } },
    calendarExceptions: [{ date: "2026-07-13", concept: "OPERADOR", resource: "OP 1", start: "07:30", end: "09:00" }],
    operators: ["OP 1", "OP 2"], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });

  assert.equal(result.operations.find((op) => op.id === "segmented-predecessor").fechaInicio, undefined);
  assert.equal(result.lastSchedule.unscheduled, 0);
});

test("la factibilidad acumula hitos hasta la proxima fija aunque haya una movible sin hueco", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["700"],
    lockedOts: ["700"],
    operations: [
      { id: "chain-first", ot: "700", secuencia: 1, ct: "CORTE", descripcion: "CORTE", estatus: "PLAN", tiempoProd: 240 },
      { id: "chain-no-slot", ot: "700", secuencia: 2, ct: "PINTURA", descripcion: "PINTURA", estatus: "PLAN", tiempoProd: 120 },
      { id: "chain-fixed", ot: "700", secuencia: 3, ct: "EMPAQUE", descripcion: "EMPAQUE", estatus: "PLAN", locked: true, operador: "OP 3", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "10:00", fechaFin: "2026-07-13", horaFin: "11:00" },
    ],
    workOrders: [{ ot: "700" }],
    matrix: { "CORTE::CORTE": ["OP 1"], "PINTURA::PINTURA": ["OP 2"], "EMPAQUE::EMPAQUE": ["OP 3"] },
    configuredCapabilities: ["CORTE::CORTE", "PINTURA::PINTURA", "EMPAQUE::EMPAQUE"],
    operationRules: { "CORTE::CORTE": { overlap: 0.25 }, "PINTURA::PINTURA": { overlap: 0.5 } },
    calendarExceptions: [{ date: "2026-07-13", concept: "OPERADOR", resource: "OP 2", start: "07:00", end: "10:00" }],
    operators: ["OP 1", "OP 2", "OP 3"], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });

  assert.equal(result.operations.find((op) => op.id === "chain-first").fechaInicio, undefined);
  assert.equal(result.operations.find((op) => op.id === "chain-no-slot").fechaInicio, undefined);
  assert.equal(result.lastSchedule.unscheduled, 0);
});

test("flow balanced busca otro recurso si el de menor carga no alcanza la sucesora fija", () => {
  const core = loadPlannerCoreWithSinglePass();
  const result = core.schedulePlanOnce({
    selectedOts: ["800", "900"],
    operations: [
      { id: "chain-start", ot: "800", secuencia: 1, ct: "INICIO", descripcion: "INICIO", estatus: "PLAN", tiempoProd: 30 },
      { id: "chain-choice", ot: "800", secuencia: 2, ct: "ELECCION", descripcion: "ELECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "chain-fixed-nine", ot: "800", secuencia: 3, ct: "FIJA", descripcion: "FIJA", estatus: "PLAN", locked: true, operador: "OP 3", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
      { id: "op1-prior-load", ot: "900", secuencia: 1, ct: "CARGA", descripcion: "CARGA", estatus: "PLAN", locked: true, operador: "OP 1", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "06:30", fechaFin: "2026-07-13", horaFin: "07:30" },
    ],
    workOrders: [{ ot: "800" }, { ot: "900" }],
    matrix: {
      "INICIO::INICIO": ["OP 0"], "ELECCION::ELECCION": ["OP 1", "OP 2"],
      "FIJA::FIJA": ["OP 3"], "CARGA::CARGA": ["OP 1"],
    },
    configuredCapabilities: ["INICIO::INICIO", "ELECCION::ELECCION", "FIJA::FIJA", "CARGA::CARGA"],
    calendarExceptions: [
      { date: "2026-07-13", concept: "OPERADOR", resource: "OP 1", start: "08:00", end: "17:00" },
      { date: "2026-07-13", concept: "OPERADOR", resource: "OP 2", start: "07:00", end: "09:00" },
    ],
    operators: ["OP 0", "OP 1", "OP 2", "OP 3"], settings: { flowWipTarget: 1 }, workSchedule: {},
  }, {
    strategy: "flow_balanced", planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  const choice = result.operations.find((op) => op.id === "chain-choice");
  assert.equal(result.lastSchedule.unscheduled, 0);
  assert.equal(choice.operador, "OP 1");
  assert.deepEqual([choice.horaInicio, choice.horaFin], ["07:30", "08:00"]);
});

test("flow balanced no descarta la alternativa factible numero 33 por el presupuesto", () => {
  const core = loadPlannerCoreWithSinglePass();
  const lateOperators = Array.from({ length: 32 }, (_, index) => `OP TARDE ${index + 1}`);
  const result = core.schedulePlanOnce({
    selectedOts: ["810", "910"],
    operations: [
      { id: "budget-start", ot: "810", secuencia: 1, ct: "INICIO", descripcion: "INICIO", estatus: "PLAN", tiempoProd: 30 },
      { id: "budget-choice", ot: "810", secuencia: 2, ct: "ELECCION", descripcion: "ELECCION", estatus: "PLAN", tiempoProd: 30 },
      { id: "budget-fixed-nine", ot: "810", secuencia: 3, ct: "FIJA", descripcion: "FIJA", estatus: "PLAN", locked: true, operador: "OP FIJA", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
      { id: "fit-prior-load", ot: "910", secuencia: 1, ct: "CARGA", descripcion: "CARGA", estatus: "PLAN", locked: true, operador: "OP FACTIBLE", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "06:30", fechaFin: "2026-07-13", horaFin: "07:30" },
    ],
    workOrders: [{ ot: "810" }, { ot: "910" }],
    matrix: {
      "INICIO::INICIO": ["OP 0"], "ELECCION::ELECCION": [...lateOperators, "OP FACTIBLE"],
      "FIJA::FIJA": ["OP FIJA"], "CARGA::CARGA": ["OP FACTIBLE"],
    },
    configuredCapabilities: ["INICIO::INICIO", "ELECCION::ELECCION", "FIJA::FIJA", "CARGA::CARGA"],
    calendarExceptions: [
      ...lateOperators.map((resource) => ({ date: "2026-07-13", concept: "OPERADOR", resource, start: "07:00", end: "09:00" })),
      { date: "2026-07-13", concept: "OPERADOR", resource: "OP FACTIBLE", start: "08:00", end: "17:00" },
    ],
    operators: ["OP 0", ...lateOperators, "OP FACTIBLE", "OP FIJA"], settings: { flowWipTarget: 1 }, workSchedule: {},
  }, {
    strategy: "flow_balanced", planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  const choice = result.operations.find((op) => op.id === "budget-choice");
  assert.equal(result.lastSchedule.unscheduled, 0);
  assert.equal(choice.operador, "OP FACTIBLE");
  assert.deepEqual([choice.horaInicio, choice.horaFin], ["07:30", "08:00"]);
});

test("flow balanced rechaza una cadena inconclusa cuya pausa hace imposible la sucesora fija", () => {
  const core = loadPlannerCoreWithSinglePass();
  const pausedOperators = Array.from({ length: 33 }, (_, index) => `OP PAUSA ${index + 1}`);
  const result = core.schedulePlanOnce({
    selectedOts: ["815"],
    lockedOts: ["815"],
    operations: [
      { id: "paused-budget-start", ot: "815", secuencia: 1, ct: "INICIO", descripcion: "INICIO", estatus: "PLAN", tiempoProd: 30 },
      { id: "paused-budget-middle", ot: "815", secuencia: 2, ct: "INTERMEDIA", descripcion: "INTERMEDIA", estatus: "PLAN", tiempoProd: 30 },
      { id: "paused-budget-fixed", ot: "815", secuencia: 3, ct: "FIJA", descripcion: "FIJA", estatus: "PLAN", locked: true, operador: "OP FIJA", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
    ],
    workOrders: [{ ot: "815" }],
    matrix: {
      "INICIO::INICIO": ["OP INICIO"], "INTERMEDIA::INTERMEDIA": pausedOperators, "FIJA::FIJA": ["OP FIJA"],
    },
    configuredCapabilities: ["INICIO::INICIO", "INTERMEDIA::INTERMEDIA", "FIJA::FIJA"],
    calendarExceptions: pausedOperators.map((resource) => ({
      date: "2026-07-13", concept: "OPERADOR", resource, start: "07:00", end: "09:00",
    })),
    operators: ["OP INICIO", ...pausedOperators, "OP FIJA"], settings: { flowWipTarget: 1 }, workSchedule: {},
  }, {
    strategy: "flow_balanced", planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  assert.equal(result.operations.find((op) => op.id === "paused-budget-start").fechaInicio, undefined);
  assert.equal(result.operations.find((op) => op.id === "paused-budget-fixed").horaInicio, "09:00");
});

test("flow balanced no acepta una predecesora tardia cuando 33 intermedias agotan el presupuesto", () => {
  const core = loadPlannerCoreWithSinglePass();
  const intermediates = Array.from({ length: 33 }, (_, index) => ({
    id: `budget-middle-${index + 1}`, ot: "820", secuencia: index + 2,
    ct: "INTERMEDIA", descripcion: "INTERMEDIA", estatus: "PLAN", tiempoProd: 1,
  }));
  const result = core.schedulePlanOnce({
    selectedOts: ["820"],
    lockedOts: ["820"],
    operations: [
      { id: "budget-late-predecessor", ot: "820", secuencia: 1, ct: "INICIO", descripcion: "INICIO", estatus: "PLAN", tiempoProd: 180 },
      ...intermediates,
      { id: "budget-fixed-nine-after-chain", ot: "820", secuencia: 35, ct: "FIJA", descripcion: "FIJA", estatus: "PLAN", locked: true, operador: "OP FIJA", tiempoProd: 60, fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
    ],
    workOrders: [{ ot: "820" }],
    matrix: {
      "INICIO::INICIO": ["OP INICIO"], "INTERMEDIA::INTERMEDIA": ["OP INTERMEDIA"], "FIJA::FIJA": ["OP FIJA"],
    },
    configuredCapabilities: ["INICIO::INICIO", "INTERMEDIA::INTERMEDIA", "FIJA::FIJA"],
    operators: ["OP INICIO", "OP INTERMEDIA", "OP FIJA"], settings: { flowWipTarget: 1 }, workSchedule: {},
  }, {
    strategy: "flow_balanced", planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00",
  });

  const predecessor = result.operations.find((op) => op.id === "budget-late-predecessor");
  assert.equal(predecessor.fechaInicio, undefined);
  assert.equal(result.operations.find((op) => op.id === "budget-fixed-nine-after-chain").horaInicio, "09:00");
});
