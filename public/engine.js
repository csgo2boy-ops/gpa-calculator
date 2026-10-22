/* =========================================================================
 * engine.js
 * GPA 計算引擎（純函式，無任何 I/O 或 DOM 依賴）。
 * 可同時在瀏覽器（window.GpaEngine）與 Node.js（module.exports）執行。
 *
 * 設計原則：
 * 1. 所有輸入強制轉為數字（Number），避免字串累加造成 "03010".toFixed 崩潰。
 * 2. 百分點內部以「100 為基準的積分（point-percent）」計算，避免浮點誤差。
 * 3. CA / EA 為獨立門檻，各自 40%，未評分一律回傳 'pending'，不提前判 False。
 * 4. 目標所需得分率採無條件進位（Ceil）到小數第一位，避免差 0.02 分落榜。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GpaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PY = 100;       // 1 分 × 100% = 100 point-percent
  var EPS = 1e-9;
  var PASS = 40;      // VTC/IVE CA 及 EA 及格線
  var CA_GROUPS = ['CA', '作業', '專題'];
  var EA_GROUPS = ['EA', '考試'];

  function getGrade(mark) {
    if (mark >= 75) return { grade: 'A', gp: 4.0 };
    if (mark >= 70) return { grade: 'A-', gp: 3.7 };
    if (mark >= 67) return { grade: 'B+', gp: 3.3 };
    if (mark >= 63) return { grade: 'B', gp: 3.0 };
    if (mark >= 60) return { grade: 'B-', gp: 2.7 };
    if (mark >= 57) return { grade: 'C+', gp: 2.3 };
    if (mark >= 53) return { grade: 'C', gp: 2.0 };
    if (mark >= 50) return { grade: 'C-', gp: 1.7 };
    if (mark >= 46) return { grade: 'D+', gp: 1.3 };
    if (mark >= 40) return { grade: 'D', gp: 1.0 };
    return { grade: 'F', gp: 0.0 };
  }

  // 根據 Grade 反查該等級的最低分數
  function getMarkFromGrade(grade) {
    var map = {
      'A': 75, 'A-': 70, 'B+': 67, 'B': 63, 'B-': 60,
      'C+': 57, 'C': 53, 'C-': 50, 'D+': 46, 'D': 40, 'F': 0
    };
    return map[grade] !== undefined ? map[grade] : 75;
  }

  // 四捨五入到指定小數位（處理浮點誤差，例如 1.005 -> 1.01）
  function roundTo(n, dp) {
    var f = Math.pow(10, dp);
    return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * f) / f;
  }

  // 無條件進位到 0.1
  function ceilTo1dp(n) {
    return Math.ceil(roundTo(n, 6) * 10 - EPS) / 10;
  }

  // 數值防呆：非有限數字 → null
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // 單一評核：是否已評分、得分率
  function assessInfo(a) {
    var weight = num(a.weightPercent) || 0;
    var max = num(a.maxPoints);
    var earned = num(a.earnedPoints);
    var hasMax = max !== null && max > 0;
    var scored = hasMax && earned !== null;
    var ratio = null;
    if (scored) ratio = earned / max;
    return { weight: weight, max: max, earned: earned, hasMax: hasMax, scored: scored, ratio: ratio };
  }

  // 群組統計（CA 或 EA）：回傳已評分項的加權得分百分比
  function groupStats(list) {
    var weight = 0, gradedWeight = 0, scoredPY = 0;
    var issues = [];
    list.forEach(function (a) {
      var i = assessInfo(a);
      weight += i.weight;
      if (i.scored) {
        gradedWeight += i.weight;
        scoredPY += i.ratio * i.weight * PY;
        if (i.ratio < 0 || i.ratio > 1) issues.push(a.name + '：得分不在 0 至滿分之間');
      }
    });
    var complete = weight > 0 && Math.abs(gradedWeight - weight) < 1e-6;
    var percentage = null;
    var pass = null;
    if (weight > 0) {
      if (complete) {
        percentage = gradedWeight > 0 ? (scoredPY / (gradedWeight * PY)) * 100 : 0;
        pass = roundTo(percentage, 6) >= PASS - EPS;
      } else {
        pass = 'pending';
      }
    }
    return {
      weight: roundTo(weight, 4),
      gradedWeight: roundTo(gradedWeight, 4),
      percentage: percentage === null ? null : roundTo(percentage, 4),
      pass: pass,
      complete: complete,
      issues: issues
    };
  }

  function calculateCourse(assessments, targetGrade) {
    if (targetGrade === undefined) targetGrade = 'A';
    var list = Array.isArray(assessments) ? assessments : [];
    var issues = [];

    // --- 1. 逐項統計（強制數值化） ---
    var lockedPY = 0;        // 已鎖定積分（point × percent）
    var gradedWeight = 0;    // 已評分權重
    var totalWeight = 0;     // 全部權重
    var ca = [], ea = [], other = [];

    list.forEach(function (a) {
      var i = assessInfo(a);
      if (!Number.isFinite(i.weight) || i.weight < 0) {
        issues.push(a.name + '：權重不是有效數字');
      }
      totalWeight += Math.max(0, i.weight);
      if (i.scored) {
        gradedWeight += i.weight;
        lockedPY += i.ratio * i.weight * PY;
        if (i.ratio < 0 || i.ratio > 1) issues.push(a.name + '：得分不在 0 至滿分之間');
      }
      if (CA_GROUPS.indexOf(a.assessmentGroup) !== -1) ca.push(a);
      else if (EA_GROUPS.indexOf(a.assessmentGroup) !== -1) ea.push(a);
      else other.push(a);
    });

    var ungradedWeight = Math.max(0, totalWeight - gradedWeight);
    var isWeightValid = Math.abs(totalWeight - 100) < 0.01;
    var isGraded = totalWeight > 0 && ungradedWeight < 1e-6;

    // --- 2. CA / EA 獨立門檻 ---
    var caStats = groupStats(ca);
    var eaStats = groupStats(ea);

    // --- 3. 目標計算 ---
    var targetMark = getMarkFromGrade(targetGrade);
    var maxFinal = (lockedPY + ungradedWeight * PY) / PY;   // 剩餘全拿滿分的最高總分
    var securedScore = lockedPY / PY;

    // --- 3b. CA/EA 雙門檻是否已「確認達標」---
    // 分數達標並不代表合格：若 CA 或 EA 未達 40% 門檻，不得顯示「已達標」。
    var passGate;
    if (caStats.pass === false || eaStats.pass === false) passGate = 'fail';
    else if (caStats.pass === 'pending' || eaStats.pass === 'pending') passGate = 'pending';
    else passGate = 'pass';

    var targetStatus;
    var requiredAvg = null;
    if (securedScore >= targetMark - EPS) {
      if (passGate === 'fail') targetStatus = 'threshold-failed';
      else if (passGate === 'pending') targetStatus = 'locked-pending';
      else targetStatus = 'locked';
    } else if (maxFinal < targetMark - EPS) {
      targetStatus = 'impossible';
    } else if (isGraded) {
      targetStatus = 'failed';
    } else {
      // Required Rate = (Target - CurrentLocked) / (RemainingWeight / 100)
      requiredAvg = ceilTo1dp(((targetMark - securedScore) * 100) / ungradedWeight);
      if (requiredAvg > 100 + EPS) targetStatus = 'impossible';
      else targetStatus = 'achievable';
    }

    // --- 4. 只有全部評分完畢才給出等第，避免誤導 ---
    var grade = null, gp = null;
    if (isGraded && isWeightValid) {
      var failGate = caStats.pass === false || eaStats.pass === false;
      var g = getGrade(failGate ? Math.min(securedScore, PASS - 0.1) : securedScore);
      grade = g.grade;
      gp = g.gp;
    }

    var otherWeight = 0;
    other.forEach(function (a) { otherWeight += num(a.weightPercent) || 0; });

    return {
      // 原有欄位（向後相容）
      secured: roundTo(securedScore, 4),
      gradedWeight: roundTo(gradedWeight, 4),
      ungradedWeight: roundTo(ungradedWeight, 4),
      maxFinal: roundTo(maxFinal, 4),
      isWeightValid: isWeightValid,
      isGraded: isGraded,
      caWeight: caStats.weight,
      eaWeight: eaStats.weight,
      otherWeight: roundTo(otherWeight, 4),
      targetGrade: targetGrade,
      targetMark: targetMark,
      targetStatus: targetStatus,
      requiredAvg: requiredAvg,
      passGate: passGate,

      // CA / EA 雙門檻
      ca: {
        weight: caStats.weight,
        gradedWeight: caStats.gradedWeight,
        percentage: caStats.percentage,
        pass: caStats.pass,
        complete: caStats.complete
      },
      ea: {
        weight: eaStats.weight,
        gradedWeight: eaStats.gradedWeight,
        percentage: eaStats.percentage,
        pass: eaStats.pass,
        complete: eaStats.complete
      },
      passLine: PASS,
      overallPass: null,

      // 資料品質提示
      issues: issues,

      // 只有全部評分完畢才有值
      grade: grade,
      gp: gp
    };
  }

  return {
    getGrade: getGrade,
    calculateCourse: calculateCourse,
    getMarkFromGrade: getMarkFromGrade,
    roundTo: roundTo,
    ceilTo1dp: ceilTo1dp,
    PASS_LINE: PASS
  };
});
