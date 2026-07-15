(function inspectionCoreFactory(root) {
  "use strict";
  function initialOperationSelection(operations) {
    return (operations || []).reduce((selection, operation, index) => {
      selection[String(operation?.id || operation?.code || index)] = true;
      return selection;
    }, {});
  }
  function printableOperations(operations, selection) {
    return (operations || []).filter((operation, index) => selection?.[String(operation?.id || operation?.code || index)] !== false);
  }
  root.InspectionCore = { initialOperationSelection, printableOperations };
})(typeof window !== "undefined" ? window : globalThis);
