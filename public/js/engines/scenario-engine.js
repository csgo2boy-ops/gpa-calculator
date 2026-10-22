(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaScenarioEngine = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // 預測 GPA：使用使用者提供的假設等級，結果必須標示 predicted。
  function predictGpa(courses, resolution) {
    var Gpa = (typeof module === 'object' && module.exports)
      ? require('./gpa-aggregation-engine.js')
      : root.GpaAggregationEngine;
    var assumed = (courses || []).map(function (c) {
      return { id: c.id, units: c.units, officialGrade: c.assumedGrade, included: c.included !== false };
    });
    var r = Gpa.computeGpa(assumed, resolution);
    return {
      predicted: true,
      value: r.value,
      computedFields: r.computedFields,
      skippedFields: r.skippedFields,
      computedCourses: r.computedCourses,
      skippedCourses: r.skippedCourses,
      status: r.status,
      note: 'predicted GPA, not official'
    };
  }

  return { predictGpa: predictGpa };

});
