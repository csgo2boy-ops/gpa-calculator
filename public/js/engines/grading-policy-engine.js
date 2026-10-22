(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaGradingPolicyEngine = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 分數 -> 等級：只有當 gradeScale 已核實「且」具有百分比分界時才可換算。
  // 若只有 Grade Point 表而無分界，回傳 null（不可自行推斷教授門檻）。
  function toGrade(score, resolution) {
    var gs = resolution && resolution.fields && resolution.fields.gradeScale;
    var status = resolution && resolution.status && resolution.status.gradeScale;
    if (!gs) return { grade: null, gp: null, reason: 'no-grade-scale' };
    if (status === 'unknown' || status === 'deprecated') return { grade: null, gp: null, reason: 'unverified-grade-scale' };

    var bounded = (gs.grades || []).filter(function (g) { return isNum(g.minMark) && isNum(g.maxMark); });
    if (bounded.length === 0) return { grade: null, gp: null, reason: 'no-mark-boundaries' };
    if (!isNum(score)) return { grade: null, gp: null, reason: 'invalid-score' };

    for (var i = 0; i < bounded.length; i++) {
      var g = bounded[i];
      if (score >= g.minMark && score < g.maxMark) {
        return { grade: g.letter, gp: g.gp, reason: 'mark-range' };
      }
    }
    return { grade: null, gp: null, reason: 'out-of-range' };
  }

  function gpOf(letter, resolution) {
    var gs = resolution && resolution.fields && resolution.fields.gradeScale;
    if (!gs) return null;
    for (var i = 0; i < (gs.grades || []).length; i++) {
      if (gs.grades[i].letter === letter) return gs.grades[i].gp;
    }
    return null;
  }

  return { toGrade: toGrade, gpOf: gpOf };

});
