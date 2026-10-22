(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaAggregationEngine = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function round(n, dp, method) {
    if (!isNum(n) || !isNum(dp) || dp < 0) return n;
    var f = Math.pow(10, dp);
    if (method === 'truncate') return Math.floor(n * f) / f;
    if (method === 'none') return n;
    return Math.floor(((n * f) + 0.5) - (n < 0 ? 1 : 0) * 0) / f; // half-up for positive
  }

  // 只使用正式等級（officialGrade）與已核實的 gpaRules。
  function computeGpa(courses, resolution) {
    var skippedFields = [];
    var gs = resolution && resolution.fields && resolution.fields.gradeScale;
    var gsStatus = resolution && resolution.status && resolution.status.gradeScale;
    var gr = resolution && resolution.fields && resolution.fields.gpaRules;
    var grStatus = resolution && resolution.status && resolution.status.gpaRules;

    if (!gs || gsStatus === 'unknown' || gsStatus === 'deprecated') skippedFields.push('gradeScale');
    if (!gr || !gr.formula || gr.formula === 'unknown' || grStatus === 'unknown' || grStatus === 'deprecated') skippedFields.push('gpaRules');

    var computedCourses = [], skippedCourses = [];
    if (skippedFields.length) {
      return { value: null, computedFields: [], skippedFields: skippedFields, computedCourses: [], skippedCourses: [], status: 'unknown' };
    }

    var gpMap = {};
    (gs.grades || []).forEach(function (g) { gpMap[g.letter] = g.gp; });
    var nonCounted = gs.nonCountedLetters || [];
    var numerator = 0, denominator = 0;

    (courses || []).forEach(function (c) {
      var id = c && c.id;
      if (!c) { skippedCourses.push({ id: null, reason: 'invalid' }); return; }
      if (c.included === false) { skippedCourses.push({ id: id, reason: 'excluded' }); return; }
      if (!c.officialGrade) { skippedCourses.push({ id: id, reason: 'no-official-grade' }); return; }
      if (nonCounted.indexOf(c.officialGrade) >= 0) { skippedCourses.push({ id: id, reason: 'non-counted-grade' }); return; }
      var gp = gpMap[c.officialGrade];
      if (gp == null) { skippedCourses.push({ id: id, reason: 'unknown-grade' }); return; }
      var units = Number(c.units) || 0;
      numerator += gp * units;
      denominator += units;
      computedCourses.push({ id: id, letter: c.officialGrade, gp: gp, units: units });
    });

    if (denominator <= 0) {
      return { value: null, computedFields: [], skippedFields: ['no-valid-courses'], computedCourses: [], skippedCourses: skippedCourses, status: 'unknown' };
    }

    var dp = (gr.rounding && isNum(gr.rounding.dp)) ? gr.rounding.dp : 2;
    var method = (gr.rounding && gr.rounding.method) || 'half-up';
    var value = round(numerator / denominator, dp, method);

    return {
      value: value,
      computedFields: ['officialGpa'],
      skippedFields: [],
      computedCourses: computedCourses,
      skippedCourses: skippedCourses,
      status: skippedCourses.some(function (s) { return s.reason !== 'excluded'; }) ? 'partial' : 'verified'
    };
  }

  return { computeGpa: computeGpa };

});
