(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaAssessmentEngine = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function num(v) { return (v == null || v === '') ? null : Number(v); }

  // 只計算分數與加權；不做任何等級換算。
  // 門檻由 policy 提供；null 代表 unknown，此時 pass 為 'unknown'。
  function compute(assessments, options) {
    options = options || {};
    var caGroups = options.caGroups || ['CA', '作業', '專題'];
    var eaGroups = options.eaGroups || ['EA', '考試'];
    var caThreshold = (options.caPassThreshold == null) ? null : Number(options.caPassThreshold);
    var eaThreshold = (options.eaPassThreshold == null) ? null : Number(options.eaPassThreshold);

    var acc = { ca: { weight: 0, gradedWeight: 0, earned: 0 }, ea: { weight: 0, gradedWeight: 0, earned: 0 }, other: { weight: 0, gradedWeight: 0, earned: 0 } };
    var issues = [];
    var totalWeight = 0, gradedWeight = 0, secured = 0;

    (assessments || []).forEach(function (a) {
      var w = num(a.weightPercent) || 0;
      var max = num(a.maxPoints), earned = num(a.earnedPoints);
      var g = caGroups.indexOf(a.assessmentGroup) >= 0 ? 'ca' : (eaGroups.indexOf(a.assessmentGroup) >= 0 ? 'ea' : 'other');
      totalWeight += w;
      acc[g].weight += w;
      if (max != null && max > 0 && earned != null) {
        var c = w * (earned / max);
        secured += c; gradedWeight += w;
        acc[g].gradedWeight += w; acc[g].earned += c;
      } else {
        issues.push({ id: a.id, name: a.name, reason: 'ungraded' });
      }
    });

    function pct(s) { return s.gradedWeight > 0 ? (s.earned / s.gradedWeight * 100) : null; }
    function pass(s, threshold) {
      if (s.weight <= 0) return 'n/a';
      if (s.gradedWeight <= 0) return 'pending';
      if (threshold == null) return 'unknown';
      return pct(s) >= threshold;
    }

    var ca = { weight: acc.ca.weight, gradedWeight: acc.ca.gradedWeight, percentage: pct(acc.ca), pass: pass(acc.ca, caThreshold) };
    var ea = { weight: acc.ea.weight, gradedWeight: acc.ea.gradedWeight, percentage: pct(acc.ea), pass: pass(acc.ea, eaThreshold) };
    var other = { weight: acc.other.weight, gradedWeight: acc.other.gradedWeight, percentage: pct(acc.other), pass: pass(acc.other, null) };

    var ungradedWeight = totalWeight - gradedWeight;
    var maxFinal = totalWeight > 0 ? secured + ungradedWeight : 0;

    var passGate;
    if (ca.pass === false || ea.pass === false) passGate = 'fail';
    else if (ca.pass === 'pending' || ea.pass === 'pending') passGate = 'pending';
    else if (ca.pass === 'unknown' || ea.pass === 'unknown') passGate = 'unknown';
    else passGate = 'pass';

    return {
      secured: secured, gradedWeight: gradedWeight, ungradedWeight: ungradedWeight,
      maxFinal: maxFinal, totalWeight: totalWeight, passGate: passGate,
      ca: ca, ea: ea, other: other, issues: issues
    };
  }

  return { compute: compute };

});
