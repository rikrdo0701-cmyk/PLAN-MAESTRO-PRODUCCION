(function inspectionCoreFactory(root) {
  "use strict";
  function operationKey(operation, index) {
    return String(operation?.id || operation?.code || index);
  }
  function initialOperationSelection(operations) {
    return (operations || []).reduce((selection, operation, index) => {
      selection[operationKey(operation, index)] = true;
      return selection;
    }, {});
  }
  function printableOperations(operations, selection) {
    return (operations || []).filter((operation, index) => selection?.[operationKey(operation, index)] !== false);
  }
  function inspectionRows(operations, selection, minimumRows) {
    const visible = printableOperations(operations, selection).map((operation) => ({ operation }));
    while (visible.length < minimumRows) visible.push({ operation: null });
    return visible;
  }
  root.InspectionCore = { operationKey, initialOperationSelection, printableOperations, inspectionRows };
})(typeof window !== "undefined" ? window : globalThis);
