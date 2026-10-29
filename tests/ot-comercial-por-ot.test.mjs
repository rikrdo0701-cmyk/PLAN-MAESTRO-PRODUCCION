// RULE-OT-056 — captura comercial POR OT: dos OTs del mismo articulo ya no se pisan entre si y
// generar no vuelve a pedir detalles ya confirmados (incluido el precio 0/vacio).
//
// Sintoma que cubre: "agregue 150 OTs a planeado/no planeado y al generar plan me volvio a pedir
// detalles que ya habia capturado" (precio 0, herramental, subcontrato, tipo). Causa raiz:
// commercialPlanningRequirement leia jobType/planningType/manualUnitPrice SOLO del config del
// articulo, compartido por todas las OTs del mismo PARTE; la firma de preparacion embebe esos
// valores, asi que capturar otra OT del mismo articulo "derivaba" la firma de las anteriores y
// el re-uso (preparedPlanningByOt) dejaba de coincidir. Aparte, el precio no estaba en la firma
// y needsManualPrice exigia manualPrice > 0, de modo que un precio 0/vacio nunca se cerraba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const appPath = path.join(process.cwd(), "src", "web", "planning", "app.js");

function slice(source, startAnchor, endAnchor) {
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  if (start < 0 || end < 0) throw new Error(`slice no encontrada: ${startAnchor} -> ${endAnchor}`);
  return source.slice(start, end);
}

function build(fnSource, name, params) {
  const names = Object.keys(params);
  return Function(...names, `${fnSource}; return ${name};`)(...names.map((key) => params[key]));
}

// Replica fiel de planningPreparationSignature / canReuse / needsPlanningPreparation /
// markPlanningPrepared de planning-workflow-core para que el harness del gate sea real.
function coreStub() {
  const normalize = (value) => String(value === undefined || value === null ? "" : value).trim();
  return {
    canReusePlanningPreparation: (state, ot, hasRequiredGaps) => {
      if (hasRequiredGaps === true) return false;
      return Boolean(String(state?.preparedPlanningByOt?.[ot] || "").trim());
    },
    needsPlanningPreparation: (state, ot, signature) =>
      String(state?.preparedPlanningByOt?.[ot] || "") !== String(signature || ""),
    markPlanningPrepared: (source, ot, signature) => ({
      ...(source || {}),
      preparedPlanningByOt: { ...(source?.preparedPlanningByOt || {}), [ot]: String(signature || "") },
    }),
    planningPreparationSignature: (input) => {
      const value = input || {};
      return JSON.stringify({
        ot: normalize(value.ot),
        machine: normalize(value.machine),
        tool: normalize(value.tool),
        kit: normalize(value.kit),
        additionalTools: (value.additionalTools || []).map((item) => JSON.stringify(item)),
        kitPending: value.kitPending === true,
        subcontractType: normalize(value.subcontractType),
        subcontractDays: Number(value.subcontractDays || 0),
        commercialType: normalize(value.commercialType),
        planningType: normalize(value.planningType),
        operationVersion: String(value.operationVersion || ""),
      });
    },
  };
}

function baseState() {
  return {
    selectedOts: [],
    articleConfigurations: {},
    otConfigurations: {},
    preparedPlanningByOt: {},
  };
}

async function buildReals(app, state, window) {
  const articleKeyForPart = build(
    slice(app, "function articleKeyForPart(", "function articleConfigurationFor("),
    "articleKeyForPart",
    {},
  );
  const articleFor = build(
    slice(app, "function articleConfigurationFor(", "function articleConfigurationValue("),
    "articleConfigurationFor",
    { state, articleKeyForPart },
  );
  const articleValue = build(
    slice(app, "function articleConfigurationValue(", "function applySubcontractToJob("),
    "articleConfigurationValue",
    { state, articleKeyForPart },
  );
  const otConfFor = build(
    slice(app, "function otConfigurationFor(", "function otCommercialConfigurationFor("),
    "otConfigurationFor",
    { state },
  );
  const otCommercialFor = build(
    slice(app, "function otCommercialConfigurationFor(", "function normalizeArticleConfigurations("),
    "otCommercialConfigurationFor",
    { state, materialOtKey: (value) => String(value || "").trim().toUpperCase() },
  );
  const isComponent = build(
    slice(app, "function isComponentCommercialType(", "function commercialPlanningRequirement("),
    "isComponentCommercialType",
    { COMPONENT_COMMERCIAL_TYPE: "COMPONENTE" },
  );
  const commercial = build(
    slice(app, "function commercialPlanningRequirement(", "function applyCommercialPlanningRequirement("),
    "commercialPlanningRequirement",
    {
      state,
      articleConfigurationValue: articleValue,
      otCommercialConfigurationFor: otCommercialFor,
      invoiceUnitPriceForOt: () => 0,
      maxOperationPriceSignalForOt: () => 0,
      pendingPiecesForWorkOrder: () => 1,
      workOrderForOt: () => ({}),
      isComponentCommercialType: isComponent,
    },
  );
  const rememberEdit = () => {};
  const applyCommercial = build(
    slice(app, "function applyCommercialPlanningRequirement(", "function buildPlanningRequirements("),
    "applyCommercialPlanningRequirement",
    {
      articleConfigurationFor: articleFor,
      otConfigurationFor: otConfFor,
      suggestedPlanningTypeForJob: () => "NORMAL",
      isComponentCommercialType: isComponent,
      rememberLocalOtConfigurationEdit: rememberEdit,
    },
  );
  const prepSignature = build(
    slice(app, "function planningPreparationSignature(", "function planningSignatureDiff("),
    "planningPreparationSignature",
    { window, additionalToolListValue: () => [] },
  );
  const signatureDiff = build(
    slice(app, "function planningSignatureDiff(", "function maxOperationPriceSignalForOt("),
    "planningSignatureDiff",
    {},
  );
  return { articleKeyForPart, articleFor, articleValue, otConfFor, otCommercialFor, isComponent, commercial, applyCommercial, prepSignature, signatureDiff };
}

test("RULE-OT-056: capturar una segunda OT del mismo articulo no deriva la firma de la primera y generar no vuelve a pedir", async () => {
  const app = await readFile(appPath, "utf8");
  const state = baseState();
  const window = {
    PlannerCore: { planningConfigurationIssues: () => [] },
    PlanningWorkflowCore: coreStub(),
  };
  const reals = await buildReals(app, state, window);

  const opsByOt = {
    "100": [{ id: "op-100", ot: "100", ct: "3000", tipoInsercion: "OPERACION" }],
    "200": [{ id: "op-200", ot: "200", ct: "3000", tipoInsercion: "OPERACION" }],
  };
  let dialogs = 0;
  const confirmedValues = [
    { ot_planning_type: "NORMAL" },
    { ot_planning_type: "ALTERNATIVO" },
  ];
  const showPlanningRequirements = async () => {
    dialogs += 1;
    return confirmedValues.shift() || null;
  };
  const prepareJobForPlanning = build(
    slice(app, "async function prepareJobForPlanning(", "function setGanttView("),
    "prepareJobForPlanning",
    {
      state,
      window,
      currentPlanOperations: (operations) => operations,
      jobPlanningOperations: (job) => job.ops,
      showPlanningBlockers: async () => false,
      buildPlanningRequirements: () => [],
      commercialPlanningRequirement: reals.commercial,
      planningPreparationSignature: reals.prepSignature,
      isSubcontractAppOperation: () => false,
      isBendingAppOperation: () => false,
      showPlanningRequirements,
      applyPlanningRequirements: () => {},
      applyCommercialPlanningRequirement: reals.applyCommercial,
      assignPlanningOperators: () => {},
      planningSignatureDiff: reals.signatureDiff,
    },
  );

  const job100 = { ot: "100", ops: opsByOt["100"], parte: "P-100" };
  const job200 = { ot: "200", ops: opsByOt["200"], parte: "P-100" };

  assert.equal(await prepareJobForPlanning(job100, { forceConfirm: true }), true);
  assert.equal(await prepareJobForPlanning(job200, { forceConfirm: true }), true);
  assert.equal(dialogs, 2, "las dos altas pasan por el dialogo");

  // Captura por OT escrita y estable, aunque el articulo quedo con el ULTIMO valor capturado.
  assert.ok(state.otConfigurations["100"].commercialCapturedAt, "OT 100 registro captura comercial");
  assert.equal(state.otConfigurations["100"].planningType, "NORMAL");
  assert.equal(state.otConfigurations["200"].planningType, "ALTERNATIVO");
  assert.equal(state.articleConfigurations["P-100"].planningType, "ALTERNATIVO", "el articulo quedo con la ultima captura");

  // La deriva existia: leyendo del articulo (como hacia antes del fix) la firma de la OT 100
  // habria cambiado de NORMAL a ALTERNATIVO.
  const driftedSignature = window.PlanningWorkflowCore.planningPreparationSignature({
    ot: "100", machine: "", tool: "", kit: "", additionalTools: [], kitPending: false,
    subcontractType: "", subcontractDays: 0,
    commercialType: "", planningType: state.articleConfigurations["P-100"].planningType,
    operationVersion: "",
  });
  assert.notEqual(state.preparedPlanningByOt["100"], driftedSignature, "la deriva por articulo estaba activa (escenario real)");

  // Generar para la OT 100: re-uso sin volver a pedir nada.
  const beforeGenerate = dialogs;
  assert.equal(await prepareJobForPlanning(job100, { reuseConfirmed: true }), true);
  assert.equal(dialogs, beforeGenerate, "generar NO vuelve a pedir lo ya confirmado");
});

test("RULE-OT-056: needsManualPrice se satisface con la captura por OT aunque el precio quede 0/vacio", async () => {
  const app = await readFile(appPath, "utf8");
  const state = baseState();
  const window = { PlanningWorkflowCore: coreStub() };
  const reals = await buildReals(app, state, window);
  const job = { ot: "100", ops: [], parte: "P-100" };

  assert.equal(reals.commercial(job).needsManualPrice, true, "sin captura el precio es una necesidad");
  reals.applyCommercial(job, { ot_planning_type: "NORMAL", ot_manual_price: "" }, reals.commercial(job));
  const after = reals.commercial(job);
  assert.equal(after.needsManualPrice, false, "captura por OT cierra el precio aunque quede 0/vacio");
  assert.equal(after.manualPrice, 0);
  assert.equal(after.currentPlanningType, "NORMAL");
});

test("RULE-OT-056: normalizeOtResourceAssignments conserva la captura comercial por OT", async () => {
  const app = await readFile(appPath, "utf8");
  const isBending = (op) => ["5459", "5527"].includes(String(op.ct || "").trim());
  const state = {
    operations: [
      { id: "o1", ot: "100", ct: "3000", tipoInsercion: "OPERACION", herramental: "LEGACY" },
      { id: "o2", ot: "100", ct: "5459", tipoInsercion: "OPERACION", maquina: "M1", herramental: "T1" },
    ],
    otConfigurations: {
      "100": {
        ot: "100",
        machine: "M1",
        herramental: "T1",
        jobType: "MAQUILADO",
        planningType: "NORMAL",
        manualUnitPrice: 0,
        commercialCapturedAt: "2026-10-09T00:00:00.000Z",
      },
    },
  };
  const normalize = build(
    slice(app, "function normalizeOtResourceAssignments(", "function normalizeMachineValue("),
    "normalizeOtResourceAssignments",
    {
      state,
      normalizeStatus: (value) => String(value || "").trim().toUpperCase(),
      isBendingAppOperation: isBending,
      normalizeMachineValue: (value) => {
        const machine = String(value || "").trim();
        return !machine || machine.toUpperCase() === "SIN_MAQUINA" ? "" : machine;
      },
      cleanToolValue: (value) => String(value || "").trim(),
      additionalToolListValue: () => [],
      operationUsesOtKit: isBending,
      isSubcontractAppOperation: () => false,
    },
  );
  normalize();
  const configuration = state.otConfigurations["100"];
  assert.equal(configuration.commercialCapturedAt, "2026-10-09T00:00:00.000Z", "el rebuild no borra la captura por OT");
  assert.equal(configuration.jobType, "MAQUILADO");
  assert.equal(configuration.planningType, "NORMAL");
  assert.equal(configuration.manualUnitPrice, 0);
  assert.equal(configuration.machine, "M1");
});

test("RULE-OT-056: el diagnostico PLANNING_REASK registra gaps y diff de firma de una OT re-pedida", async () => {
  const app = await readFile(appPath, "utf8");
  const state = baseState();
  const window = {
    PlannerCore: { planningConfigurationIssues: () => [] },
    PlanningWorkflowCore: coreStub(),
    PLANNING_REASK_DIAG: true,
  };
  const reals = await buildReals(app, state, window);
  const requirement = { op: { id: "op-100", ot: "100" }, codes: new Set(["MISSING_MACHINE"]) };
  let dialogs = 0;
  const prepareJobForPlanning = build(
    slice(app, "async function prepareJobForPlanning(", "function setGanttView("),
    "prepareJobForPlanning",
    {
      state,
      window,
      currentPlanOperations: (operations) => operations,
      jobPlanningOperations: (job) => job.ops,
      showPlanningBlockers: async () => false,
      buildPlanningRequirements: () => [requirement],
      commercialPlanningRequirement: reals.commercial,
      planningPreparationSignature: reals.prepSignature,
      isSubcontractAppOperation: () => false,
      isBendingAppOperation: (op) => ["5459", "5527"].includes(String(op.ct || "").trim()),
      showPlanningRequirements: async () => { dialogs += 1; return null; },
      applyPlanningRequirements: () => {},
      applyCommercialPlanningRequirement: reals.applyCommercial,
      assignPlanningOperators: () => {},
      planningSignatureDiff: reals.signatureDiff,
    },
  );

  const result = await prepareJobForPlanning(
    { ot: "100", ops: [{ id: "op-100", ot: "100", ct: "5459", tipoInsercion: "OPERACION" }], parte: "P-100" },
    { reuseConfirmed: true },
  );
  assert.equal(result, false, "el dialogo se cancela");
  assert.equal(dialogs, 1);
  assert.equal(window.__planningReaskDiag.length, 1, "el diagnostico registro la OT re-pedida");
  assert.deepEqual(window.__planningReaskDiag[0].gapCodes, ["MISSING_MACHINE"]);
  assert.equal(window.__planningReaskDiag[0].commercial.needsPlanningType, true);
  assert.ok(Array.isArray(window.__planningReaskDiag[0].signatureDiff));
});