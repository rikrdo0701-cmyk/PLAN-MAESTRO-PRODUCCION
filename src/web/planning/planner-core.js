(function initPlannerCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlannerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlannerCore() {
  "use strict";

  const SNAP_MINUTES = 1;
  const ALLOCATION_CHUNK_MINUTES = 30;
  const SEARCH_STEP_MINUTES = 60;
  const DEFAULT_START_MINUTE = 7 * 60;
  const DEFAULT_END_MINUTE = 17 * 60;
  const DEFAULT_HORIZON_DAYS = 15;
  const MAX_SCHEDULING_DAYS = 366;
  const MAX_FIXED_CHAIN_PROBES = 32;
  const FAST_QUALITY_BUDGET_MS = 300000;
  const FIXED_CHAIN_INFEASIBLE = 0;
  const FIXED_CHAIN_FEASIBLE = 1;
  const FIXED_CHAIN_INCONCLUSIVE = 2;
  const PLANNING_BUDGET_EXCEEDED = "PLANNING_BUDGET_EXCEEDED";
  const GENERATED_BY = "PLANNER_CORE_V2";
  const TOOL_CHANGE_CAPABILITY = {
    key: "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
    ct: "TOOL_CHANGE",
    label: "CAMBIO DE HERRAMENTAL",
  };

  function createPlanningPerformanceState(options) {
    if (!options || (!options.collectStats && !Number.isFinite(Number(options.timeBudgetMs)) && !Number.isFinite(Number(options.progressEveryMs)))) return null;
    const nowMs = typeof options.nowMs === "function" ? options.nowMs : defaultNowMs;
    const startedAtMs = nowMs();
    const startedAtWallMs = Date.now();
    return {
      nowMs,
      startedAtMs,
      startedAtWallMs,
      startedAt: new Date().toISOString(),
      timeBudgetMs: Number.isFinite(Number(options.timeBudgetMs)) && Number(options.timeBudgetMs) > 0 ? Number(options.timeBudgetMs) : 0,
      budgetCheckLimit: Number.isFinite(Number(options.timeBudgetMs)) && Number(options.timeBudgetMs) > 0 ? Math.round(Number(options.timeBudgetMs) * 500) : 0,
      budgetCheckCount: 0,
      progressEveryMs: Number.isFinite(Number(options.progressEveryMs)) && Number(options.progressEveryMs) > 0 ? Number(options.progressEveryMs) : 0,
      lastProgressElapsedMs: 0,
      lastPhase: "scheduler:init",
      scheduledOpsTotal: 0,
      scheduledOpsDone: 0,
      strategy: "",
      progress: typeof options.onProgress === "function" ? options.onProgress : null,
      stats: {
        strategiesStarted: 0,
        strategyTimings: [],
        mainLoopIterations: 0,
        findBestAssignmentCalls: 0,
        cachedAssignmentReuses: 0,
        assignmentCandidateEvaluations: 0,
        slotProbes: 0,
        slotProbeSkips: 0,
        busyOverlapScans: 0,
        busyConflictScans: 0,
        busyConflictSorts: 0,
        busySegmentSorts: 0,
        toolCatalogLookups: 0,
        toolCatalogScans: 0,
        otConfigurationLookups: 0,
      },
    };
  }

  function defaultNowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function planningNowMs(performanceState) {
    return performanceState?.nowMs ? performanceState.nowMs() : defaultNowMs();
  }

  function countPlanningStat(performanceState, name, amount = 1) {
    if (!performanceState?.stats || !Object.prototype.hasOwnProperty.call(performanceState.stats, name)) return;
    performanceState.stats[name] += amount;
  }

  function checkPlanningBudget(performanceState, phase, context) {
    if (!performanceState) return false;
    performanceState.lastPhase = phase;
    performanceState.budgetCheckCount = (performanceState.budgetCheckCount || 0) + 1;
    const elapsedMs = planningNowMs(performanceState) - performanceState.startedAtMs;
    const wallElapsedMs = Date.now() - (performanceState.startedAtWallMs || Date.now());
    const effectiveElapsedMs = Math.max(elapsedMs, wallElapsedMs);
    if (performanceState.progressEveryMs && effectiveElapsedMs - performanceState.lastProgressElapsedMs >= performanceState.progressEveryMs) {
      performanceState.lastProgressElapsedMs = effectiveElapsedMs;
      emitPlanningProgress(performanceState, phase);
    }
    const timerExceeded = performanceState.completeAll !== true && performanceState.timeBudgetMs && effectiveElapsedMs > performanceState.timeBudgetMs;
    const counterExceeded = performanceState.completeAll !== true && performanceState.budgetCheckLimit > 0 && performanceState.budgetCheckCount >= performanceState.budgetCheckLimit;
    if (performanceState.budgetCheckLimit > 0 && performanceState.budgetCheckCount % 100000 === 0 && typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(`[planner-budget] checks=${performanceState.budgetCheckCount} limit=${performanceState.budgetCheckLimit} wallMs=${wallElapsedMs} perfMs=${elapsedMs} phase=${phase}`);
    }
    if (timerExceeded || counterExceeded) {
      if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(`[planner-budget] ABORT checks=${performanceState.budgetCheckCount} limit=${performanceState.budgetCheckLimit} wallMs=${wallElapsedMs} timer=${timerExceeded} counter=${counterExceeded}`);
      if (context) context.abortReason = "TIME_BUDGET_EXCEEDED";
      performanceState.aborted = true;
      performanceState.reason = "TIME_BUDGET_EXCEEDED";
      emitPlanningProgress(performanceState, phase);
      return true;
    }
    return false;
  }

  function assertPlanningBudget(performanceState, phase, context) {
    if (!checkPlanningBudget(performanceState, phase, context)) return;
    const error = new Error("TIME_BUDGET_EXCEEDED");
    error.code = PLANNING_BUDGET_EXCEEDED;
    throw error;
  }

  function isPlanningBudgetExceeded(error) {
    return error?.code === PLANNING_BUDGET_EXCEEDED;
  }

  function emitPlanningProgress(performanceState, phase) {
    if (!performanceState?.progress) return;
    try {
      const elapsedMs = Math.round(Math.max(planningNowMs(performanceState) - performanceState.startedAtMs, Date.now() - (performanceState.startedAtWallMs || Date.now())));
      performanceState.progress({
        phase,
        elapsedMs,
        scheduled: performanceState.scheduledOpsDone || 0,
        total: performanceState.scheduledOpsTotal || 0,
        strategy: performanceState.strategy || "",
        stats: { ...performanceState.stats },
      });
    } catch (_) {
      // Progress hooks are diagnostic-only and must not affect scheduling.
    }
  }

  function emitFinalizeProgress(performanceState) {
    if (!performanceState?.progress) return;
    try {
      performanceState.lastPhase = "finalize:select-best";
      performanceState.progress({
        phase: "finalize:select-best",
        elapsedMs: Math.round(Math.max(planningNowMs(performanceState) - performanceState.startedAtMs, Date.now() - (performanceState.startedAtWallMs || Date.now()))),
        scheduled: performanceState.scheduledOpsDone || 0,
        total: performanceState.scheduledOpsTotal || 0,
        strategy: "",
        stats: { ...performanceState.stats },
      });
    } catch (_) {
      // Progress hooks are diagnostic-only and must not affect scheduling.
    }
  }

  function attachPlanningPerformance(state, performanceState, abortReason = "") {
    if (!performanceState || !state?.lastSchedule) return;
    const elapsedMs = Math.round(Math.max(planningNowMs(performanceState) - performanceState.startedAtMs, Date.now() - (performanceState.startedAtWallMs || Date.now())));
    state.lastSchedule.performance = {
      startedAt: performanceState.startedAt,
      elapsedMs,
      lastPhase: performanceState.lastPhase,
      aborted: Boolean(abortReason || performanceState.aborted),
      reason: abortReason || performanceState.reason || "",
      budgetCheckCount: performanceState.budgetCheckCount || 0,
      budgetCheckLimit: performanceState.budgetCheckLimit || 0,
      startedAtWallMs: performanceState.startedAtWallMs || 0,
      stats: { ...performanceState.stats },
    };
  }

  const YIELD_INTERVAL_MS = 200;

  async function schedulePlan(inputState, options) {
    const onYield = typeof options?.onYield === "function" ? options.onYield : null;
    const earlyStop = options?.earlyStop !== false;
    const performanceState = createPlanningPerformanceState(options);
    const configuredPasses = options?.optimizationPasses ?? inputState?.settings?.optimizationPasses ?? 4;
    const completeAll = options?.completeAll === true;
    const flowBalancedEnabled = options?.flowBalancedEnabled ?? inputState?.settings?.flowBalancedEnabled ?? true;
    const operationCount = filterExcludedOperations(inputState, inputState?.operations).length;
    const fastQualityMode = options?.fastQualityMode === true || inputState?.settings?.fastQualityMode === true ||
      (performanceState?.timeBudgetMs > 0 && performanceState.timeBudgetMs <= FAST_QUALITY_BUDGET_MS);
    const volumePassLimit = operationCount <= 80 ? 4 : 1;
    const passCount = Math.min(clampInteger(configuredPasses, 1, 4), volumePassLimit);
    const strategyPool = ["balanced", "finish", "load", "tools", "makespan", "idle", "balance"];
    const strategyLimit = fastQualityMode ? Math.min(3, passCount + 2) : passCount + 2;
    const strategies = strategyPool.slice(0, Math.min(strategyLimit, strategyPool.length));
const evaluated = [];
    const strategyFailures = [];
    const strategySkips = [];
    let flowEvaluation;
    let completePlanFound = false;
    for (const [index, strategy] of strategies.entries()) {
      if (checkPlanningBudget(performanceState, `strategy:${strategy}:start`)) {
        if (!evaluated.length) break;
        break;
      }
      if (onYield) await onYield();
const result = await schedulePlanOnce(inputState, { ...(options || {}), strategy, fastQualityMode, __performanceState: performanceState, onYield });
      evaluated.push({ strategy, index, result, metrics: evaluatePlan(result) });
      if (result.lastSchedule?.performance?.aborted) {
        const complete = evaluated.filter((item) => !item.result?.lastSchedule?.performance?.aborted);
        if (complete.length) {
          emitFinalizeProgress(performanceState);
          return finalizeMultiStrategyPlan({ evaluated, selectable: complete, flowEvaluation, strategyFailures, strategySkips, volumePassLimit, performanceState, abortReason: "TIME_BUDGET_EXCEEDED" });
        }
        return result;
      }
      const hasCompletePlan = evaluated.some((item) => Number(item.metrics?.unscheduled || 0) === 0 && Number(item.metrics?.operatorConflicts || 0) === 0);
      if (earlyStop && hasCompletePlan && (evaluated.length >= 2 || completeAll)) {
        for (const pending of strategies.slice(evaluated.length)) {
          strategySkips.push({ strategy: pending, reason: "COMPLETE_PLAN_FOUND" });
        }
        completePlanFound = true;
        break;
      }
      if (fastQualityMode && evaluated.length >= 2) {
        const first = evaluated[0].metrics;
        const converged = evaluated.every((item) =>
          item.metrics.operatorConflicts === first.operatorConflicts &&
          item.metrics.unscheduled === first.unscheduled &&
          item.metrics.objective === first.objective
        );
        if (converged) {
          for (const pending of strategies.slice(evaluated.length)) {
            strategySkips.push({ strategy: pending, reason: "STRATEGY_CONVERGED" });
          }
          break;
        }
      }
    }
    if (flowBalancedEnabled && !completePlanFound) {
      const skipFastFlow = fastQualityMode && operationCount > 80;
      if (skipFastFlow) {
        strategySkips.push({ strategy: "flow_balanced", reason: "FAST_QUALITY_BUDGET" });
      } else {
        try {
          const strategy = "flow_balanced";
          if (!checkPlanningBudget(performanceState, `strategy:${strategy}:start`)) {
            if (onYield) await onYield();
            const result = await schedulePlanOnce(inputState, { ...(options || {}), strategy, fastQualityMode, __performanceState: performanceState, onYield });
            flowEvaluation = { strategy, index: evaluated.length, result, metrics: evaluatePlan(result) };
            evaluated.push(flowEvaluation);
            if (result.lastSchedule?.performance?.aborted) {
              const complete = evaluated.filter((item) => !item.result?.lastSchedule?.performance?.aborted);
              if (complete.length) {
                emitFinalizeProgress(performanceState);
                return finalizeMultiStrategyPlan({ evaluated, selectable: complete, flowEvaluation, strategyFailures, strategySkips, volumePassLimit, performanceState, abortReason: "TIME_BUDGET_EXCEEDED" });
              }
              return result;
            }
          }
        } catch (error) {
          strategyFailures.push({ strategy: "flow_balanced", message: String(error?.message || error || "ERROR_DESCONOCIDO") });
        }
      }
    }
    if (!evaluated.length) {
      return await schedulePlanOnce(inputState, { ...(options || {}), strategy: "balanced", fastQualityMode, __performanceState: performanceState, onYield });
    }
    emitFinalizeProgress(performanceState);
    return finalizeMultiStrategyPlan({ evaluated, selectable: evaluated, flowEvaluation, strategyFailures, strategySkips, volumePassLimit, performanceState });
  }

  async function schedulePlanOnce(inputState, options) {
    const performanceState = options?.__performanceState || createPlanningPerformanceState(options);
    const strategy = options?.strategy || "balanced";
    if (performanceState) {
      performanceState.strategy = strategy;
      if (options?.completeAll === true) performanceState.completeAll = true;
    }
    const isDryRun = options?.isDryRun === true || options?.__dryRun === true;
    const strategyStarted = planningNowMs(performanceState);
    if (performanceState) {
      performanceState.stats.strategiesStarted += 1;
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(`[planner-budget-init] strategy=${strategy} budgetCheckLimit=${performanceState.budgetCheckLimit} timeBudgetMs=${performanceState.timeBudgetMs} startedAtWallMs=${performanceState.startedAtWallMs} now=${Date.now()}`);
      }
      emitPlanningProgress(performanceState, `strategy:${strategy}:start`);
    }
    const operations = (Array.isArray(inputState.operations) ? inputState.operations : []).map((op, idx) => ({ ...op, num: idx + 1 }));
    const workOrdersByOt = new Map((inputState.workOrders || []).map((wo) => [normalizeKey(wo.ot), wo]));
    const state = { ...inputState, operations, lastSchedule: undefined };
    state.__performanceState = performanceState;
    state.__otConfigurationIndex = buildOtConfigurationIndex(state, performanceState);
    state.__toolCatalogByPart = buildToolCatalogIndex(state, performanceState);
    const settings = state.settings && typeof state.settings === "object" ? state.settings : {};
    const horizonDays = clampInteger(options?.horizonDays || state.horizonDays || DEFAULT_HORIZON_DAYS, 1, 45);
    const planStart = startOfDay(parseDateOnly(options?.planStart || state.planStart) || inferPlanStart(filterExcludedOperations(state, state.operations)));
    const requestedStart = atMinute(planStart, DEFAULT_START_MINUTE);
    const executionTime = parseExecutionTime(options?.executionTime);
    const windowStart = options?.startFromExecutionTime === true
      ? (executionTime ? ceilToSnap(executionTime) : requestedStart)
      : (options?.respectPlanStart === true
        ? requestedStart
        : (executionTime && executionTime > requestedStart ? ceilToSnap(executionTime) : requestedStart));
    const newnessBase = options?.baseSnapshot?.fullState || options?.baseSnapshot || null;
    const newnessIndex = newnessBase ? buildNewnessIndex(newnessBase) : null;
    const nowAnchor = executionTime;
    const windowEnd = atMinute(addDays(startOfDay(planStart), MAX_SCHEDULING_DAYS), DEFAULT_START_MINUTE);
    const diagnostics = [];
    state.__windowCache = new Map();
    state.__workOrdersByOt = new Map((inputState.workOrders || []).map((wo) => [normalizeKey(wo.ot), wo]));
    const allOperations = state.operations;
    const preservedCompletedChanges = allOperations
      .filter((op) => op.generatedBy === GENERATED_BY && isPlanCompletedOperation(state, op))
      .map((op, index) => applyOtConfiguration(state, normalizeOperation(op, index, state), isDryRun));
    const sourceOperations = expandAdditionalToolOperations(state, allOperations
      .filter((op) => op.generatedBy !== GENERATED_BY)
      .map((op, index) => applyOtConfiguration(state, normalizeOperation(op, index, state), isDryRun)));
    const excludedCapabilityOperations = sourceOperations.filter((op) => isOperationCapabilityExcluded(state, op));
    const includedSourceOperations = filterExcludedOperations(state, sourceOperations);
    const completed = includedSourceOperations.filter((op) => isPlanCompletedOperation(state, op));
    const inactive = includedSourceOperations.filter((op) => !isPlanCompletedOperation(state, op) && (!isSchedulableOperation(op) || isHistoricalOperation(op)));
    const activeSourceOperations = includedSourceOperations.filter((op) => !isPlanCompletedOperation(state, op) && isSchedulableOperation(op) && !isHistoricalOperation(op));
    const selectionDefined = Array.isArray(state.selectedOts);
    const selectedOtsSet = new Set((state.selectedOts || []).map(normalizeKey));
    const isSelected = (op) => !selectionDefined || selectedOtsSet.has(normalizeKey(op.ot));

    const context = {
      state,
      settings,
      horizonDays,
      planStart,
      windowStart,
      windowEnd,
      diagnostics,
      operatorBusy: new Map(),
      machineBusy: new Map(),
      operatorLoad: new Map(),
      machineTools: new Map(),
      scheduledByKey: new Map(),
      scheduledById: new Map(),
      generatedChanges: [],
      changeCounter: 0,
      gapFilled: 0,
      strategy,
      newnessIndex,
      nowAnchor,
      performanceState,
      abortReason: "",
      lastAllocationConflictEnd: null,
      flowWipTarget: options?.strategy === "flow_balanced"
        ? clampInteger(options?.flowWipTarget ?? settings.flowWipTarget ?? 10, 1, 50)
        : 10,
      fastQualityMode: options?.fastQualityMode === true,
      isDryRun: options?.isDryRun === true || options?.__dryRun === true,
    };

    const authorizedStatuses = selectionDefined
      ? (Array.isArray(state.operationPlanStatuses) ? state.operationPlanStatuses : Object.values(state.operationPlanStatuses || {}))
        .filter((item) => selectedOtsSet.has(normalizeKey(item?.ot)))
      : state.operationPlanStatuses;
    const authorizedToolHistory = selectionDefined
      ? (Array.isArray(state.machineToolHistory) ? state.machineToolHistory : [])
        .filter((item) => selectedOtsSet.has(normalizeKey(item?.ot)))
        .filter(isCompletedToolHistory)
      : (Array.isArray(state.machineToolHistory) ? state.machineToolHistory : []).filter(isCompletedToolHistory);
    const authorizedSourceOperations = includedSourceOperations.filter(isSelected);
    const authorizedHistoricalOperations = authorizedSourceOperations.filter((op) =>
      isPlanCompletedOperation(state, op) || isFixedOperation(state, op)
    );
    let fixed = [];
    let movable = [];
    let excluded = activeSourceOperations.filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL" && isSelected(op));
    let jobs = [];
    try {
      assertPlanningBudget(performanceState, "scheduler:seed", context);
      seedCompletedToolStates(context, authorizedStatuses);
      seedMachineToolHistory(context, authorizedToolHistory, authorizedHistoricalOperations);

      fixed = activeSourceOperations.filter((op) => isFixedOperation(state, op) && isSelected(op));
      movable = activeSourceOperations.filter((op) =>
        !isFixedOperation(state, op) &&
        op.tipoInsercion !== "CAMBIO_HERRAMENTAL" &&
        isSelected(op) &&
        isAssignableOperation(state, op)
      );
      excluded = activeSourceOperations.filter((op) =>
        op.tipoInsercion !== "CAMBIO_HERRAMENTAL" &&
        (!isSelected(op) || (!isFixedOperation(state, op) && !isAssignableOperation(state, op)))
      );
      for (const op of fixed) {
        assertPlanningBudget(performanceState, "fixed-operations", context);
        commitFixedOperation(context, op);
      }

      enrichToolsFromCatalog(state, movable);
      jobs = buildJobs(movable, [...completed.filter(isSelected), ...fixed], state);
      excluded = activeSourceOperations.filter((op) =>
        op.tipoInsercion !== "CAMBIO_HERRAMENTAL" &&
        (!isSelected(op) || (!isFixedOperation(state, op) && !isAssignableOperation(state, op)))
      );
    } catch (error) {
      if (!isPlanningBudgetExceeded(error)) throw error;
      context.abortReason = "TIME_BUDGET_EXCEEDED";
      if (!jobs.length && movable.length) excluded = [...excluded, ...movable];
    }
    let pending = movable.length;
    if (performanceState) {
      performanceState.scheduledOpsTotal = movable.length;
      performanceState.scheduledOpsDone = 0;
    }
    // Mark first operations in jobs for sequence protection
    // These operations must be scheduled before subsequent operations of the same OT
    // and must maintain PENDIENTE/planeado status
    jobs.forEach(job => {
      if (job.operations[0]) {
        job.operations[0]._protectedSequence = true;
      }
    });
    let safety = Math.max(100, pending * 4);
    const onYield = typeof options?.onYield === "function" ? options.onYield : null;
    let lastYieldAt = Date.now();

    try {
      while (!context.abortReason && pending > 0 && safety-- > 0) {
        countPlanningStat(performanceState, "mainLoopIterations");
        assertPlanningBudget(performanceState, "main-loop", context);
        if (onYield && Date.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
          await onYield();
          lastYieldAt = Date.now();
        }
        const ready = [];
        for (const job of jobs) {
          assertPlanningBudget(performanceState, "job-scan", context);
          const op = job.operations[job.index];
          if (!op) continue;
          const previous = latestPredecessor(job.last, fixedPredecessor(job, op));
          const cached = job.__planAssignment;
          let assignment = null;
          if (cached && cached.op === op && cached.unique && isCachedAssignmentValid(context, cached.assignment)) {
            assignment = cached.assignment;
            assignment.operatorLoad = context.operatorLoad.get(assignment.operator) || 0;
            assignment.projectedOperatorLoad = (context.operatorLoad.get(assignment.operator) || 0) + assignment.productionMinutes;
            countPlanningStat(performanceState, "cachedAssignmentReuses");
          } else {
            const candidates = findAssignments(context, op, previous)
              .filter((candidate) => respectsFixedSuccessor(context, job, op, candidate));
            candidates.sort((a, b) => compareAssignments(a, b, context.strategy));
            assignment = candidates[0] || null;
            if (assignment) {
              job.__planAssignment = { op, assignment, unique: candidates.length === 1 };
            }
          }
          if (assignment) ready.push({ job, op, assignment });
        }

        if (!ready.length) break;
        const candidates = context.strategy === "flow_balanced" || context.fastQualityMode
          ? flowReadyCandidates(ready, jobs, context.flowWipTarget)
          : ready;
        candidates.sort((a, b) => compareReadyCandidates(a, b, false, context.strategy, context));
        const chosen = candidates[0];
        chosen.assignment.gapFill = isLaterOperationGapFill(context, chosen.job, chosen.assignment);
        const committed = commitAssignment(context, chosen.op, chosen.assignment);
        chosen.job.last = committed;
        chosen.job.index += 1;
        pending -= 1;
        if (performanceState) performanceState.scheduledOpsDone += 1;
      }
    } catch (error) {
      if (!isPlanningBudgetExceeded(error)) throw error;
      context.abortReason = "TIME_BUDGET_EXCEEDED";
    }

    const unscheduled = [];
    for (const job of jobs) {
      for (let index = job.index; index < job.operations.length; index++) {
        const op = job.operations[index];
        op.operador = "SIN_OPERADOR";
        op.fechaInicio = ""; op.horaInicio = ""; op.fechaFin = ""; op.horaFin = "";
        if (!isBendingOperation(op) && op.tipoInsercion !== "CAMBIO_HERRAMENTAL") op.maquina = "";
        op.log = appendLog(op.log, "WARN_SIN_HUECO_EN_HORIZONTE");
        unscheduled.push(op);
        diagnostics.push({
          level: "WARN", code: "UNSCHEDULED", operationId: op.id, ot: op.ot, sequence: op.secuencia,
          cause: unscheduledCause(state, op),
        });
      }
    }
    if (context.abortReason) {
      diagnostics.push({ level: "ERROR", code: context.abortReason, phase: performanceState?.lastPhase || "scheduler", message: "Se excedio el presupuesto de tiempo de planeacion" });
    }

    const fixedIds = new Set(fixed.map((item) => item.id));
    const scheduled = [...context.scheduledByKey.values()]
      .filter((op) => !fixedIds.has(op.id));
    state.operations = [...completed, ...inactive, ...preservedCompletedChanges, ...fixed, ...context.generatedChanges, ...scheduled, ...unscheduled, ...excluded, ...excludedCapabilityOperations]
      .sort(compareScheduledOperations)
      .map((op, index) => ({ ...op, num: index + 1 }));
    state.planStart = formatDate(planStart);
    state.horizonDays = horizonDays;
    const activeOperations = [...fixed.filter(isSelected), ...context.generatedChanges, ...scheduled]
      .filter((op) => operationStart(op) && operationEnd(op));
    const operatorConflicts = operatorOverlapConflicts(activeOperations, state);
    for (const conflict of operatorConflicts) {
      diagnostics.push({
        level: "ERROR",
        code: "OPERATOR_OVERLAP",
        operator: conflict.operator,
        operationId: conflict.secondOperationId,
        relatedOperationId: conflict.firstOperationId,
        ot: conflict.secondOt,
        relatedOt: conflict.firstOt,
        overlapStart: conflict.overlapStart,
        overlapEnd: conflict.overlapEnd,
      });
    }
    state.lastSchedule = {
      generatedAt: new Date().toISOString(),
      engine: GENERATED_BY,
      scheduled: scheduled.length,
      selectedJobs: selectedOtsSet.size,
      scheduledOts: [...new Set([...fixed.filter(isSelected), ...context.generatedChanges, ...scheduled]
        .filter((op) => operationStart(op) && operationEnd(op))
        .map((op) => String(op.ot || "").trim())
        .filter(Boolean))],
      changes: context.generatedChanges.length,
      gapFilled: context.gapFilled,
      unscheduled: unscheduled.length,
      operatorConflicts: operatorConflicts.length,
      diagnostics,
    };
    if (performanceState) {
      performanceState.stats.strategyTimings.push({ strategy, elapsedMs: Math.round(planningNowMs(performanceState) - strategyStarted), aborted: Boolean(context.abortReason) });
      attachPlanningPerformance(state, performanceState, context.abortReason);
    }
    return state;
  }

  function seedCompletedToolStates(context, statuses) {
    const entries = Array.isArray(statuses) ? statuses : Object.values(statuses || {});
    for (const item of entries) {
      if (normalizeKey(item?.status || item?.planStatus) !== "COMPLETADA_PLAN") continue;
      const machine = String(item.machine || item.maquina || "").trim();
      const toolKey = String(item.toToolKey || item.toolKey || "").trim();
      if (!machine || machine === "SIN_MAQUINA" || !toolKey) continue;
      const events = context.machineTools.get(machine) || [];
      events.push({
        start: context.windowStart.getTime(),
        end: context.windowStart.getTime(),
        toolKey,
        operationId: item.operationId || item.key || "completed",
        isChange: normalizeKey(item?.type || item?.tipo) === "TOOL_CHANGE",
        completed: true,
      });
      context.machineTools.set(machine, events);
    }
  }

  function isCompletedToolHistory(item) {
    return item?.completed === true || normalizeKey(item?.status || item?.planStatus) === "COMPLETADA_PLAN";
  }

  function seedMachineToolHistory(context, history, operations) {
    const historical = Array.isArray(history) ? history : [];
    const candidates = [
      ...historical.map((item) => ({
        machine: item.machine || item.maquina,
        toolKey: item.toolKey || historicalToolKey(item),
        operationId: item.operationId || item.id || `history-${item.ot || "ot"}`,
        start: parseDateTime(item.startDate || item.fechaInicio || item.endDate || item.fechaFin, item.startTime || item.horaInicio || item.endTime || item.horaFin),
        end: parseDateTime(item.endDate || item.fechaFin, item.endTime || item.horaFin),
        historical: true,
      })),
      ...(operations || []).map((op) => ({
        machine: op.maquina,
        toolKey: operationToolKey(op),
        operationId: op.id,
        start: operationStart(op),
        end: operationEnd(op),
        historical: true,
      })),
    ];
    for (const item of candidates) {
      const machine = String(item.machine || "").trim();
      if (!machine || normalizeKey(machine) === "SIN_MAQUINA" || !item.toolKey || !item.end || item.end > context.windowStart) continue;
      const events = context.machineTools.get(machine) || [];
      events.push({
        start: (item.start || item.end).getTime(),
        end: item.end.getTime(),
        toolKey: item.toolKey,
        operationId: item.operationId,
        historical: true,
      });
      events.sort((a, b) => a.end - b.end);
      context.machineTools.set(machine, events);
    }
  }

  function historicalToolKey(item) {
    const herramental = cleanTool(item?.herramental);
    const kit = cleanTool(item?.kitHerramental || item?.kit);
    if (!herramental && !kit) return "";
    return `${herramental || "SIN_HERR"}/${kit || "SIN_KIT"}`;
  }

  function findBestAssignment(context, job, op, previous) {
    if (context.abortReason) return null;
    countPlanningStat(context.performanceState, "findBestAssignmentCalls");
    const assignments = findAssignments(context, op, previous)
      .filter((assignment) => respectsFixedSuccessor(context, job, op, assignment));
    assignments.sort((a, b) => compareAssignments(a, b, context.strategy));
    return assignments[0] || null;
  }

  function findAssignments(context, op, previous) {
    const earliest = computeEarliestStart(context, op, previous);
    if (earliest >= context.windowEnd) return [];
    if (isSubcontractOperation(context.state, op)) {
      const assignment = findSubcontractAssignment(context, op, earliest);
      return assignment ? [{ ...assignment, earliest: new Date(earliest) }] : [];
    }
    const finite = isFiniteOperation(context.state, op);
    const operators = operatorCandidates(context.state, op, finite);
    if (!operators.length) return [];

    const machines = machineCandidates(context.state, op);
    if (!machines.length) return [];

    const assignments = [];
    const selectedMachine = String(op.maquina || "").trim();
    const machineOrder = selectedMachine ? [selectedMachine, ...machines.filter(m => m && normalizeKey(m) !== "SIN_MAQUINA" && m !== selectedMachine && !(String(op.ct) === "5459" && String(m) === "1")).slice(0, 2)] : machines;

    for (const operator of operators) {
      for (const machine of machineOrder) {
        if (context.abortReason) return assignments;
        countPlanningStat(context.performanceState, "assignmentCandidateEvaluations");
        assertPlanningBudget(context.performanceState, "assignment-candidates", context);
        const assignment = findEarliestSlot(context, op, earliest, operator, machine, finite);
        if (assignment) assignments.push({ ...assignment, earliest: new Date(earliest) });
      }
    }
    return assignments;
  }

  function findEarliestSlot(context, op, earliest, operator, machine, finite) {
    if (context.abortReason) return null;
    let cursor = ceilToSnap(earliest);
    while (!context.abortReason && cursor < context.windowEnd) {
      countPlanningStat(context.performanceState, "slotProbes");
      if (checkPlanningBudget(context.performanceState, "slot-probes", context)) {
        countPlanningStat(context.performanceState, "slotProbeSkips");
        return null;
      }
      context.lastAllocationConflictEnd = null;
      let postToolChangeFailed = false;
      const toolChange = toolChangeFor(context, op, machine, cursor);
      const setupMinutes = toolChange.minutes;
      const performance = operatorPerformanceForOperation(context.state, op, operator);
      const efficiency = operationEfficiencyForOperation(context.state, op);
      const productionMinutes = operationDuration(op, performance, efficiency);
      const preserveFractionalDuration = op?.tiempoFallback === true;
      let allocation;
      let setupOperator = "";
      if (toolChange.required && setupMinutes > 0) {
        setupOperator = toolChangeOperator(context.state, context.settings);
        if (!setupOperator) return null;
        const setupAllocation = allocateWork(context, cursor, setupMinutes, {
          operator: setupOperator,
          machine,
          finite,
          setupMinutes: 0,
        });
        const productionAllocation = setupAllocation && allocateWork(context, setupAllocation.end, productionMinutes, {
          operator,
          machine,
          finite,
          setupMinutes: 0,
          preserveFractionalDuration,
        });
        if (setupAllocation && productionAllocation && setupAllocation.end.getTime() === productionAllocation.start.getTime()) {
          allocation = {
            start: setupAllocation.start,
            operationStart: productionAllocation.start,
            setupEnd: setupAllocation.end,
            end: productionAllocation.end,
            segments: [...setupAllocation.segments, ...productionAllocation.segments],
            setupSegments: setupAllocation.segments,
            productionSegments: productionAllocation.segments,
          };
        }
      } else {
        const productionAllocation = allocateWork(context, cursor, productionMinutes, {
          operator,
          machine,
          finite,
          setupMinutes: 0,
          preserveFractionalDuration,
        });
        if (productionAllocation) {
          allocation = {
            ...productionAllocation,
            setupEnd: productionAllocation.start,
            setupSegments: [],
            productionSegments: productionAllocation.segments,
          };
        }
      }
      if (allocation) {
        const postToolChange = findPostToolChange(context, op, machine, allocation);
        if (postToolChange === null) {
          postToolChangeFailed = true;
          allocation = null;
        } else {
          return {
            ...allocation,
            operator,
            machine,
            finite,
            setupMinutes,
            productionMinutes,
            setupOperator,
            toolChange,
            postToolChange,
            toolPenalty: toolChange.required ? 1 : 0,
            operatorLoad: context.operatorLoad.get(operator) || 0,
            projectedOperatorLoad: (context.operatorLoad.get(operator) || 0) + productionMinutes,
          };
        }
      }
      const postChangeMinutes = postToolChangeFailed ? Math.max(1, numberOr(context.settings.toolChangeMinutes, 120)) : 0;
      const allocationConflictEnd = context.lastAllocationConflictEnd;
      const conflictEnd = allocationConflictEnd && allocationConflictEnd > cursor ? allocationConflictEnd : nextBusyConflictEnd(
        context,
        cursor,
        addMinutes(cursor, setupMinutes + productionMinutes + postChangeMinutes),
        [operator, setupOperator, postToolChangeFailed ? toolChangeOperator(context.state, context.settings) : ""].filter(Boolean),
        machine,
        finite
      );
      cursor = conflictEnd && conflictEnd > cursor
        ? ceilToSnap(conflictEnd)
        : addMinutes(cursor, SEARCH_STEP_MINUTES);
    }
    return null;
  }

  function allocateWork(context, requestedStart, totalMinutes, resources) {
    const duration = resources.preserveFractionalDuration ? totalMinutes : Math.max(1, Math.ceil(totalMinutes));
    let remaining = duration;
    let cursor = ceilToSnap(requestedStart);
    let first = null;
    let operationStart = null;
    let consumed = 0;
    const segments = [];

    while (!context.abortReason && cursor < context.windowEnd && remaining > 0) {
      assertPlanningBudget(context.performanceState, "allocate-work", context);
      const availableUntil = currentAvailabilityEnd(context.state, cursor, resources.operator, resources.machine);
      if (!availableUntil) {
        if (!first) return null;
        cursor = ceilToSnap(nextAvailableMoment(context.state, cursor, resources.operator, resources.machine, context.windowEnd));
        continue;
      }
      const segmentMinutes = Math.min(ALLOCATION_CHUNK_MINUTES, remaining, diffMinutes(cursor, availableUntil));
      const segmentEnd = addMinutes(cursor, segmentMinutes);
      const operatorConflictEnd = resources.finite ? firstBusyOverlapEnd(context.operatorBusy.get(resources.operator), cursor, segmentEnd, context.performanceState) : null;
      const machineConflictEnd = resources.finite && hasMachineResource(resources.machine)
        ? firstBusyOverlapEnd(context.machineBusy.get(resources.machine), cursor, segmentEnd, context.performanceState)
        : null;
      const conflictEnd = maxDate(operatorConflictEnd, machineConflictEnd);
      if (conflictEnd) {
        context.lastAllocationConflictEnd = maxDate(context.lastAllocationConflictEnd, conflictEnd);
        return null;
      }

      if (!first) first = new Date(cursor);
      segments.push({ start: new Date(cursor), end: new Date(segmentEnd) });
      consumed += segmentMinutes;
      remaining -= segmentMinutes;
      if (!operationStart && consumed >= resources.setupMinutes) operationStart = new Date(segmentEnd);
      cursor = segmentEnd;

      if (remaining > 0) {
        assertPlanningBudget(context.performanceState, "allocate-work:calendar", context);
        const nextEnd = addMinutes(cursor, Math.min(ALLOCATION_CHUNK_MINUTES, remaining));
        if (!isCalendarAvailable(context.state, cursor, nextEnd, resources.operator, resources.machine)) {
          cursor = ceilToSnap(nextAvailableMoment(context.state, cursor, resources.operator, resources.machine, context.windowEnd));
        }
      }
    }

    if (remaining > 0 || !first) return null;
    return {
      start: first,
      operationStart: resources.setupMinutes > 0 ? operationStart || first : first,
      end: new Date(cursor),
      segments: mergeSegments(segments),
    };
  }

  function findSubcontractAssignment(context, op, earliest) {
    const rule = subcontractRule(context.state, op);
    const configuredDays = op.subcontractDays;
    if (!Number.isFinite(Number(configuredDays)) || Number(configuredDays) <= 0) return null;
    const days = clampInteger(configuredDays, 1, 90);
    const subcontractWindowEnd = addDays(startOfDay(earliest), 366);
    const end = addWorkingDays(context.state, earliest, days, subcontractWindowEnd);
    if (!end) return null;
    return {
      start: earliest,
      operationStart: earliest,
      end,
      segments: [{ start: earliest, end }],
      operator: "SUBCONTRATO",
      machine: "",
      finite: false,
      setupMinutes: 0,
      productionMinutes: Math.max(SNAP_MINUTES, diffMinutes(earliest, end)),
      toolChange: { required: false, minutes: 0 },
      toolPenalty: 0,
      operatorLoad: 0,
      projectedOperatorLoad: 0,
      subcontractRule: {
        name: op.subcontractType || rule?.name || "SUBCONTRATO",
        days,
      },
    };
  }

  function commitAssignment(context, op, assignment) {
    const next = { ...op };
    next.operador = assignment.operator;
    next.maquina = assignment.machine;
    next.fechaInicio = formatDate(assignment.operationStart);
    next.horaInicio = formatTime(assignment.operationStart);
    next.fechaFin = formatDate(assignment.end);
    next.horaFin = formatTime(assignment.end);
    next.needsReschedule = false;
    next.planStatus = "PENDIENTE";
    if (assignment.setupMinutes > 0 && !(Number(next.tiempoSetup) > 0)) next.tiempoSetup = assignment.setupMinutes;
    Object.assign(next, waitDiagnostic(context, assignment));
    next.log = appendLog(next.log, assignment.subcontractRule
      ? `SUBCONTRATO ${assignment.subcontractRule.name || "DEFAULT"}`
      : `PROGRAMADO_${GENERATED_BY}`);
    if (assignment.gapFill) {
      next.log = appendLog(next.log, "GAP_FILL_SEQ2_PLUS");
      context.gapFilled += 1;
    }

    const tracksOperator = assignment.finite && isLoadBearingOperator(assignment.operator);
    const busyMetadata = { operationId: next.id, ot: next.ot, secuencia: next.secuencia, performanceState: context.performanceState };
    if (tracksOperator) addBusySegments(context.operatorBusy, assignment.operator, assignment.productionSegments || assignment.segments, { ...busyMetadata, resourceType: "OPERADOR" });
    if (isLoadBearingOperator(assignment.setupOperator) && assignment.setupSegments?.length) {
      addBusySegments(context.operatorBusy, assignment.setupOperator, assignment.setupSegments, { ...busyMetadata, resourceType: "OPERADOR" });
      context.operatorLoad.set(assignment.setupOperator, (context.operatorLoad.get(assignment.setupOperator) || 0) + assignment.setupMinutes);
    }
    if (assignment.finite && hasMachineResource(assignment.machine)) addBusySegments(context.machineBusy, assignment.machine, assignment.segments, { ...busyMetadata, resourceType: "MAQUINA" });
    if (tracksOperator) {
      context.operatorLoad.set(assignment.operator, (context.operatorLoad.get(assignment.operator) || 0) + assignment.productionMinutes);
    }

    if (assignment.toolChange.required && assignment.setupMinutes > 0) {
      const change = createToolChangeOperation(context, next, assignment);
      context.generatedChanges.push(change);
      next.log = appendLog(next.log, `CAMBIO_HERR_KIT ${assignment.toolChange.fromLabel} -> ${assignment.toolChange.toLabel}`);
    }
    if (assignment.postToolChange?.required) {
      addBusySegments(context.operatorBusy, assignment.postToolChange.operator, assignment.postToolChange.segments, { ...busyMetadata, resourceType: "OPERADOR" });
      if (assignment.finite && hasMachineResource(assignment.machine)) addBusySegments(context.machineBusy, assignment.machine, assignment.postToolChange.segments, { ...busyMetadata, resourceType: "MAQUINA" });
      context.operatorLoad.set(
        assignment.postToolChange.operator,
        (context.operatorLoad.get(assignment.postToolChange.operator) || 0) + assignment.postToolChange.minutes
      );
      const returnChange = createPostToolChangeOperation(context, next, assignment.postToolChange);
      context.generatedChanges.push(returnChange);
    }

    const toolKey = operationToolKey(next);
    if (hasMachineResource(assignment.machine) && toolKey) {
      const events = context.machineTools.get(assignment.machine) || [];
      const newEvent = {
        start: assignment.operationStart.getTime(),
        end: assignment.end.getTime(),
        toolKey,
        operationId: next.id,
        preChangeStart: assignment.toolChange.required ? assignment.start.getTime() : null,
      };
      const endTime = newEvent.end;
      let lo = 0, hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].end <= endTime) lo = mid + 1;
        else hi = mid;
      }
      events.splice(lo, 0, newEvent);
      if (assignment.postToolChange?.required) {
        const postEvent = {
          start: assignment.postToolChange.start.getTime(),
          end: assignment.postToolChange.end.getTime(),
          toolKey: assignment.postToolChange.toLabel,
          operationId: returnChangeId(next.id, context.changeCounter),
          isChange: true,
        };
        const postEnd = postEvent.end;
        while (lo < events.length && events[lo].end <= postEnd) lo++;
        events.splice(lo, 0, postEvent);
      }
      context.machineTools.set(assignment.machine, events);
    }

    context.scheduledByKey.set(operationKey(next), next);
    context.scheduledById.set(next.id, next);
    return {
      operation: next,
      start: assignment.operationStart,
      end: assignment.end,
      duration: assignment.productionMinutes,
      segments: assignment.productionSegments || assignment.segments,
    };
  }

  function createToolChangeOperation(context, operation, assignment) {
    context.changeCounter += 1;
    const [fromHerramental, fromKit] = splitToolKey(assignment.toolChange.fromLabel);
    const [toHerramental, toKit] = splitToolKey(assignment.toolChange.toLabel);
    const completionKey = toolChangeCompletionKey(operation, assignment.machine, assignment.toolChange.toLabel);
    return {
      ...operation,
      id: `chg-${operation.id}-${context.changeCounter}`,
      num: 0,
      descripcion: "CAMBIO DE HERRAMENTAL / KIT",
      contenido: "",
      ct: TOOL_CHANGE_CAPABILITY.ct,
      operador: assignment.setupOperator || toolChangeOperator(context.state, context.settings) || "SIN_OPERADOR",
      herramental: reportableToolValue(toHerramental),
      kitHerramental: reportableToolValue(toKit),
      fechaInicio: formatDate(assignment.start),
      horaInicio: formatTime(assignment.start),
      fechaFin: formatDate(assignment.setupEnd || assignment.operationStart),
      horaFin: formatTime(assignment.setupEnd || assignment.operationStart),
      tiempoCiclo: 0,
      tiempoSetup: assignment.setupMinutes,
      tiempoProd: 0,
      tipoInsercion: "CAMBIO_HERRAMENTAL",
      estatus: "PLAN",
      generatedBy: GENERATED_BY,
      generatedAdditionalTool: false,
      completionKey,
      toolChangeFromHerramental: reportableToolValue(fromHerramental),
      toolChangeFromKit: reportableToolValue(fromKit),
      toolChangeToHerramental: reportableToolValue(toHerramental),
      toolChangeToKit: reportableToolValue(toKit),
      log: `${GENERATED_BY} ${assignment.toolChange.fromLabel} -> ${assignment.toolChange.toLabel}`,
    };
  }

  function createPostToolChangeOperation(context, operation, postToolChange) {
    context.changeCounter += 1;
    const target = context.scheduledById.get(postToolChange.targetOperationId) || operation;
    const [herramental, kit] = splitToolKey(postToolChange.toLabel);
    const [fromHerramental, fromKit] = splitToolKey(postToolChange.fromLabel);
    const completionKey = toolChangeCompletionKey(target, operation.maquina, postToolChange.toLabel);
    return {
      ...target,
      id: returnChangeId(operation.id, context.changeCounter),
      num: 0,
      descripcion: "CAMBIO DE HERRAMENTAL / KIT",
      contenido: "",
      ct: TOOL_CHANGE_CAPABILITY.ct,
      operador: postToolChange.operator,
      maquina: operation.maquina,
      herramental: herramental === "SIN_HERR" ? "" : herramental,
      kitHerramental: kit === "SIN_KIT" ? "" : kit,
      fechaInicio: formatDate(postToolChange.start),
      horaInicio: formatTime(postToolChange.start),
      fechaFin: formatDate(postToolChange.end),
      horaFin: formatTime(postToolChange.end),
      tiempoCiclo: 0,
      tiempoSetup: postToolChange.minutes,
      tiempoProd: 0,
      tipoInsercion: "CAMBIO_HERRAMENTAL",
      estatus: "PLAN",
      generatedBy: GENERATED_BY,
      generatedAdditionalTool: false,
      completionKey,
      toolChangeFromHerramental: reportableToolValue(fromHerramental),
      toolChangeFromKit: reportableToolValue(fromKit),
      toolChangeToHerramental: reportableToolValue(herramental),
      toolChangeToKit: reportableToolValue(kit),
      log: `${GENERATED_BY} ${postToolChange.fromLabel} -> ${postToolChange.toLabel}`,
    };
  }

  function returnChangeId(operationId, counter) {
    return `chg-return-${operationId}-${counter}`;
  }

  function toolChangeCompletionKey(operation, machine, toToolKey) {
    return `TOOL_CHANGE|${normalizeKey(operation?.id || `${operation?.ot || "OT"}-${operation?.secuencia || 0}`)}|${normalizeKey(machine)}|${normalizeKey(toToolKey)}`;
  }

  function commitFixedOperation(context, op) {
    op.esperaMinutos = 0;
    op.causaEspera = "";
    op.recursoEspera = "";
    op.otBloqueadora = "";
    op.secuenciaBloqueadora = "";
    const start = operationStart(op);
    const end = operationEnd(op);
    if (start && end) {
      const segments = [{ start, end }];
      const tracksOperator = isFiniteOperation(context.state, op) && isLoadBearingOperator(op.operador);
      const busyMetadata = { operationId: op.id, ot: op.ot, secuencia: op.secuencia, performanceState: context.performanceState };
      if (tracksOperator) addBusySegments(context.operatorBusy, op.operador, segments, { ...busyMetadata, resourceType: "OPERADOR" });
      if (isFiniteOperation(context.state, op) && hasMachineResource(op.maquina)) addBusySegments(context.machineBusy, op.maquina, segments, { ...busyMetadata, resourceType: "MAQUINA" });
      if (tracksOperator) context.operatorLoad.set(op.operador, (context.operatorLoad.get(op.operador) || 0) + diffMinutes(start, end));
    }
    if (end && hasMachineResource(op.maquina) && operationToolKey(op)) {
      const events = context.machineTools.get(op.maquina) || [];
      events.push({ start: start?.getTime() || end.getTime(), end: end.getTime(), toolKey: operationToolKey(op), operationId: op.id, isChange: op.tipoInsercion === "CAMBIO_HERRAMENTAL" });
      context.machineTools.set(op.maquina, events);
    }
    context.scheduledByKey.set(operationKey(op), op);
  }

  function computeEarliestStart(context, op, previous) {
    let earliest = new Date(context.windowStart);
    if (previous?.operation) {
      const predecessorLimit = predecessorReleaseMoment(context, previous);
      if (predecessorLimit && predecessorLimit > earliest) earliest = predecessorLimit;
    }
    if (context?.nowAnchor && isNewOperation(context, op)) {
      const anchor = ceilToSnap(context.nowAnchor);
      // El ancla de "hora actual" solo aplica a operaciones del MISMO dia calendario
      // de ejecucion: evita programar hoy hacia el pasado sin desplazar el arranque
      // de turno de los dias siguientes (que respetan el inicio del calendario).
      const onExecutionDay = startOfDay(anchor).getTime() === startOfDay(earliest).getTime();
      if (onExecutionDay && anchor > earliest) earliest = anchor;
    }

    return nextAvailableMoment(context.state, earliest, "", "", context.windowEnd);
  }

  function predecessorReleaseMoment(context, previous) {
    const ratio = overlapForOperation(context.state, previous.operation);
    const durationKnown = Number.isFinite(previous.duration) && previous.duration > 0;
    let limit = previous.end;
    if (!isSubcontractOperation(context.state, previous.operation) && ratio < 1 && durationKnown) {
      const milestoneMinutes = Math.round(previous.duration * ratio);
      const partialMilestone = previous.segments?.length
        ? productiveMilestone(previous.segments, milestoneMinutes)
        : addGeneralWorkMinutes(context.state, previous.start, milestoneMinutes, context.windowEnd);
      if (partialMilestone && partialMilestone < previous.end) limit = partialMilestone;
    }
    return limit;
  }

  function productiveMilestone(segments, minutes) {
    let remaining = Math.max(0, roundUp(minutes, SNAP_MINUTES));
    for (const segment of segments || []) {
      const duration = Math.max(0, diffMinutes(segment.start, segment.end));
      if (remaining <= duration) return addMinutes(segment.start, remaining);
      remaining -= duration;
    }
    return null;
  }

  function respectsFixedSuccessor(context, job, op, assignment) {
    const fixed = new Set(job.fixedOperations);
    const future = [
      ...job.operations.slice(job.index + 1),
      ...job.fixedOperations.filter((operation) => compareOperationSequence(operation, op) > 0),
    ].sort(compareOperationSequence);
    const fixedIndex = future.findIndex((operation) => fixed.has(operation));
    if (fixedIndex < 0) return true;
    const successor = future[fixedIndex];
    const fixedStart = operationStart(successor);
    if (!fixedStart) return true;
    const probeContext = cloneFeasibilityContext(context);
    const probeJob = { ...job };
    const previous = commitAssignment(probeContext, op, { ...assignment, gapFill: false });
    const feasibility = fixedChainFeasibility(
      probeContext,
      probeJob,
      future.slice(0, fixedIndex),
      fixedStart,
      previous,
      { remaining: MAX_FIXED_CHAIN_PROBES },
    );
     return feasibility !== FIXED_CHAIN_INFEASIBLE;
  }

  function fixedChainFeasibility(context, job, intermediates, fixedStart, previous, budget) {
    if (!intermediates.length) {
      const release = predecessorReleaseMoment(context, previous);
      return release && release <= fixedStart ? FIXED_CHAIN_FEASIBLE : FIXED_CHAIN_INFEASIBLE;
    }
    const [intermediate, ...rest] = intermediates;
    const probeJob = { ...job, index: job.operations.indexOf(intermediate) };
    const assignments = findAssignments(context, intermediate, previous)
      .sort((a, b) => compareFixedChainAssignments(context, intermediate, a, b));
    for (const assignment of assignments) {
      if (budget.remaining-- <= 0) return FIXED_CHAIN_INCONCLUSIVE;
      const branchContext = cloneFeasibilityContext(context);
      const next = commitAssignment(branchContext, intermediate, { ...assignment, gapFill: false });
      const result = fixedChainFeasibility(branchContext, probeJob, rest, fixedStart, next, budget);
      if (result === FIXED_CHAIN_FEASIBLE) return result;
      if (result === FIXED_CHAIN_INCONCLUSIVE) return result;
    }
    return FIXED_CHAIN_INFEASIBLE;
  }

  function compareFixedChainAssignments(context, operation, a, b) {
    const releaseA = assignmentReleaseMoment(context, operation, a)?.getTime() || Number.MAX_SAFE_INTEGER;
    const releaseB = assignmentReleaseMoment(context, operation, b)?.getTime() || Number.MAX_SAFE_INTEGER;
    return releaseA - releaseB || compareAssignments(a, b, context.strategy);
  }

  function assignmentReleaseMoment(context, operation, assignment) {
    return predecessorReleaseMoment(context, {
      operation,
      start: assignment.operationStart,
      end: assignment.end,
      duration: assignment.productionMinutes,
      segments: assignment.productionSegments || assignment.segments,
    });
  }

  function cloneFeasibilityContext(context) {
    const cloneBusy = (map) => new Map([...map.entries()].map(([key, intervals]) => [
      key,
      intervals.map((interval) => ({ ...interval, start: new Date(interval.start), end: new Date(interval.end) })),
    ]));
    return {
      ...context,
      diagnostics: [],
      operatorBusy: cloneBusy(context.operatorBusy),
      machineBusy: cloneBusy(context.machineBusy),
      operatorLoad: new Map(context.operatorLoad),
      machineTools: new Map([...context.machineTools.entries()].map(([key, events]) => [key, events.map((event) => ({ ...event }))])),
      scheduledByKey: new Map(context.scheduledByKey),
      scheduledById: new Map(context.scheduledById),
      generatedChanges: [],
    };
  }

  function isLaterOperationGapFill(context, job, assignment) {
    if (!job || job.index < 1 || !assignment?.start || !assignment?.end) return false;
    const futureReservations = [
      ...(context.operatorBusy.get(assignment.operator) || []),
      ...(assignment.finite && hasMachineResource(assignment.machine) ? (context.machineBusy.get(assignment.machine) || []) : []),
    ];
    return futureReservations.some((interval) =>
      interval.start.getTime() >= assignment.end.getTime() &&
      interval.start.getTime() > assignment.start.getTime()
    );
  }

  function toolChangeFor(context, op, machine, candidateStart) {
    const toKey = operationToolKey(op);
    if (!machine || machine === "SIN_MAQUINA" || !toKey) return { required: false, minutes: 0, fromLabel: "", toLabel: toKey };
    const events = context.machineTools.get(machine);
    let fromKey = "SIN_ANTECEDENTE";
    if (events && events.length > 0) {
      const time = candidateStart.getTime();
      let lo = 0, hi = events.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].end <= time) lo = mid + 1;
        else hi = mid;
      }
      const prior = lo > 0 ? events[lo - 1] : null;
      if (prior) {
        fromKey = prior.toolKey || "SIN_ANTECEDENTE";
        if (normalizeKey(prior.toolKey) === normalizeKey(toKey)) return { required: false, minutes: 0, fromLabel: fromKey, toLabel: toKey };
      }
    }
    const minutes = toolChangeMinutesForTransition(context.state, op, fromKey, toKey, context.settings);
    return { required: true, minutes, fromLabel: fromKey, toLabel: toKey };
  }

  function toolChangeMinutesForTransition(state, op, fromKey, toKey, settings) {
    const catalog = toolCatalogForOperation(state, op);
    const generalMinutes = Number(settings?.toolChangeMinutes);
    const fallbackMinutes = Number.isFinite(generalMinutes) && generalMinutes > 0 ? generalMinutes : 120;
    if (!catalog) return fallbackMinutes;
    const [fromHerramental, fromKit] = splitToolKey(fromKey);
    const [toHerramental, toKit] = splitToolKey(toKey);
    const noAntecedent = normalizeKey(fromKey) === "SIN_ANTECEDENTE";
    const toolChanged = noAntecedent || normalizeKey(fromHerramental) !== normalizeKey(toHerramental);
    const kitChanged = noAntecedent
      ? normalizeKey(toKit) !== "SIN_KIT"
      : normalizeKey(fromKit) !== normalizeKey(toKit);
    const configuredMinutes = Math.max(0,
      (toolChanged ? numberOr(catalog.toolSetupMinutes, 0) : 0) +
      (kitChanged ? numberOr(catalog.kitSetupMinutes, 0) : 0)
    );
    if (configuredMinutes > 0) return configuredMinutes;
    if (noAntecedent) return fallbackMinutes;
    if (!noAntecedent && (toolChanged || kitChanged)) {
      return fallbackMinutes;
    }
    return 0;
  }

  function firstEventAfter(events, time) {
    if (!events || events.length === 0) return null;
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].end < time) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < events.length; i++) {
      if (Number.isFinite(events[i].start) && events[i].start >= time) return events[i];
    }
    return null;
  }

  function findPostToolChange(context, op, machine, allocation) {
    const fromLabel = operationToolKey(op);
    if (!fromLabel || !machine || machine === "SIN_MAQUINA") return { required: false };
    const future = firstEventAfter(context.machineTools.get(machine), allocation.end.getTime());
    if (!future || normalizeKey(future.toolKey) === normalizeKey(fromLabel) || future.isChange || Number.isFinite(future.preChangeStart)) {
      return { required: false };
    }
    const operator = toolChangeOperator(context.state, context.settings);
    if (!operator) return null;
    const target = context.scheduledById.get(future.operationId) || op;
    const minutes = toolChangeMinutesForTransition(context.state, target, fromLabel, future.toolKey, context.settings);
    if (minutes <= 0) return { required: false };
    const postAllocation = allocateWork(context, allocation.end, minutes, {
      operator,
      machine,
      finite: true,
      setupMinutes: 0,
    });
    if (!postAllocation || postAllocation.end.getTime() > future.start) return null;
    return {
      required: true,
      operator,
      minutes,
      start: postAllocation.start,
      end: postAllocation.end,
      segments: postAllocation.segments,
      fromLabel,
      toLabel: future.toolKey,
      targetOperationId: future.operationId,
    };
  }

  function enrichToolsFromCatalog(state, operations) {
    for (const op of operations) {
      if (!isBendingOperation(op)) continue;
      const item = toolCatalogForOperation(state, op);
      if (!item) continue;
      if (!cleanTool(op.herramental)) op.herramental = cleanTool(item.herramental);
      if (op.kitPending !== true && !cleanTool(op.kitHerramental)) op.kitHerramental = cleanTool(item.kitHerramental);
    }
  }

  function toolCatalogForOperation(state, op) {
    if (!isBendingOperation(op)) return null;
    const part = String(op.parte || indexedWorkOrder(state, op.ot)?.item || "").trim();
    const performanceState = state.__performanceState;
    countPlanningStat(performanceState, "toolCatalogLookups");
    if (performanceState) assertPlanningBudget(performanceState, "tool-catalog-lookup");
    const cachedCatalogIndex = state.__toolCatalogByPart;
    const catalogIndex = (cachedCatalogIndex && typeof cachedCatalogIndex.get === "function")
      ? cachedCatalogIndex
      : buildToolCatalogIndex(state, performanceState);
    const indexedCandidates = catalogIndex.get(normalizeKey(part));
    const candidates = indexedCandidates || (state.toolCatalog || []).filter((item) => {
      countPlanningStat(performanceState, "toolCatalogScans");
      return item.active !== false && normalizeKey(item.part || item.parte) === normalizeKey(part);
    });
    const herramental = cleanTool(op.herramental);
    const kit = cleanTool(op.kitHerramental);
    return candidates.find((item) => cleanTool(item.herramental) === herramental && cleanTool(item.kitHerramental) === kit)
      || candidates.find((item) => herramental && cleanTool(item.herramental) === herramental)
      || candidates.find((item) => kit && cleanTool(item.kitHerramental) === kit)
      || candidates[0]
      || null;
  }

  function operatorCandidates(state, op, finite) {
    const capability = capabilityForOperation(op);
    if (Array.isArray(state.configuredCapabilities) && !state.configuredCapabilities.includes(capability.key)) return [];
    const matrix = state.matrix || {};
    const allowed = matrix[capability.key] || matrix[capability.ct] || [];
    const active = new Set((state.operators || []).map(normalizeKey));
    const candidates = allowed.filter((name) =>
      (!active.size || active.has(normalizeKey(name)))
    );
    return unique(candidates).filter((name) => name && normalizeKey(name) !== "SIN_OPERADOR");
  }

  function unscheduledCause(state, op) {
    if (!operatorCandidates(state, op, isFiniteOperation(state, op)).length) return "SIN_OPERADOR_CONFIGURADO";
    if (isBendingOperation(op) && !machineCandidates(state, op).length) return "SIN_MAQUINA_O_HERRAMENTAL_VALIDO";
    if (isBendingOperation(op) && operationToolKey(op) && !toolChangeOperator(state, state.settings || {})) return "SIN_AJUSTADOR_PARA_CAMBIO_HERRAMENTAL";
    return "SIN_CAPACIDAD_O_HUECO_EN_HORIZONTE_TECNICO";
  }

  function toolChangeOperator(state, settings) {
    if (!hasToolChangeCapability(state)) return "";
    const matrix = state.matrix || {};
    const allowed = [
      ...(Array.isArray(matrix[TOOL_CHANGE_CAPABILITY.key]) ? matrix[TOOL_CHANGE_CAPABILITY.key] : []),
      ...(Array.isArray(matrix[TOOL_CHANGE_CAPABILITY.ct]) ? matrix[TOOL_CHANGE_CAPABILITY.ct] : []),
    ];
    const active = new Set((state.operators || []).map(normalizeKey));
    return unique(allowed).find((name) => name && (!active.size || active.has(normalizeKey(name)))) || "";
  }

  function hasToolChangeCapability(state) {
    const configured = Array.isArray(state.configuredCapabilities) ? new Set(state.configuredCapabilities.map(String)) : null;
    const matrix = state.matrix || {};
    if (configured) return configured.has(TOOL_CHANGE_CAPABILITY.key);
    return Object.prototype.hasOwnProperty.call(matrix, TOOL_CHANGE_CAPABILITY.key) ||
      Object.prototype.hasOwnProperty.call(matrix, TOOL_CHANGE_CAPABILITY.ct);
  }

  function operatorPerformanceForOperation(state, op, operator) {
    const direct = Number(state.operatorPerformance?.[operator]);
    return Number.isFinite(direct) && direct > 0 ? direct : 100;
  }

  function operationEfficiencyForOperation(state, op) {
    const rule = operationRuleForOperation(state, op);
    const efficiency = Number(rule?.efficiency ?? rule?.eficiencia);
    return Number.isFinite(efficiency) ? Math.max(1, Math.min(100, efficiency)) : 100;
  }

  function machineCandidates(state, op) {
    if (!isBendingOperation(op)) return [""];
    const assignedMachine = String(op.maquina || "").trim();
    if (assignedMachine && normalizeKey(assignedMachine) !== "SIN_MAQUINA") {
      return validBendingMachine(assignedMachine, op.ct) ? [assignedMachine] : [];
    }
    const catalog = (state.machines || [])
      .filter((machine) => machine.active !== false)
      .map((machine) => machine.id || machine.machine || machine.maquina)
      .filter(Boolean);
    const candidates = unique([op.maquina, ...catalog].filter(Boolean))
      .filter((machine) => normalizeKey(machine) !== "SIN_MAQUINA" && !(String(op.ct) === "5459" && String(machine) === "1"));
    return candidates;
  }

  function planningConfigurationIssues(state, operations) {
    const issues = [];
    const toolsByMachine = new Map();
    const configured = Array.isArray(state.configuredCapabilities) ? new Set(state.configuredCapabilities) : null;
    const matrix = state.matrix || {};
    const effectiveOperations = filterExcludedOperations(state, operations)
      .map((op, index) => applyOtConfiguration(state, normalizeOperation(op, index)));
    for (const op of effectiveOperations) {
      if (String(op.tipoInsercion || "").toUpperCase() === "CAMBIO_HERRAMENTAL") continue;
      const capability = capabilityForOperation(op);
      const isSubcontract = isSubcontractOperation(state, op);
      const isConfigured = configured
        ? configured.has(capability.key)
        : Object.prototype.hasOwnProperty.call(matrix, capability.key) || Object.prototype.hasOwnProperty.call(matrix, capability.ct);
      if (!isSubcontract && !isConfigured) {
        issues.push({ code: "MISSING_CAPABILITY", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
        continue;
      }
      if (!isSubcontract) {
        const operators = operatorCandidates(state, op, isFiniteOperation(state, op));
        if (!operators.length) issues.push({ code: "MISSING_OPERATOR", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
      }
      if (isBendingOperation(op) && !validBendingMachine(op.maquina, op.ct)) {
        issues.push({ code: "MISSING_MACHINE", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
      }
      const catalog = toolCatalogForOperation(state, op);
      if (isBendingOperation(op) && !cleanTool(op.herramental) && !cleanTool(catalog?.herramental)) {
        issues.push({ code: "MISSING_TOOL", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
      }
      if (isBendingOperation(op) && validBendingMachine(op.maquina, op.ct)) {
        const toolKey = operationToolKey({
          ...op,
          herramental: cleanTool(op.herramental) || cleanTool(catalog?.herramental),
          kitHerramental: op.kitPending === true ? "" : (cleanTool(op.kitHerramental) || cleanTool(catalog?.kitHerramental)),
        });
        if (toolKey) {
          const machine = String(op.maquina).trim();
          const group = toolsByMachine.get(machine) || { tools: new Set(), operation: op, capability };
          group.tools.add(toolKey);
          toolsByMachine.set(machine, group);
        }
      }
      if (isSubcontract) {
        if (!String(op.subcontractType || "").trim()) issues.push({ code: "MISSING_SUBCONTRACT_TYPE", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
        const days = Number(op.subcontractDays || 0);
        if (!Number.isFinite(days) || days <= 0) issues.push({ code: "MISSING_SUBCONTRACT_DAYS", operationId: op.id, ot: op.ot, sequence: op.secuencia, capability });
      }
    }
    const changeGroup = [...toolsByMachine.values()].find((group) => group.tools.size > 0);
    if (changeGroup && !hasToolChangeCapability(state)) {
      issues.push({
        code: "MISSING_TOOL_CHANGE_CAPABILITY",
        operationId: changeGroup.operation.id,
        ot: changeGroup.operation.ot,
        sequence: changeGroup.operation.secuencia,
        capability: TOOL_CHANGE_CAPABILITY,
      });
    } else if (changeGroup && !toolChangeOperator(state, state.settings || {})) {
      issues.push({
        code: "MISSING_TOOL_CHANGE_OPERATOR",
        operationId: changeGroup.operation.id,
        ot: changeGroup.operation.ot,
        sequence: changeGroup.operation.secuencia,
        capability: TOOL_CHANGE_CAPABILITY,
      });
    }
    return issues;
  }

   function isBendingOperation(op) {
     const ct = String(op.ct || "").trim();
     return ct === "5459" || ct === "5527";
   }

    function isClosedOt(ot) {
     if (!ot) return false;
     if (String(ot.status || "").toUpperCase() === "CERRADO") return true;
     if (String(ot.planStatus || "").toUpperCase() === "COMPLETADA") return true;
     return false;
   }

  function analyzeUnscheduledOperations(state, scheduleResult) {
    const diagnostics = Array.isArray(scheduleResult?.diagnostics) ? scheduleResult.diagnostics : [];
    const unscheduledDiags = diagnostics.filter((d) => d?.code === "UNSCHEDULED");
    if (!unscheduledDiags.length) return { total: 0, byCause: {}, capacityOps: [], configOps: [], engineSuspicion: [] };

    const byCause = {};
    for (const d of unscheduledDiags) {
      const cause = d.cause || "SIN_CAPACIDAD_O_HUECO_EN_HORIZONTE_TECNICO";
      if (!byCause[cause]) byCause[cause] = [];
      byCause[cause].push(d);
    }

    const configCauses = new Set(["SIN_OPERADOR_CONFIGURADO", "SIN_MAQUINA_O_HERRAMENTAL_VALIDO", "SIN_AJUSTADOR_PARA_CAMBIO_HERRAMENTAL"]);
    const configOps = unscheduledDiags.filter((d) => configCauses.has(d.cause));
    const capacityOps = unscheduledDiags.filter((d) => !configCauses.has(d.cause));

    const horizonStart = parseDateOnly(state.planStart) || new Date();
    const horizonEndMs = horizonStart.getTime() + clampInteger(state.horizonDays || 15, 1, 45) * 86400000;
    const horizonMinutes = Math.max(0, (horizonEndMs - horizonStart.getTime()) / 60000);

    const engineSuspicion = [];
    const operations = (state.operations || []).filter((op) => !filterExcludedOperations(state, [op]).length);
    const opsById = new Map(operations.map((op) => [String(op.id), op]));

    for (const d of capacityOps) {
      const op = opsById.get(String(d.operationId));
      if (!op) continue;
      const capability = capabilityForOperation(op);
      const operators = operatorCandidates(state, op, isFiniteOperation(state, op));
      const prodMinutes = productionMinutes(op);
      const opPerf = operators.map((name) => operatorPerformanceForOperation(state, op, name));
      const avgPerf = opPerf.length ? opPerf.reduce((a, b) => a + b, 0) / opPerf.length : 100;
      const effectiveMinutes = prodMinutes / (avgPerf / 100);
      const totalAvailable = operators.reduce((sum, name) => sum + availableMinutes(state, name, state.planStart, state.horizonDays || 15), 0);
      const capRatio = totalAvailable > 0 ? effectiveMinutes / totalAvailable : Infinity;
      const isHeavy = effectiveMinutes > horizonMinutes * 0.15;
      const onlyOneOperator = operators.length === 1;

      if (capRatio > 0.05 && !isHeavy && onlyOneOperator && operators.length === 1) {
        engineSuspicion.push({
          operationId: d.operationId,
          ot: d.ot,
          sequence: d.sequence,
          capability: capability.key,
          operators,
          effectiveMinutes: Math.round(effectiveMinutes),
          totalAvailableMinutes: Math.round(totalAvailable),
          reason: "UNIQUE_OPERATOR_SATURATED",
        });
      }
    }

    const details = unscheduledDiags.map((d) => {
      const op = opsById.get(String(d.operationId));
      if (!op) return { ...d, capability: "", operators: [], prodMinutes: 0, effectiveMinutes: 0, totalAvailableMinutes: 0, machine: "" };
      const capability = capabilityForOperation(op);
      const operators = operatorCandidates(state, op, isFiniteOperation(state, op));
      const prodMinutes = productionMinutes(op);
      const opPerf = operators.map((name) => operatorPerformanceForOperation(state, op, name));
      const avgPerf = opPerf.length ? opPerf.reduce((a, b) => a + b, 0) / opPerf.length : 100;
      const effectiveMinutes = prodMinutes / (avgPerf / 100);
      const totalAvailable = operators.reduce((sum, name) => sum + availableMinutes(state, name, state.planStart, state.horizonDays || 15), 0);
      return {
        operationId: d.operationId,
        ot: d.ot,
        sequence: d.sequence,
        cause: d.cause,
        capability: capability.key,
        ct: capability.ct,
        operators,
        machine: op.maquina || "",
        prodMinutes: Math.round(prodMinutes),
        effectiveMinutes: Math.round(effectiveMinutes),
        totalAvailableMinutes: Math.round(totalAvailable),
        descripcion: op.descripcion || "",
        parte: op.parte || "",
      };
    });

    return {
      total: unscheduledDiags.length,
      byCause: Object.fromEntries(Object.entries(byCause).map(([cause, items]) => [cause, items.length])),
      capacityOps: capacityOps.length,
      configOps: configOps.length,
      engineSuspicion,
      details,
    };
  }

  function validBendingMachine(machine, ct) {
    const value = String(machine || "").trim();
    return Boolean(value) && normalizeKey(value) !== "SIN_MAQUINA" && !(String(ct) === "5459" && value === "1");
  }

  function isFiniteOperation(state, op) {
    if (op.tipoInsercion === "SUBCONTRATO" || isSubcontractOperation(state, op)) return false;
    if (op.tipoInsercion === "CAMBIO_HERRAMENTAL") return true;
    const capability = capabilityForOperation(op);
    const matchedRule = operationRuleForOperation(state, op);
    const mode = [capability.key, matchedRule?.key, capability.ct]
      .filter((k, i, arr) => k && arr.indexOf(k) === i)
      .reduce((found, k) => found || (["FINITA", "NO_FINITA"].includes(state.capacityModes?.[k]) ? state.capacityModes[k] : undefined), undefined)
      || "FINITA";
    return String(mode).toUpperCase() !== "NO_FINITA";
  }

  function isSubcontractOperation(state, op) {
    if (String(op.tipoInsercion || "").toUpperCase() === "SUBCONTRATO") return true;
    if (op.subcontractType && String(op.subcontractType).trim()) return true;
    const description = normalizeKey(`${op.descripcion || ""} ${op.contenido || ""}`);
    return isSpecialSubcontractCapability({ ct: op.ct, label: description });
  }

  function subcontractRule(state, op) {
    const partKey = normalizeKey(op.parte);
    const candidates = (state.subcontracts || [])
      .filter((rule) => {
        const rulePart = normalizeKey(rule.part || rule.parte || "*");
        return rule.active !== false && (rulePart === "*" || rulePart === partKey);
      })
      .sort((a, b) => Number(normalizeKey(b.part || b.parte) === partKey) - Number(normalizeKey(a.part || a.parte) === partKey));
    const selectedType = normalizeKey(op.subcontractType);
    if (selectedType) {
      const selected = candidates.find((rule) => normalizeKey(rule.name) === selectedType);
      if (selected) return selected;
    }
    return null;
  }

  function overlapForOperation(state, op) {
    const rule = operationRuleForOperation(state, op);
    return normalizeRatio(rule?.overlap ?? rule?.solapamiento, 1);
  }

  function operationRuleForOperation(state, op) {
    const capability = capabilityForOperation(op);
    const rules = state.operationRules || {};
    const directKey = rules[capability.key] ? capability.key : (rules[capability.ct] ? capability.ct : "");
    if (directKey) return { ...rules[directKey], key: directKey };
    const haystack = normalizeKey(`${op.descripcion || ""} ${op.contenido || ""}`);
    for (const key of Object.keys(rules)) {
      const rule = rules[key] || {};
      if (keywordList(rule.keywords || rule.palabrasClave).some((keyword) => haystack.includes(normalizeKey(keyword)))) {
        return { ...rule, key };
      }
    }
    return null;
  }

  function capabilityForOperation(op) {
    const ct = String(op.ct || "SIN_CT").trim();
    const label = String(op.descripcion || op.tipoInsercion || "OPERACION").trim();
    return { ct, label, key: `${ct}::${normalizeKey(label).replace(/\s+/g, "_")}` };
  }

  function filterCapabilities(capabilities, query) {
    const items = Array.isArray(capabilities) ? capabilities : [];
    const terms = normalizeSearchText(query).split(" ").filter(Boolean);
    if (!terms.length) return items.slice();
    return items.filter((capability) => {
      const haystack = normalizeSearchText([
        capability?.ct,
        capability?.label,
        capability?.name,
        capability?.operation,
        capability?.key,
      ].filter(Boolean).join(" "));
      return terms.every((term) => haystack.includes(term));
    });
  }

  function isSpecialSubcontractCapability(capability) {
    const ct = String(capability?.ct || "").trim();
    const value = normalizeSearchText([
      capability?.ct,
      capability?.label,
      capability?.name,
      capability?.operation,
      capability?.key,
    ].filter(Boolean).join(" "));
    if (["SUBCONTRATO", "CROMADO", "METOKOTE", "MAKA", "GALVANIZADO"].some((name) => value.includes(name))) return true;
    if (ct === "6462") return true;
    if (ct !== "5495") return false;
    const eCoat = /E\s*[- ]?\s*COAT/.test(value);
    return (value.includes("67OTD") && value.includes("ENVIO") && value.includes("PINTURA")) ||
      (eCoat && value.includes("PINTURA"));
  }

  function normalizedCapabilityKey(capability) {
    if (typeof capability === "string") {
      const separator = capability.indexOf("::");
      if (separator < 0) return normalizeKey(capability).replace(/\s+/g, "_");
      return capabilityKeyFromParts(capability.slice(0, separator), capability.slice(separator + 2));
    }
    if (capability?.key) return normalizedCapabilityKey(capability.key);
    return capabilityKeyFromParts(
      capability?.ct,
      capability?.label || capability?.name || capability?.operation || capability?.descripcion || capability?.tipoInsercion,
    );
  }

  function capabilityKeyFromParts(ct, label) {
    const normalizedCt = normalizeKey(ct || "SIN_CT").replace(/\s+/g, "_");
    const normalizedLabel = normalizeKey(label || "OPERACION").replace(/\s+/g, "_");
    return `${normalizedCt}::${normalizedLabel}`;
  }

  function isOperationCapabilityExcluded(state, operation) {
    if (normalizeKey(operation?.tipoInsercion) === "CAMBIO_HERRAMENTAL") return false;
    const excluded = Array.isArray(state?.excludedCapabilities) ? state.excludedCapabilities : [];
    if (!excluded.length) return false;
    const operationKey = normalizedCapabilityKey(capabilityForOperation(operation || {}));
    return excluded.some((capability) => normalizedCapabilityKey(capability) === operationKey);
  }

  function excludedCapabilityKeySet(state) {
    const excluded = Array.isArray(state?.excludedCapabilities) ? state.excludedCapabilities : [];
    return new Set(excluded.map(normalizedCapabilityKey).filter(Boolean));
  }

  function filterExcludedOperations(state, operations, excludedSet = excludedCapabilityKeySet(state)) {
    return (Array.isArray(operations) ? operations : []).filter((operation) => {
      if (normalizeKey(operation?.tipoInsercion) === "CAMBIO_HERRAMENTAL") return true;
      return !excludedSet.has(normalizedCapabilityKey(capabilityForOperation(operation || {})));
    });
  }
  // TODO: Consider memoizing filterExcludedOperations for performance improvement (RULE-BAL-009 / RULE-MAT-008)
  // Current overhead: normalizes capabilities and creates Set per call; could cache by (stateHash, excludedSetHash)

  function isCalendarAvailable(state, start, end, operator, machine) {
    const windows = effectiveWindows(state, start, operator, machine);
    const startMinute = minuteOfDay(start);
    const endMinute = minuteOfDay(end);
    if (formatDate(start) !== formatDate(end)) return false;
    return windows.some((window) => startMinute >= window.start && endMinute <= window.end);
  }

  function effectiveWindows(state, date, operator, machine) {
    let cache = state.__windowCache;
    if (!cache || typeof cache.get !== "function") {
      cache = new Map();
      state.__windowCache = cache;
    }
    if (state.__performanceState) assertPlanningBudget(state.__performanceState, "effective-windows", { state, date, operator, machine });
    let cacheKey = "";
    if (cache) {
      cacheKey = `${formatDate(date)}|${operator}|${machine}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;
    }
    const day = date.getDay();
    const dayKeys = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const configuredDay = state.workSchedule?.[dayKeys[day]];
    const defaultEnabled = day >= 1 && day <= 5;
    const enabled = configuredDay ? configuredDay.enabled !== false : defaultEnabled;
    const baseStart = parseClock(configuredDay?.start, DEFAULT_START_MINUTE);
    const baseEnd = parseClock(configuredDay?.end, DEFAULT_END_MINUTE);
    let windows = enabled && baseEnd > baseStart ? [{ start: baseStart, end: baseEnd }] : [];
    const dateKey = formatDate(date);
    for (const dailyBreak of Object.values(state.dailyBreaks || {})) {
      if (dailyBreak?.enabled !== true) continue;
      const breakStart = parseClock(dailyBreak.start, 0);
      const breakEnd = parseClock(dailyBreak.end, 0);
      if (breakEnd > breakStart) windows = subtractWindow(windows, { start: breakStart, end: breakEnd });
    }
    const entries = (state.calendarExceptions || []).filter((entry) => {
      if (entry.active === false) return false;
      const startDate = String(entry.startDate || entry.fechaInicio || entry.date || entry.fecha || "");
      const endDate = String(entry.endDate || entry.fechaFin || entry.date || entry.fecha || startDate);
      if (!startDate || dateKey < startDate || dateKey > endDate) return false;
      const concept = normalizeKey(entry.concept || entry.concepto || entry.resourceType || entry.tipoRecurso || "GENERAL");
      if (concept === "MAQUINA") return normalizeKey(entry.machine || entry.maquina || entry.resource || entry.recurso) === normalizeKey(machine);
      if (concept === "OPERADOR") return normalizeKey(entry.resource || entry.recurso) === normalizeKey(operator);
      return concept === "GENERAL" || concept === "ASUETO" || concept === "VACACIONES";
    });

    for (const entry of entries) {
      const startDate = String(entry.startDate || entry.fechaInicio || entry.date || entry.fecha || dateKey);
      const endDate = String(entry.endDate || entry.fechaFin || entry.date || entry.fecha || startDate);
      const start = dateKey === startDate ? parseClock(entry.start || entry.horaInicio, 0) : 0;
      const end = dateKey === endDate ? parseClock(entry.end || entry.horaFin, 24 * 60) : 24 * 60;
      if (end > start) windows = subtractWindow(windows, { start, end });
    }
    const result = windows.filter((window) => window.end > window.start);
    if (cache) cache.set(cacheKey, result);
    return result;
  }

  function nextAvailableMoment(state, date, operator, machine, windowEnd) {
    let cursor = ceilToSnap(date);
    while (cursor < windowEnd) {
      assertPlanningBudget(state.__performanceState, "calendar-next-available");
      const windows = effectiveWindows(state, cursor, operator, machine);
      const currentMinute = minuteOfDay(cursor);
      const window = windows.find((item) => item.end > currentMinute);
      if (window) {
        const candidate = atMinute(cursor, Math.max(currentMinute, window.start));
        if (candidate < windowEnd) return ceilToSnap(candidate);
      }
      cursor = startOfDay(addDays(cursor, 1));
    }
    return windowEnd;
  }

  function currentAvailabilityEnd(state, date, operator, machine) {
    const currentMinute = minuteOfDay(date);
    const window = effectiveWindows(state, date, operator, machine)
      .find((item) => currentMinute >= item.start && currentMinute < item.end);
    return window ? atMinute(date, window.end) : null;
  }

  function addWorkingDays(state, date, days, windowEnd) {
    let cursor = startOfDay(date);
    let remaining = days;
    let iterationCount = 0;
    while (cursor < windowEnd && remaining > 0) {
      assertPlanningBudget(state.__performanceState, "calendar-working-days");
      iterationCount++;
      if (iterationCount % 50 === 0) {
        // Yield al navegador cada 50 iteraciones para evitar "script unresponsive"
        setTimeout(() => {}, 0);
      }
      cursor = addDays(cursor, 1);
      if (effectiveWindows(state, atMinute(cursor, DEFAULT_START_MINUTE), "", "").length) remaining -= 1;
    }
    if (remaining > 0) return null;
    return nextAvailableMoment(state, atMinute(cursor, DEFAULT_START_MINUTE), "", "", windowEnd);
  }

  function addGeneralWorkMinutes(state, date, minutes, windowEnd) {
    let cursor = ceilToSnap(date);
    let remaining = Math.max(0, roundUp(minutes, SNAP_MINUTES));
    let iterationCount = 0;
    if (!remaining) return cursor;
    while (cursor < windowEnd && remaining > 0) {
      assertPlanningBudget(state.__performanceState, "calendar-work-minutes");
      iterationCount++;
      if (iterationCount % 50 === 0) {
        // Yield al navegador cada 50 iteraciones para evitar "script unresponsive"
        setTimeout(() => {}, 0);
      }
      const end = addMinutes(cursor, Math.min(ALLOCATION_CHUNK_MINUTES, remaining));
      if (isCalendarAvailable(state, cursor, end, "", "")) {
        remaining -= diffMinutes(cursor, end);
        cursor = end;
      } else {
        cursor = addMinutes(cursor, SNAP_MINUTES);
      }
    }
    return remaining > 0 ? null : cursor;
  }

  function availableMinutes(state, operator, startValue, horizonValue) {
    const start = startOfDay(parseDateOnly(startValue || state.planStart) || inferPlanStart(state.operations));
    const horizon = clampInteger(horizonValue || state.horizonDays || DEFAULT_HORIZON_DAYS, 1, 45);
    let total = 0;
    for (let day = 0; day < horizon; day++) {
      const date = addDays(start, day);
      total += effectiveWindows(state, date, operator, "").reduce((sum, window) => sum + window.end - window.start, 0);
    }
    return total;
  }

  function nextResourceAvailability(state, operator, machine, startValue) {
    const operations = filterExcludedOperations(state, state.operations);
    const startDate = parseDateOnly(startValue || state.planStart) || inferPlanStart(operations);
    const cursorStart = atMinute(startDate, DEFAULT_START_MINUTE);
    const windowEnd = atMinute(addDays(startOfDay(startDate), clampInteger(state.horizonDays || DEFAULT_HORIZON_DAYS, 1, 45)), DEFAULT_START_MINUTE);
    const selected = Array.isArray(state.selectedOts) ? new Set(state.selectedOts.map(normalizeKey)) : null;
    const intervals = operations.filter((op) => {
      if (isPlanCompletedOperation(state, op)) return false;
      if (selected && !selected.has(normalizeKey(op.ot))) return false;
      if (operator && String(op.operador || "") !== String(operator)) return false;
      if (machine && String(op.maquina || "") !== String(machine)) return false;
      return operationStart(op) && operationEnd(op);
    }).map((op) => ({ start: operationStart(op), end: operationEnd(op) }));
    let cursor = ceilToSnap(cursorStart);
    while (cursor < windowEnd) {
      const end = addMinutes(cursor, SNAP_MINUTES);
      const calendarOk = isCalendarAvailable(state, cursor, end, operator, machine);
      const occupied = intervals.some((interval) => cursor < interval.end && end > interval.start);
      if (calendarOk && !occupied) return cursor;
      cursor = addMinutes(cursor, SNAP_MINUTES);
    }
    return null;
  }

  function hasBusyConflict(context, start, end, operator, machine) {
    return overlapsBusy(context.operatorBusy.get(operator), start, end) ||
      (hasMachineResource(machine) && overlapsBusy(context.machineBusy.get(machine), start, end));
  }

  function overlapsBusy(intervals, start, end) {
    return Boolean(firstBusyOverlapEnd(intervals, start, end));
  }

  function firstBusyOverlapEnd(intervals, start, end, performanceState = null) {
    if (!intervals || !intervals.length) return null;
    let index = firstIntervalEndingAfter(intervals, start);
    while (index > 0 && intervals[index - 1].end > start) index -= 1;
    let conflictEnd = null;
    for (; index < intervals.length; index += 1) {
      if (index % 64 === 0) assertPlanningBudget(performanceState, "busy-overlap-scan");
      const interval = intervals[index];
      countPlanningStat(performanceState, "busyOverlapScans");
      if (interval.start >= end) break;
      if (start < interval.end && end > interval.start) {
        conflictEnd = maxDate(conflictEnd, interval.end);
        break;
      }
    }
    return conflictEnd ? new Date(conflictEnd) : null;
  }

  function firstIntervalEndingAfter(intervals, start) {
    let low = 0;
    let high = intervals.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (intervals[mid].end <= start) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function maxDate(left, right) {
    if (!left) return right ? new Date(right) : null;
    if (!right) return new Date(left);
    return left > right ? new Date(left) : new Date(right);
  }

  function isCachedAssignmentValid(context, assignment) {
    if (!assignment || !assignment.end) return false;
    const start = assignment.operationStart || assignment.start;
    const end = assignment.end;
    const spanStart = assignment.start;
    const operators = unique([assignment.operator, assignment.setupOperator].filter(Boolean));
    for (const operator of operators) {
      if (firstBusyOverlapEnd(context.operatorBusy.get(operator), spanStart, end, context.performanceState)) return false;
    }
    if (assignment.machine && hasMachineResource(assignment.machine) &&
        firstBusyOverlapEnd(context.machineBusy.get(assignment.machine), spanStart, end, context.performanceState)) {
      return false;
    }
    return start < end;
  }

  function nextBusyConflictEnd(context, start, end, operators, machine, finite) {
    assertPlanningBudget(context.performanceState, "busy-conflict-scan", context);
    const intervals = [];
    for (const operator of unique(operators)) collectBusyConflicts(intervals, context.operatorBusy.get(operator), start, end, context.performanceState);
    if (finite && hasMachineResource(machine)) collectBusyConflicts(intervals, context.machineBusy.get(machine), start, end, context.performanceState);
    const conflicts = intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    if (conflicts.length > 1) countPlanningStat(context.performanceState, "busyConflictSorts");
    if (!conflicts.length) return null;
    let conflictEnd = new Date(conflicts[0].end);
    for (let index = 1; index < conflicts.length && conflicts[index].start <= conflictEnd; index += 1) {
      assertPlanningBudget(context.performanceState, "busy-conflict-merge", context);
      if (conflicts[index].end > conflictEnd) conflictEnd = new Date(conflicts[index].end);
    }
    return conflictEnd;
  }

  function collectBusyConflicts(out, intervals, start, end, performanceState) {
    if (!intervals || !intervals.length) return;
    let index = firstIntervalEndingAfter(intervals, start);
    while (index > 0 && intervals[index - 1].end > start) index -= 1;
    for (; index < intervals.length; index += 1) {
      if (index % 64 === 0) assertPlanningBudget(performanceState, "busy-conflict-scan");
      const interval = intervals[index];
      countPlanningStat(performanceState, "busyConflictScans");
      if (interval.start >= end) break;
      if (start < interval.end && end > interval.start) out.push(interval);
    }
  }

  function operatorOverlapConflicts(stateOrOperations, stateContext = null) {
    const operations = Array.isArray(stateOrOperations)
      ? stateOrOperations
      : (Array.isArray(stateOrOperations?.operations)
        ? stateOrOperations.operations.filter((op) => !isPlanCompletedOperation(stateOrOperations, op))
        : []);
    const capacityState = stateContext || (Array.isArray(stateOrOperations) ? null : stateOrOperations);
    const byOperator = new Map();
    for (const op of operations) {
      const operator = String(op.operador || "").trim();
      const start = operationStart(op);
      const end = operationEnd(op);
      if ((capacityState && !isFiniteOperation(capacityState, op)) || !isLoadBearingOperator(operator) || !start || !end || start >= end) continue;
      if (!byOperator.has(operator)) byOperator.set(operator, []);
      byOperator.get(operator).push({ op, start, end });
    }

    const conflicts = [];
    for (const [operator, intervals] of byOperator.entries()) {
      intervals.sort((a, b) => a.start - b.start || a.end - b.end);
      let active = intervals[0];
      for (let index = 1; index < intervals.length; index++) {
        const current = intervals[index];
        if (current.start < active.end) {
          conflicts.push({
            operator,
            firstOperationId: active.op.id,
            firstOt: active.op.ot,
            secondOperationId: current.op.id,
            secondOt: current.op.ot,
            overlapStart: new Date(Math.max(active.start.getTime(), current.start.getTime())).toISOString(),
            overlapEnd: new Date(Math.min(active.end.getTime(), current.end.getTime())).toISOString(),
          });
          if (current.end > active.end) active = current;
        } else {
          active = current;
        }
      }
    }
    return conflicts;
  }

  function waitDiagnostic(context, assignment) {
    const earliest = assignment.earliest || assignment.operationStart;
    const waitMinutes = Math.max(0, Math.round(diffMinutes(earliest, assignment.operationStart)));
    if (!waitMinutes) return { esperaMinutos: 0, causaEspera: "", recursoEspera: "", otBloqueadora: "", secuenciaBloqueadora: "" };

    if (assignment.toolChange?.required && assignment.setupMinutes > 0 && assignment.start < assignment.operationStart) {
      return { esperaMinutos: waitMinutes, causaEspera: "CAMBIO_HERRAMENTAL", recursoEspera: assignment.machine || assignment.setupOperator || "CAMBIO DE HERRAMENTAL", otBloqueadora: "", secuenciaBloqueadora: "" };
    }

    const candidates = [];
    const collect = (intervals, cause, resource) => {
      for (const interval of intervals || []) {
        if (interval.end > earliest && interval.start < assignment.operationStart) candidates.push({ interval, cause, resource });
      }
    };
    collect(context.operatorBusy.get(assignment.operator), "OPERADOR", assignment.operator);
    if (assignment.finite && hasMachineResource(assignment.machine)) collect(context.machineBusy.get(assignment.machine), "MAQUINA", assignment.machine);
    candidates.sort((left, right) => right.interval.end - left.interval.end || (left.cause === "OPERADOR" ? -1 : 1));
    const blocker = candidates[0];
    const calendarProbe = blocker?.interval.end || earliest;
    const resourceCalendarStart = nextAvailableMoment(context.state, calendarProbe, assignment.operator, assignment.machine, context.windowEnd);
    if (resourceCalendarStart > calendarProbe && resourceCalendarStart >= assignment.operationStart) {
      return { esperaMinutos: waitMinutes, causaEspera: "CALENDARIO", recursoEspera: [assignment.operator, assignment.machine].filter(Boolean).join(" / ") || "CALENDARIO GENERAL", otBloqueadora: "", secuenciaBloqueadora: "" };
    }
    if (blocker) return {
      esperaMinutos: waitMinutes,
      causaEspera: blocker.cause,
      recursoEspera: blocker.resource,
      otBloqueadora: blocker.interval.ot == null ? "" : String(blocker.interval.ot),
      secuenciaBloqueadora: blocker.interval.secuencia ?? "",
    };

    if (resourceCalendarStart > earliest) {
      return { esperaMinutos: waitMinutes, causaEspera: "CALENDARIO", recursoEspera: [assignment.operator, assignment.machine].filter(Boolean).join(" / ") || "CALENDARIO GENERAL", otBloqueadora: "", secuenciaBloqueadora: "" };
    }
    return { esperaMinutos: waitMinutes, causaEspera: "SIN_CAUSA", recursoEspera: "", otBloqueadora: "", secuenciaBloqueadora: "" };
  }

  function addBusySegments(map, resource, segments, metadata) {
    if (!resource || normalizeKey(resource) === "SIN_OPERADOR" || normalizeKey(resource) === "SIN_MAQUINA" || normalizeKey(resource) === "SUBCONTRATO") return;
    const current = map.get(resource) || [];
    const { performanceState, ...intervalMetadata } = metadata || {};
    current.push(...segments.map((segment) => ({
      start: new Date(segment.start), end: new Date(segment.end),
      ...intervalMetadata, resource,
    })));
    countPlanningStat(performanceState, "busySegmentSorts");
    current.sort((a, b) => a.start - b.start);
    map.set(resource, current);
  }

  function isLoadBearingOperator(operator) {
    const key = normalizeKey(operator);
    return Boolean(key) && key !== "SIN_OPERADOR" && key !== "SUBCONTRATO";
  }

  function hasMachineResource(machine) {
    const key = normalizeKey(machine);
    return Boolean(key) && key !== "SIN_MAQUINA";
  }

  function buildJobs(operations, fixedOperations, state = {}) {
    const byOt = new Map();
    for (const op of operations) {
      const key = normalizeKey(op.ot);
      if (!byOt.has(key)) byOt.set(key, []);
      byOt.get(key).push(op);
    }
    const selectedOrder = new Map((state.selectedOts || [])
      .map((ot, index) => [normalizeKey(ot), index])
      .filter(([key]) => key));
    return [...byOt.values()].map((items) => ({
      operations: items.sort(compareOperationSequence),
      fixedOperations: (fixedOperations || [])
        .filter((op) => normalizeKey(op.ot) === normalizeKey(items[0]?.ot))
        .sort(compareOperationSequence),
      index: 0,
      last: null,
      orderIndex: selectedOrder.has(normalizeKey(items[0]?.ot)) ? selectedOrder.get(normalizeKey(items[0]?.ot)) : Number.MAX_SAFE_INTEGER,
    })).sort((a, b) => normalizePriority(a.operations[0]?.prioridad) - normalizePriority(b.operations[0]?.prioridad));
  }

  function expandAdditionalToolOperations(state, operations) {
    const byOt = new Map();
    operations.forEach((op) => {
      if (!isBendingOperation(op)) return;
      const extras = additionalToolList(op.additionalHerramentales || op.herramentalesExtra);
      if (!extras.length) return;
      const key = normalizeKey(op.ot);
      if (!byOt.has(key)) byOt.set(key, []);
      byOt.get(key).push(op);
    });
    if (!byOt.size) return operations;
    const expanded = [...operations];
    const completedGenerated = new Set((state.operations || [])
      .filter((op) => op.generatedAdditionalTool === true && isPlanCompletedOperation(state, op))
      .map((op) => `${normalizeKey(op.ot)}|${normalizeKey(op.herramental)}`));
    for (const items of byOt.values()) {
      const base = items.sort(compareOperationSequence)[0];
      additionalToolList(base.additionalHerramentales).forEach((tool, index) => {
        const entry = additionalToolEntry(tool);
        if (completedGenerated.has(`${normalizeKey(base.ot)}|${normalizeKey(entry.herramental)}`)) return;
        expanded.push(additionalToolOperation(base, entry, index));
      });
    }
    return expanded;
  }

  function additionalToolOperation(base, tool, index) {
    const entry = additionalToolEntry(tool);
    return {
      ...base,
      id: `${base.id || `${base.ot}-${base.secuencia}`}-herr-extra-${index + 1}`,
      num: Number(base.num || 0) + ((index + 1) / 1000),
      secuencia: Number(base.secuencia || 1) + ((index + 1) / 1000),
      descripcion: base.descripcion || "DOBLEZ",
      maquina: entry.machine || base.maquina,
      herramental: entry.herramental,
      additionalHerramentales: [],
      fechaInicio: "",
      horaInicio: "",
      fechaFin: "",
      horaFin: "",
      operador: "SIN_OPERADOR",
      locked: false,
      autoFrozen: false,
      generatedBy: GENERATED_BY,
      generatedAdditionalTool: true,
      tipoInsercion: "OPERACION",
      planStatus: "PENDIENTE",
      log: appendLog(base.log, "HERRAMENTAL_ADICIONAL_GENERADO"),
    };
  }

  function fixedPredecessor(job, operation) {
    const candidates = (job.fixedOperations || [])
      .filter((candidate) => compareOperationSequence(candidate, operation) < 0)
      .filter((candidate) => operationStart(candidate) && operationEnd(candidate));
    const predecessor = candidates.reduce((latest, candidate) => latestPredecessor(latest, {
      operation: candidate,
      start: operationStart(candidate),
      end: operationEnd(candidate),
      duration: declaredOperationDuration(candidate),
    }), null)?.operation;
    if (!predecessor) return null;
    const start = operationStart(predecessor);
    const end = operationEnd(predecessor);
    return { operation: predecessor, start, end, duration: declaredOperationDuration(predecessor) };
  }

  function declaredOperationDuration(operation) {
    const setup = numberOr(operation?.tiempoSetup, 0);
    const production = productionMinutes(operation);
    return setup + production > 0 ? operationDuration(operation, 100, 100) : null;
  }

  function latestPredecessor(left, right) {
    if (!left) return right;
    if (!right) return left;
    const leftEnd = left.end instanceof Date ? left.end.getTime() : Number.NEGATIVE_INFINITY;
    const rightEnd = right.end instanceof Date ? right.end.getTime() : Number.NEGATIVE_INFINITY;
    if (leftEnd !== rightEnd) return leftEnd > rightEnd ? left : right;
    return compareOperationSequence(left.operation, right.operation) >= 0 ? left : right;
  }

  function compareOperationSequence(a, b) {
    return Number(a?.secuencia) - Number(b?.secuencia) || Number(a?.num) - Number(b?.num);
  }

  function compareFirstOperationCandidates(a, b, strategy, context) {
    if (usesOrderedStartFlow(strategy, context)) {
      const order = jobOrderIndex(a.job) - jobOrderIndex(b.job);
      if (order) return order;
    }
    const ap = normalizePriority(a.op.prioridad);
    const bp = normalizePriority(b.op.prioridad);
    const ad = parseDateOnly(a.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bd = parseDateOnly(b.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    return ap - bp || a.assignment.end - b.assignment.end || ad - bd || String(a.op.ot).localeCompare(String(b.op.ot), "es", { numeric: true });
  }

  function jobOrderIndex(job) {
    return Number.isFinite(Number(job?.orderIndex)) ? Number(job.orderIndex) : Number.MAX_SAFE_INTEGER;
  }

  function compareFirstAndSuccessorCandidates(firstCandidate, successorCandidate) {
    const firstOrder = jobOrderIndex(firstCandidate.job);
    const successorOrder = jobOrderIndex(successorCandidate.job);
    if (firstOrder < successorOrder) {
      return successorCandidate.assignment.end <= firstCandidate.assignment.start ? 1 : -1;
    }
    if (successorOrder < firstOrder) {
      return firstCandidate.assignment.end <= successorCandidate.assignment.start ? -1 : 1;
    }
    return -1;
  }

  function usesOrderedStartFlow(strategy, context) {
    return context?.fastQualityMode === true || strategy === "flow_balanced";
  }

  function compareReadyCandidates(a, b, firstOperation, strategy, context) {
    const isFirstA = a.job.index === 0 && a.op.secuencia === 1 && a.op._protectedSequence;
    const isFirstB = b.job.index === 0 && b.op.secuencia === 1 && b.op._protectedSequence;
    if (isFirstA && !isFirstB) return usesOrderedStartFlow(strategy, context) ? compareFirstAndSuccessorCandidates(a, b) : -1;
    if (!isFirstA && isFirstB) return usesOrderedStartFlow(strategy, context) ? -compareFirstAndSuccessorCandidates(b, a) : 1;
    if (isFirstA && isFirstB) return compareFirstOperationCandidates(a, b, strategy, context);
    if (strategy === "flow_balanced" || context?.fastQualityMode === true) return compareFlowReadyCandidates(a, b);
    const stateA = a.job?.state || a.context?.state || {};
    const stateB = b.job?.state || b.context?.state || {};
    const aIsSubcontract = isSubcontractOperation(stateA, a.op);
    const bIsSubcontract = isSubcontractOperation(stateB, b.op);
    if (aIsSubcontract && bIsSubcontract) {
      const daysA = Number(a.op.subcontractDays || 0);
      const daysB = Number(b.op.subcontractDays || 0);
      if (daysA !== daysB) return daysA - daysB;
    }
    if (firstOperation) {
      const priorityDifference = normalizePriority(a.op.prioridad) - normalizePriority(b.op.prioridad);
      if (priorityDifference) return priorityDifference;
    }
    const ad = parseDateOnly(a.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bd = parseDateOnly(b.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    const tie = String(a.op.ot).localeCompare(String(b.op.ot), "es", { numeric: true });
    if (strategy === "finish") {
      return a.assignment.end - b.assignment.end || a.assignment.start - b.assignment.start || ad - bd || a.assignment.toolPenalty - b.assignment.toolPenalty || tie;
    }
    if (strategy === "load") {
      return a.assignment.start - b.assignment.start || a.assignment.operatorLoad - b.assignment.operatorLoad || a.assignment.end - b.assignment.end || ad - bd || tie;
    }
    if (strategy === "tools") {
      return a.assignment.start - b.assignment.start || a.assignment.toolPenalty - b.assignment.toolPenalty || a.assignment.end - b.assignment.end || a.assignment.operatorLoad - b.assignment.operatorLoad || tie;
    }
    if (strategy === "makespan") {
      const aDur = operationDuration(a.op, 100, 100);
      const bDur = operationDuration(b.op, 100, 100);
      return bDur - aDur || a.assignment.start - b.assignment.start || a.assignment.end - b.assignment.end || tie;
    }
    if (strategy === "idle") {
      const aGap = a.job.last ? (a.assignment.start - (operationEnd(a.job.last)?.getTime() || a.assignment.start)) : 0;
      const bGap = b.job.last ? (b.assignment.start - (operationEnd(b.job.last)?.getTime() || b.assignment.start)) : 0;
      return aGap - bGap || a.assignment.start - b.assignment.start || a.assignment.end - b.assignment.end || tie;
    }
    if (strategy === "balance") {
      const aLoad = a.assignment.operatorLoad || 0;
      const bLoad = b.assignment.operatorLoad || 0;
      if (aLoad !== bLoad) return aLoad - bLoad;
    }
    const state = a.job?.state || a.context?.state || {};
    if (!isFirstA && !isFirstB) {
      const toolChange = a.assignment.toolPenalty - b.assignment.toolPenalty;
      if (toolChange) return toolChange;
      const matrix = state.matrix || {};
      const capabilityA = capabilityForOperation(a.op);
      const capabilityB = capabilityForOperation(b.op);
      const keyA = capabilityA.key;
      const keyB = capabilityB.key;
      const operatorsA = matrix[keyA] || matrix[capabilityA.ct] || [];
      const operatorsB = matrix[keyB] || matrix[capabilityB.ct] || [];
      const loadA = (a.assignment.operatorLoad || 0);
      const loadB = (b.assignment.operatorLoad || 0);
      if (operatorsA.length > 0 && operatorsB.length > 0) {
        const aInMatrix = operatorsA.indexOf(String(a.assignment.operator || "")) >= 0;
        const bInMatrix = operatorsB.indexOf(String(b.assignment.operator || "")) >= 0;
        if (aInMatrix && !bInMatrix) return -1;
        if (!aInMatrix && bInMatrix) return 1;
      }
      const matrixWeightA = computeMatrixLoadWeight(state, capabilityA, loadA, String(a.assignment.operator || "SIN_OPERADOR"));
      const matrixWeightB = computeMatrixLoadWeight(state, capabilityB, loadB, String(b.assignment.operator || "SIN_OPERADOR"));
      if (matrixWeightA !== matrixWeightB) return matrixWeightA - matrixWeightB;
    }
    return firstOperation ? compareFirstOperationCandidates(a, b, strategy, context) : compareInterleavedCandidates(a, b);
  }

  function compareAssignments(a, b, strategy) {
    const tie = String(a.operator).localeCompare(String(b.operator), "es", { numeric: true });
    const sameMachine = normalizeKey(String(a.machine || "")) === normalizeKey(String(b.machine || ""));
    if (sameMachine) {
      return a.start - b.start || a.operatorLoad - b.operatorLoad || a.end - b.end || a.toolPenalty - b.toolPenalty || tie;
    }
    if (strategy === "flow_balanced") {
      return a.toolPenalty - b.toolPenalty ||
        a.projectedOperatorLoad - b.projectedOperatorLoad ||
        a.end - b.end ||
        a.start - b.start ||
        String(a.machine).localeCompare(String(b.machine), "es", { numeric: true }) ||
        tie;
    }
    if (strategy === "finish") return a.end - b.end || a.start - b.start || a.toolPenalty - b.toolPenalty || a.operatorLoad - b.operatorLoad || tie;
    if (strategy === "load") return a.start - b.start || a.operatorLoad - b.operatorLoad || a.end - b.end || a.toolPenalty - b.toolPenalty || tie;
    if (strategy === "tools") return a.toolPenalty - b.toolPenalty || a.start - b.start || a.end - b.end || a.operatorLoad - b.operatorLoad || tie;
    return a.start - b.start || a.toolPenalty - b.toolPenalty || a.end - b.end || a.operatorLoad - b.operatorLoad || tie;
  }

  function flowReadyCandidates(ready, jobs, wipTarget) {
    const activeReady = ready.filter((candidate) => isFlowActiveJob(candidate.job));
    const activeWip = jobs.filter((job) => job.operations[job.index] && isFlowActiveJob(job)).length;
    return activeWip >= wipTarget && activeReady.length ? activeReady : ready;
  }

  function isFlowActiveJob(job) {
    return job.index > 0 || job.fixedOperations.length > 0;
  }

  function compareFlowReadyCandidates(a, b) {
    const toolChange = a.assignment.toolPenalty - b.assignment.toolPenalty;
    if (toolChange) return toolChange;
    const slack = flowSlackMinutes(a) - flowSlackMinutes(b);
    if (slack) return slack;
    const remaining = flowActiveProjectedFinish(a) - flowActiveProjectedFinish(b);
    if (remaining) return remaining;
    const unlocked = flowUnlockedSuccessorWork(b) - flowUnlockedSuccessorWork(a);
    if (unlocked) return unlocked;
    const gapFit = compareFlowGapFit(a, b);
    if (gapFit) return gapFit;
    return a.assignment.toolPenalty - b.assignment.toolPenalty ||
      a.assignment.end - b.assignment.end ||
      a.assignment.start - b.assignment.start ||
      String(a.op.ot).localeCompare(String(b.op.ot), "es", { numeric: true });
  }

  function flowSlackMinutes(candidate) {
    const due = parseDateOnly(candidate.op.fechaReq);
    if (!due) return Number.MAX_SAFE_INTEGER;
    return diffMinutes(new Date(flowProjectedFinish(candidate)), atMinute(due, DEFAULT_END_MINUTE));
  }

  function flowActiveProjectedFinish(candidate) {
    if (!isFlowActiveJob(candidate.job)) return Number.MAX_SAFE_INTEGER;
    return flowProjectedFinish(candidate);
  }

  function flowProjectedFinish(candidate) {
    let finish = new Date(candidate.assignment.end);
    const fixed = new Set(candidate.job.fixedOperations);
    const future = [
      ...candidate.job.operations.slice(candidate.job.index + 1),
      ...candidate.job.fixedOperations.filter((operation) => compareOperationSequence(operation, candidate.op) > 0),
    ].sort(compareOperationSequence);
    for (const operation of future) {
      if (fixed.has(operation)) {
        const fixedEnd = operationEnd(operation);
        if (fixedEnd && fixedEnd > finish) finish = fixedEnd;
      } else {
        finish = addMinutes(finish, operationDuration(operation, 100, 100));
      }
    }
    return finish.getTime();
  }

  function flowUnlockedSuccessorWork(candidate) {
    const successor = [
      ...candidate.job.operations.slice(candidate.job.index + 1),
      ...candidate.job.fixedOperations.filter((operation) => compareOperationSequence(operation, candidate.op) > 0),
    ].sort(compareOperationSequence)[0];
    return successor ? operationDuration(successor, 100, 100) : 0;
  }

  function compareFlowGapFit(a, b) {
    const aFitsBeforeB = a.assignment.start < b.assignment.start && a.assignment.end <= b.assignment.start;
    const bFitsBeforeA = b.assignment.start < a.assignment.start && b.assignment.end <= a.assignment.start;
    return aFitsBeforeB === bFitsBeforeA ? 0 : (aFitsBeforeB ? -1 : 1);
  }

  function computeMatrixLoadWeight(state, capability, operatorLoad, operatorName) {
    const matrix = state.matrix || {};
    const key = capability.key;
    const ct = capability.ct;
    const allowedOperators = matrix[key] || matrix[ct] || [];
    if (!allowedOperators.length) return operatorLoad;
    const opName = operatorName || (operatorLoad !== undefined ? "SIN_OPERADOR" : "SIN_OPERADOR");
    const operatorInMatrix = allowedOperators.some((op) => normalizeKey(op) === normalizeKey(opName));
    if (!operatorInMatrix) return operatorLoad * 2;
    const configuredCapabilities = Array.isArray(state.configuredCapabilities) ? state.configuredCapabilities : [];
    const capabilityInConfig = configuredCapabilities.includes(key);
    if (!capabilityInConfig) return operatorLoad * 1.5;
    const weight = allowedOperators.filter((op) => normalizeKey(op) === normalizeKey(opName)).length;
    return operatorLoad / Math.max(1, weight);
  }

  function compareInterleavedCandidates(a, b) {
    const ad = parseDateOnly(a.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bd = parseDateOnly(b.op.fechaReq)?.getTime() || Number.MAX_SAFE_INTEGER;
    return a.assignment.start - b.assignment.start ||
      a.assignment.toolPenalty - b.assignment.toolPenalty ||
      a.assignment.end - b.assignment.end ||
      a.assignment.operatorLoad - b.assignment.operatorLoad ||
      ad - bd ||
      String(a.op.ot).localeCompare(String(b.op.ot), "es", { numeric: true });
  }

  function compareScheduledOperations(a, b) {
    const startA = operationStart(a)?.getTime() || Number.MAX_SAFE_INTEGER;
    const startB = operationStart(b)?.getTime() || Number.MAX_SAFE_INTEGER;
    return startA - startB || normalizePriority(a.prioridad) - normalizePriority(b.prioridad) || String(a.ot).localeCompare(String(b.ot), "es", { numeric: true });
  }

  function evaluatePlan(state) {
    const operations = filterExcludedOperations(state, state.operations)
      .filter((op) => !isPlanCompletedOperation(state, op) && operationStart(op) && operationEnd(op));
    const starts = operations.map((op) => operationStart(op).getTime());
    const ends = operations.map((op) => operationEnd(op).getTime());
    const makespanMinutes = starts.length ? Math.max(0, (Math.max(...ends) - Math.min(...starts)) / 60000) : 0;
    let tardinessMinutes = 0;
    let weightedTardinessMinutes = 0;
    const loadByOperator = new Map();
    const intervalsByOperator = new Map();
    const loadByResource = new Map();
    const flowByOt = new Map();
    for (const op of operations) {
      const start = operationStart(op);
      const end = operationEnd(op);
      const duration = Math.max(0, diffMinutes(start, end));
      const operator = String(op.operador || "SIN_OPERADOR");
      if (isLoadBearingOperator(operator)) {
        loadByOperator.set(operator, (loadByOperator.get(operator) || 0) + duration);
        loadByResource.set(`OPERADOR:${operator}`, (loadByResource.get(`OPERADOR:${operator}`) || 0) + duration);
        if (!intervalsByOperator.has(operator)) intervalsByOperator.set(operator, []);
        intervalsByOperator.get(operator).push({ op, start, end });
      }
      if (hasMachineResource(op.maquina)) {
        const machine = String(op.maquina);
        loadByResource.set(`MAQUINA:${machine}`, (loadByResource.get(`MAQUINA:${machine}`) || 0) + duration);
      }
      const ot = normalizeKey(op.ot);
      const flow = flowByOt.get(ot) || { start, end };
      flow.start = flow.start < start ? flow.start : start;
      flow.end = flow.end > end ? flow.end : end;
      flowByOt.set(ot, flow);
      const due = op.tipoInsercion === "CAMBIO_HERRAMENTAL" ? null : parseDateOnly(op.fechaReq);
      if (due) {
        const dueEnd = atMinute(due, DEFAULT_END_MINUTE);
        if (end > dueEnd) {
          const lateness = diffMinutes(dueEnd, end);
          tardinessMinutes += lateness;
          weightedTardinessMinutes += lateness * priorityWeight(op.prioridad);
        }
      }
    }
    let idleMinutes = 0;
    let avoidableIdleMinutes = 0;
    const gaps = [];
    for (const [operator, intervals] of intervalsByOperator.entries()) {
      intervals.sort((a, b) => a.start - b.start);
      for (let index = 1; index < intervals.length; index++) {
        if (formatDate(intervals[index - 1].end) === formatDate(intervals[index].start)) {
          const previous = intervals[index - 1];
          const next = intervals[index];
          idleMinutes += Math.max(0, diffMinutes(previous.end, next.start));
          gaps.push({ operator, previous, next });
        }
      }
    }
    const remainingCandidateMinutes = new Map();
    gaps.sort((a, b) => a.previous.end - b.previous.end || String(a.operator).localeCompare(String(b.operator), "es", { numeric: true }) || a.next.start - b.next.start);
    for (const gap of gaps) {
      avoidableIdleMinutes += avoidableGapMinutes(state, operations, gap.operator, gap.previous, gap.next, remainingCandidateMinutes);
    }
    const loads = [...loadByOperator.entries()]
      .filter(([operator]) => isLoadBearingOperator(operator))
      .map(([, minutes]) => minutes);
    const averageLoad = loads.length ? loads.reduce((sum, value) => sum + value, 0) / loads.length : 0;
    const loadVariance = loads.length ? loads.reduce((sum, value) => sum + Math.pow(value - averageLoad, 2), 0) / loads.length : 0;
    const unscheduled = Number(state.lastSchedule?.unscheduled || 0);
    const changes = Number(state.lastSchedule?.changes || 0);
    const operatorConflicts = Number(state.lastSchedule?.operatorConflicts ?? operatorOverlapConflicts(operations).length);
    const averageFlowMinutes = flowByOt.size
      ? [...flowByOt.values()].reduce((sum, flow) => sum + diffMinutes(flow.start, flow.end), 0) / flowByOt.size
      : 0;
    const resourceUtilization = {};
    for (const [resource, minutes] of loadByResource) {
      resourceUtilization[resource] = makespanMinutes > 0 ? Math.round(minutes / makespanMinutes * 10000) / 10000 : 0;
    }
    const objective = Math.round(
      operatorConflicts * 1e13 +
      unscheduled * 1e12 +
      tardinessMinutes * 1e7 +
      makespanMinutes * 1e4 +
      idleMinutes * 100 +
      changes * 120 +
      Math.sqrt(loadVariance)
    );
    return {
      objective,
      operatorConflicts,
      unscheduled,
      tardinessMinutes: Math.round(tardinessMinutes),
      weightedTardinessMinutes: Math.round(weightedTardinessMinutes),
      averageFlowMinutes: Math.round(averageFlowMinutes),
      avoidableIdleMinutes: Math.round(avoidableIdleMinutes),
      toolChanges: changes,
      maxWip: maxConcurrentWip(flowByOt),
      resourceUtilization,
      score: 0,
      makespanMinutes: Math.round(makespanMinutes),
      idleMinutes: Math.round(idleMinutes),
      loadStdDevMinutes: Math.round(Math.sqrt(loadVariance)),
      changes,
    };
  }

  function avoidableGapMinutes(state, operations, operator, previous, next, remainingCandidateMinutes) {
    const gapMinutes = availableGapMinutes(state, previous.end, next.start, operator, "");
    if (!gapMinutes) return 0;
    const candidates = operations
      .filter((op) => isGapFillCandidate(state, operations, op, operator, previous.end, next.start))
      .sort((a, b) => operationStart(a) - operationStart(b) || compareOperationSequence(a, b) || String(a.id).localeCompare(String(b.id)));
    let remaining = gapMinutes;
    for (const candidate of candidates) {
      const available = availableGapMinutes(state, previous.end, next.start, operator, candidate.maquina);
      const duration = remainingCandidateMinutes.has(candidate)
        ? remainingCandidateMinutes.get(candidate)
        : Math.max(0, operationDuration(
          candidate,
          operatorPerformanceForOperation(state, candidate, operator),
          operationEfficiencyForOperation(state, candidate),
        ));
      if (!available || !duration || duration > available || duration > remaining) continue;
      const consumed = duration;
      remainingCandidateMinutes.set(candidate, duration - consumed);
      remaining -= consumed;
      if (!remaining) break;
    }
    return gapMinutes - remaining;
  }

  function isGapFillCandidate(state, operations, op, operator, gapStart, gapEnd) {
    const start = operationStart(op);
    if (!start || start < gapEnd || isFixedOperation(state, op) || !isAssignableOperation(state, op)) return false;
    if (operationToolKey(op) || isHardWaitCause(op.causaEspera)) return false;
    if (!operatorCandidates(state, op, isFiniteOperation(state, op)).includes(operator)) return false;
    const predecessors = operations.filter((candidate) => normalizeKey(candidate.ot) === normalizeKey(op.ot) &&
      compareOperationSequence(candidate, op) < 0);
    if (predecessors.some((candidate) => !operationEnd(candidate) || operationEnd(candidate) > gapStart)) return false;
    return !hasMachineResource(op.maquina) || !operations.some((candidate) => candidate !== op &&
      String(candidate.maquina || "") === String(op.maquina) && operationStart(candidate) < gapEnd && operationEnd(candidate) > gapStart);
  }

  function availableGapMinutes(state, start, end, operator, machine) {
    if (start >= end || formatDate(start) !== formatDate(end)) return 0;
    const startMinute = minuteOfDay(start);
    const endMinute = minuteOfDay(end);
    return effectiveWindows(state, start, operator, machine)
      .reduce((sum, window) => sum + Math.max(0, Math.min(endMinute, window.end) - Math.max(startMinute, window.start)), 0);
  }

  function isHardWaitCause(cause) {
    return ["CALENDARIO", "MAQUINA", "CAMBIO_HERRAMENTAL"].includes(normalizeKey(cause));
  }

  function applyComparableScores(evaluated) {
    const components = [
      ["weightedTardinessMinutes", 0.45],
      ["averageFlowMinutes", 0.30],
      ["avoidableIdleMinutes", 0.15],
      ["toolChanges", 0.10],
    ];
    const denominators = Object.fromEntries(components.map(([key]) => [key, Math.max(1, ...evaluated.map((item) => finiteNumber(item.metrics[key])))]));
    for (const item of evaluated) {
      item.metrics.score = Math.round(components.reduce((sum, [key, weight]) =>
        sum + weight * finiteNumber(item.metrics[key]) / denominators[key], 0) * 1e8) / 1e8;
    }
  }

  function finalizeMultiStrategyPlan({ evaluated, selectable, flowEvaluation, strategyFailures, strategySkips, volumePassLimit, performanceState, abortReason = "" }) {
    applyComparableScores(evaluated);
    const selectedPool = selectable?.length ? selectable : evaluated;
    const legacyCandidates = selectedPool.filter((item) => item.strategy !== "flow_balanced");
    const legacySelected = legacyCandidates.length
      ? legacyCandidates.reduce((best, item) => compareEvaluatedPlans(item, best, false) < 0 ? item : best)
      : selectedPool[0];
    const flowCandidate = selectedPool.find((item) => item === flowEvaluation);
    const flowImprovesSafely = flowCandidate && legacySelected &&
      flowCandidate.metrics.operatorConflicts <= legacySelected.metrics.operatorConflicts &&
      flowCandidate.metrics.unscheduled <= legacySelected.metrics.unscheduled &&
      flowCandidate.metrics.score < legacySelected.metrics.score;
    const selected = flowImprovesSafely ? flowCandidate : legacySelected;
    selected.result.lastSchedule.optimization = {
      method: "MULTI_STRATEGY_HEURISTIC",
      globalOptimalityGuaranteed: false,
      strategiesEvaluated: evaluated.map((item) => ({
        strategy: item.strategy,
        objective: item.metrics.objective,
        score: item.metrics.score,
        metrics: item.metrics,
        aborted: Boolean(item.result?.lastSchedule?.performance?.aborted),
      })),
      strategyFailures,
      strategySkips,
      volumePassLimit,
      selectedStrategy: selected.strategy,
      metrics: selected.metrics,
    };
    attachPlanningPerformance(selected.result, performanceState, abortReason);
    return selected.result;
  }

  function compareEvaluatedPlans(a, b, useComparableScore) {
    return a.metrics.operatorConflicts - b.metrics.operatorConflicts ||
      a.metrics.unscheduled - b.metrics.unscheduled ||
      (useComparableScore ? a.metrics.score - b.metrics.score : a.metrics.objective - b.metrics.objective) ||
      a.index - b.index;
  }

  function maxConcurrentWip(flowByOt) {
    const events = [];
    for (const flow of flowByOt.values()) {
      events.push({ time: flow.start.getTime(), change: 1 });
      events.push({ time: flow.end.getTime(), change: -1 });
    }
    events.sort((a, b) => a.time - b.time || a.change - b.change);
    let active = 0;
    let maximum = 0;
    for (const event of events) {
      active += event.change;
      maximum = Math.max(maximum, active);
    }
    return maximum;
  }

  function operationKey(op) {
    const ct = op.ct ? `|${normalizeKey(op.ct)}` : "";
    return `${normalizeKey(op.ot)}|${Number(op.secuencia || 0)}${ct}`;
  }

  function buildNewnessIndex(base) {
    const baseOts = new Set();
    const baseOpKeys = new Set();
    for (const ot of (base?.selectedOts || [])) {
      const key = normalizeKey(ot);
      if (key) baseOts.add(key);
    }
    for (const op of (base?.operations || [])) {
      const ot = normalizeKey(op?.ot);
      if (ot) baseOts.add(ot);
      baseOpKeys.add(operationKey(op));
    }
    return { baseOts, baseOpKeys };
  }

  function isNewOperation(context, op) {
    const index = context?.newnessIndex;
    const ot = normalizeKey(op?.ot);
    if (index) {
      if (!index.baseOts.has(ot)) return true;
      return !index.baseOpKeys.has(operationKey(op));
    }
    return !operationStart(op) && !operationEnd(op);
  }

  function operationToolKey(op) {
    const type = String(op.tipoInsercion || "").toUpperCase();
    if (type !== "CAMBIO_HERRAMENTAL" && !isBendingOperation(op)) return "";
    const herr = cleanTool(op.herramental);
    const kit = cleanTool(op.kitHerramental);
    if (!herr && !kit) return "";
    return `${herr || "SIN_HERR"}/${kit || "SIN_KIT"}`;
  }

  function splitToolKey(key) {
    const parts = String(key || "").split("/");
    return [parts[0] || "SIN_HERR", parts[1] || "SIN_KIT"];
  }

  function reportableToolValue(value) {
    const normalized = normalizeKey(value);
    if (!normalized || normalized === "SIN_HERR" || normalized === "SIN_KIT" || normalized === "SIN_ANTECEDENTE") return "";
    return String(value || "").trim();
  }

  function operationDuration(op, performancePercent, efficiencyPercent) {
    const setup = numberOr(op.tiempoSetup, 0);
    const production = productionMinutes(op);
    const performance = Math.max(1, numberOr(performancePercent, 100));
    const efficiency = Math.max(1, Math.min(100, numberOr(efficiencyPercent, 100)));
    const adjustedProduction = op?.tiempoFallback === true
      ? production
      : Math.ceil(production * (2 - efficiency / 100) * 100 / performance);
    const explicit = setup + adjustedProduction;
    if (explicit > 0) return explicit;
    const start = operationStart(op);
    const end = operationEnd(op);
    return start && end ? Math.max(SNAP_MINUTES, diffMinutes(start, end)) : SNAP_MINUTES;
  }

  function productionMinutes(op) {
    const cycle = numberOr(op?.tiempoCiclo, 0);
    const pieces = numberOr(op?.cantidadPendiente ?? op?.cantPendiente ?? op?.cantTotal, 0);
    if (cycle > 0 && pieces > 0) return Math.round(cycle * pieces * 100) / 100;
    return numberOr(op?.tiempoProd, 0);
  }

  function operationStart(op) {
    return parseDateTime(op.fechaInicio, op.horaInicio);
  }

  function operationEnd(op) {
    return parseDateTime(op.fechaFin, op.horaFin);
  }

  function isFixedOperation(state, op) {
    const ot = normalizeKey(op?.ot);
    return Array.isArray(state?.lockedOts) && state.lockedOts.some((item) => normalizeKey(item) === ot);
  }

  function operationCompletionKey(op) {
    if (op?.completionKey) return String(op.completionKey);
    if (normalizeKey(op?.tipoInsercion) === "CAMBIO_HERRAMENTAL") {
      return toolChangeCompletionKey(op, op?.maquina, operationToolKey(op));
    }
    const id = String(op?.id || "").trim();
    if (id) return `OP|${normalizeKey(id)}`;
    return `OP|${normalizeKey(op?.ot)}|${Number(op?.secuencia || 0)}|${normalizeKey(op?.ct)}`;
  }

  function isHistoricalOperation(op) {
    const status = normalizeKey(op?.planStatus || op?.estatus);
    return op?.historical === true || op?.isHistorical === true ||
      ["PUBLICADO", "PUBLICADA", "GUARDADO", "GUARDADA", "HISTORICO", "HISTORICA"].includes(status);
  }

  function isPlanCompletedOperation(state, op) {
    if (normalizeKey(op?.operationState) === "COMPLETADA") return true;
    if (normalizeKey(op?.planStatus) === "COMPLETADA_PLAN") return true;
    const statuses = state?.operationPlanStatuses;
    const key = operationCompletionKey(op);
    const entry = Array.isArray(statuses)
      ? statuses.find((item) => String(item?.key || item?.completionKey || "") === key)
      : statuses?.[key];
    return normalizeKey(entry?.status || entry?.planStatus) === "COMPLETADA_PLAN";
  }

  function isSchedulableOperation(op) {
    const state = normalizeKey(op?.operationState || "PENDIENTE");
    return state !== "COMPLETADA" && state !== "EXCLUIDA";
  }

  function isAssignableOperation(state, op) {
    const key = normalizeKey(op.ot);
    const workOrder = indexedWorkOrder(state, key);
    return isMovablePlanningStatus(op.estatus) && (!workOrder || isMovablePlanningStatus(workOrder.status));
  }

  function indexedWorkOrder(state, ot) {
    const key = normalizeKey(ot);
    const index = state?.__workOrdersByOt;
    if (index && typeof index.get === "function") return index.get(key);
    if (index && typeof index === "object" && index[key]) return index[key];
    return (Array.isArray(state?.workOrders) ? state.workOrders : [])
      .find((workOrder) => normalizeKey(workOrder?.ot) === key);
  }

  function isMovablePlanningStatus(status) {
    const normalized = normalizeKey(status);
    return ![
      "CERRAD", "CLOSED", "COMPLETE", "COMPLETAD",
      "CANCELAD", "CANCELED", "CANCELLED"
    ]
      .some((blocked) => normalized.includes(blocked));
  }

  function isOtScheduled(state, ot) {
    const key = normalizeKey(ot);
    const selected = Array.isArray(state?.selectedOts)
      ? state.selectedOts.some((item) => normalizeKey(item) === key)
      : false;
    if (!selected) return false;
    return Array.isArray(state?.lastSchedule?.scheduledOts)
      ? state.lastSchedule.scheduledOts.some((item) => normalizeKey(item) === key)
      : false;
  }

  function normalizeOperation(op, index, state) {
    const next = {
      ...op,
      id: op.id || `op-${index + 1}`,
      num: Number(op.num || index + 1),
      ot: String(op.ot || `OT-${index + 1}`).trim(),
      secuencia: Number(op.secuencia || 1),
      prioridad: normalizePriority(op.prioridad),
      ct: String(op.ct || "SIN_CT").trim(),
      operador: String(op.operador || "SIN_OPERADOR").trim(),
      maquina: String(op.maquina || "").trim(),
      herramental: cleanTool(op.herramental),
      additionalHerramentales: additionalToolList(op.additionalHerramentales || op.herramentalesExtra),
      kitHerramental: cleanTool(op.kitHerramental),
      tipoInsercion: String(op.tipoInsercion || "OPERACION").trim().toUpperCase(),
      estatus: String(op.estatus || "PLAN").trim(),
    };
    if (next.tipoInsercion !== "CAMBIO_HERRAMENTAL" && !isBendingOperation(next) && !isFixedOperation(state, next)) {
      next.maquina = "";
      next.herramental = "";
      next.additionalHerramentales = [];
      next.kitHerramental = "";
      next.kitPending = false;
    }
    return next;
  }

   function applyOtConfiguration(state, op, isDryRun) {
     const performanceState = state.__performanceState;
     countPlanningStat(performanceState, "otConfigurationLookups");
     const cachedConfigurationIndex = state.__otConfigurationIndex;
     const configurationIndex = (cachedConfigurationIndex && typeof cachedConfigurationIndex.get === "function")
       ? cachedConfigurationIndex
       : buildOtConfigurationIndex(state);
     const indexedConfiguration = configurationIndex.get(normalizeKey(op.ot));
     const match = indexedConfiguration !== undefined;
     const configuration = indexedConfiguration || {};

     if (isClosedOt(op)) return op;

     if (match && isBendingOperation(op)) {
       op.maquina = String(configuration.machine || configuration.maquina || op.maquina || "SIN_MAQUINA").trim();
       op.herramental = cleanTool(configuration.herramental || configuration.tool || op.herramental);
       op.additionalHerramentales = additionalToolList(configuration.additionalHerramentales || configuration.herramentalesExtra || op.additionalHerramentales);
       op.kitHerramental = configuration.kitPending === true ? "" : cleanTool(configuration.kitHerramental || configuration.kit);
       op.kitPending = configuration.kitPending === true;
      } else if (!isBendingOperation(op) && op.tipoInsercion !== "CAMBIO_HERRAMENTAL" && !isFixedOperation(state, op)) {
        op.maquina = "";
      }
      if (isBendingOperation(op) && !isSubcontractOperation(state, op)) {
        const catalogTool = toolCatalogForOperation(state, op);
        if (!op.maquina || normalizeKey(op.maquina) === "SIN_MAQUINA") {
          if (catalogTool && catalogTool.machine) op.maquina = String(catalogTool.machine).trim();
        }
        if (!op.herramental && !op.tool) {
          if (catalogTool && cleanTool(catalogTool.herramental)) {
            op.herramental = cleanTool(catalogTool.herramental);
            op.kitHerramental = cleanTool(catalogTool.kitHerramental);
          }
        } else if (normalizeKey(op.herramental) === "SIN_HERRAMENTAL" || normalizeKey(op.tool) === "SIN_HERRAMENTAL") {
          if (catalogTool && cleanTool(catalogTool.herramental)) {
            op.herramental = cleanTool(catalogTool.herramental);
            op.kitHerramental = cleanTool(catalogTool.kitHerramental);
          }
          op.tool = "";
        }
      }
      if (isSubcontractOperation(state, op)) {
       op.subcontractType = String(configuration.subcontractType || configuration.tipoSubcontrato || op.subcontractType || "").trim();
       op.subcontractDays = Number(configuration.subcontractDays || configuration.diasSubcontrato || op.subcontractDays || 0);
       op.operador = "SUBCONTRATO";
       op.maquina = "";
      }

      return op;
   }

  function buildOtConfigurationIndex(state) {
    const index = new Map();
    for (const [ot, item] of Object.entries(state.otConfigurations || {})) {
      const key = normalizeKey(item?.ot || ot);
      if (key && !index.has(key)) index.set(key, item || {});
    }
    return index;
  }

  function buildToolCatalogIndex(state, performanceState) {
    const index = new Map();
    for (const item of state.toolCatalog || []) {
      countPlanningStat(performanceState, "toolCatalogScans");
      if (item?.active === false) continue;
      const key = normalizeKey(item.part || item.parte);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(item);
    }
    return index;
  }

  function normalizePriority(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
    const key = normalizeKey(value);
    if (key.includes("ALT")) return 1;
    if (key.includes("BAJ")) return 100;
    return 50;
  }

  function inferPlanStart(operations) {
    const starts = (operations || []).map(operationStart).filter(Boolean);
    if (starts.length) return new Date(Math.min(...starts.map((date) => date.getTime())));
    const today = startOfDay(new Date());
    const day = today.getDay() || 7;
    return addDays(today, 1 - day);
  }

  function parseDateTime(dateValue, timeValue) {
    const date = parseDateOnly(dateValue);
    if (!date) return null;
    const minutes = parseClock(timeValue, 0);
    return atMinute(date, minutes);
  }

  function parseExecutionTime(value) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDateOnly(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
    const match = String(value || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function parseClock(value, fallback) {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60 : fallback;
  }

  function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatTime(date) {
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return date.getSeconds() || date.getMilliseconds() ? `${time}:${String(date.getSeconds()).padStart(2, "0")}` : time;
  }

  function startOfDay(date) {
    const next = new Date(date || Date.now());
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function atMinute(date, minute) {
    return addMinutes(startOfDay(date), minute);
  }

  function minuteOfDay(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }

  function diffMinutes(start, end) {
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  function ceilToSnap(date) {
    const next = new Date(date);
    const partialMinute = next.getSeconds() > 0 || next.getMilliseconds() > 0;
    next.setSeconds(0, 0);
    if (partialMinute) next.setMinutes(next.getMinutes() + 1);
    const remainder = next.getMinutes() % SNAP_MINUTES;
    if (remainder) next.setMinutes(next.getMinutes() + SNAP_MINUTES - remainder);
    return next;
  }

  function mergeSegments(segments) {
    const out = [];
    for (const segment of segments) {
      const last = out[out.length - 1];
      if (last && last.end.getTime() === segment.start.getTime()) last.end = new Date(segment.end);
      else out.push({ start: new Date(segment.start), end: new Date(segment.end) });
    }
    return out;
  }

  function intersectWindows(left, right) {
    const out = [];
    for (const a of left) for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end > start) out.push({ start, end });
    }
    return out;
  }

  function subtractWindow(windows, block) {
    const out = [];
    for (const window of windows) {
      if (block.end <= window.start || block.start >= window.end) out.push(window);
      else {
        if (block.start > window.start) out.push({ start: window.start, end: block.start });
        if (block.end < window.end) out.push({ start: block.end, end: window.end });
      }
    }
    return out;
  }

  function keywordList(value) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    return String(value || "").split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
  }

  function normalizeRatio(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(1, numeric));
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

  function normalizeSearchText(value) {
    return normalizeKey(value).replace(/_/g, " ").replace(/\s+/g, " ");
  }

  function cleanTool(value) {
    const text = String(value || "").trim();
    return ["", "NO", "N/A", "NA", "-"].includes(normalizeKey(text)) ? "" : text;
  }

  function toolList(value) {
    let values = value;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      try { values = JSON.parse(text); } catch (_) { values = text.split(/[,+;|]/); }
    }
    if (!Array.isArray(values)) values = [];
    return unique(values.map(cleanTool).filter(Boolean));
  }

  function additionalToolEntry(value) {
    if (value && typeof value === "object") {
      return {
        herramental: cleanTool(value.herramental || value.tool),
        machine: String(value.machine || value.maquina || "").trim(),
      };
    }
    return { herramental: cleanTool(value), machine: "" };
  }

  function additionalToolList(value) {
    let values = value;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      try { values = JSON.parse(text); } catch (_) { values = text.split(/[,+;|]/); }
    }
    if (!Array.isArray(values)) values = [];
    const out = [];
    const seen = new Set();
    values.forEach((item) => {
      const entry = additionalToolEntry(item);
      if (!entry.herramental) return;
      const key = `${normalizeKey(entry.herramental)}|${normalizeKey(entry.machine)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry.machine ? entry : entry.herramental);
    });
    return out;
  }

  function appendLog(current, message) {
    return [current, message].filter(Boolean).join(" | ");
  }

  function roundUp(value, increment) {
    return Math.ceil(Number(value || 0) / increment) * increment;
  }

  function numberOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function finiteNumber(value) {
    return numberOr(value, 0);
  }

  function priorityWeight(value) {
    return Math.max(1, 101 - normalizePriority(value));
  }

  function clampInteger(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    GENERATED_BY,
    SNAP_MINUTES,
    schedulePlan,
    filterCapabilities,
    isSpecialSubcontractCapability,
    isOperationCapabilityExcluded,
    excludedCapabilityKeySet,
    filterExcludedOperations,
    operatorOverlapConflicts,
    availableMinutes,
    nextResourceAvailability,
    effectiveWindows,
    isFiniteOperation,
    isSubcontractOperation,
    operationDuration,
    productionMinutes,
    evaluatePlan,
    operationToolKey,
    operationCompletionKey,
    isPlanCompletedOperation,
    isMovablePlanningStatus,
    isOtScheduled,
    planningConfigurationIssues,
    analyzeUnscheduledOperations,
    isBendingOperation,
    isSubcontractOperation,
    toolChangeCapability: () => ({ ...TOOL_CHANGE_CAPABILITY }),
  };
});
