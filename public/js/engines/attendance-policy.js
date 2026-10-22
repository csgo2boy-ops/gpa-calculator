(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaAttendancePolicy = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var STATUSES = ['present', 'absent', 'late', 'earlyLeave', 'leave', 'cancelled'];

  function num(v) { return (v == null || v === '') ? null : Number(v); }
  function nOr(v, d) { var n = num(v); return n == null ? d : n; }

  // 純計算：只依 policy；policy 為 unknown 時回報 unknown，不套用預設門檻。
  function compute(records, policy) {
    policy = policy || {};
    var unit = policy.countingUnit || 'unknown';
    var excludedCancelled = policy.cancelledExcluded !== false;
    var lateAsAbsent = policy.lateCountsAsAbsent === true;
    var leaveAsAbsent = policy.leaveCountsAsAbsent === true;
    var lateWeight = policy.lateWeight == null ? null : Number(policy.lateWeight);
    var earlyWeight = policy.earlyLeaveWeight == null ? null : Number(policy.earlyLeaveWeight);
    var threshold = policy.attendanceThresholdPercent == null ? null : Number(policy.attendanceThresholdPercent);
    var sessionMinutes = policy.sessionMinutes == null ? null : Number(policy.sessionMinutes);

    var sessions = 0, attendedSessions = 0, minutes = 0, attendedMinutes = 0;
    var counts = { present: 0, absent: 0, late: 0, earlyLeave: 0, leave: 0, cancelled: 0 };

    (records || []).forEach(function (r) {
      if (!r || STATUSES.indexOf(r.status) < 0) return;
      if (r.status === 'cancelled') { counts.cancelled++; if (excludedCancelled) return; }
      counts[r.status] = (counts[r.status] || 0) + 1;
      var sm = nOr(r.sessionMinutes, sessionMinutes);
      if (sm != null) minutes += sm;

      if (r.status === 'present') { sessions++; attendedSessions++; if (sm != null) attendedMinutes += sm; }
      else if (r.status === 'absent') { sessions++; }
      else if (r.status === 'late') {
        sessions++;
        var lw = lateAsAbsent ? 0 : (lateWeight == null ? 1 : lateWeight);
        attendedSessions += lw;
        if (sm != null) attendedMinutes += sm * lw;
      } else if (r.status === 'earlyLeave') {
        sessions++;
        var ew = earlyWeight == null ? 1 : earlyWeight;
        attendedSessions += ew;
        if (sm != null) attendedMinutes += sm * ew;
      } else if (r.status === 'leave') {
        sessions++;
        var lv = leaveAsAbsent ? 0 : 1;
        attendedSessions += lv;
        if (sm != null) attendedMinutes += sm * lv;
      }
    });

    var rate = null, basis = null;
    if (unit === 'minute' || (unit === 'hybrid' && minutes > 0)) {
      basis = 'minute';
      if (minutes > 0) rate = attendedMinutes / minutes * 100;
    } else if (unit === 'session' || (unit === 'hybrid' && sessions > 0)) {
      basis = 'session';
      if (sessions > 0) rate = attendedSessions / sessions * 100;
    }

    var meetsThreshold = null;
    if (rate != null && threshold != null) meetsThreshold = rate >= threshold;

    var status = 'unknown';
    if (unit === 'unknown') status = 'unknown';
    else if (rate == null) status = 'insufficient-data';
    else if (threshold == null) status = 'rate-only';
    else status = 'computed';

    if (policy.futureTotalSessionsUnknown === true) status = 'incomplete';

    return {
      rate: rate, basis: basis, threshold: threshold, meetsThreshold: meetsThreshold,
      status: status, counts: counts, sessions: sessions, minutes: minutes,
      attendedSessions: attendedSessions, attendedMinutes: attendedMinutes
    };
  }

  return { compute: compute, STATUSES: STATUSES };

});
