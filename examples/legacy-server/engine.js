// GPA Tracker 計算引擎
// 設計原則：
// 1. 所有輸入強制轉為數字 (Number)，避免字串累加造成 "03010".toFixed 崩潰。
// 2. 百分點內部用「以 100 為基準的積分 (point-percent)」計算，避免浮點誤差。
// 3. CA / EA 為獨立門檻，各自 40%，未評分一律回傳 'pending'，不提前判 False。

const PY = 100;                       // 1 point × 100% = 100 point-percent
const EPS = 1e-9;
const PASS = 40;                      // VTC/IVE CA 及 EA 及格線
const CA_GROUPS = new Set(['CA', '作業', '專題']);
const EA_GROUPS = new Set(['EA', '考試']);

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
  const map = {
    'A': 75, 'A-': 70, 'B+': 67, 'B': 63, 'B-': 60,
    'C+': 57, 'C': 53, 'C-': 50, 'D+': 46, 'D': 40, 'F': 0
  };
  return map[grade] !== undefined ? map[grade] : 75;
}

// 四捨五入到指定小數位（處理浮點誤差，例如 1.005 -> 1.01）
function roundTo(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * f) / f;
}

// 無條件進位到 0.1：避免「顯示 67.3% 但實際只需 67.34%」造成差 0.02 分落榜
function ceilTo1dp(n) {
  const f = 10;
  return Math.ceil(roundTo(n, 6) * f - EPS) / f;
}

// 數值防呆：非有限數字 → null
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 單一評核：是否已評分、得分率
function assessInfo(a) {
  const weight = num(a.weightPercent) || 0;
  const max = num(a.maxPoints);
  const earned = num(a.earnedPoints);
  const hasMax = max !== null && max > 0;
  const scored = hasMax && earned !== null;
  let ratio = null;
  if (scored) ratio = earned / max;
  return { weight, max, earned, hasMax, scored, ratio };
}

// 群組統計（CA 或 EA）：回傳已評分項的加權得分百分比
function groupStats(list) {
  let weight = 0, gradedWeight = 0, scoredPY = 0;
  const issues = [];
  list.forEach(a => {
    const i = assessInfo(a);
    weight += i.weight;
    if (i.scored) {
      gradedWeight += i.weight;
      scoredPY += i.ratio * i.weight * PY;
      if (i.ratio < 0 || i.ratio > 1) issues.push(`${a.name}：得分不在 0 至滿分之間`);
    }
  });
  const complete = weight > 0 && Math.abs(gradedWeight - weight) < 1e-6;
  let percentage = null;
  let pass = null;
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
    pass,
    complete,
    issues
  };
}

function calculateCourse(assessments, targetGrade = 'A') {
  const list = Array.isArray(assessments) ? assessments : [];
  const issues = [];

  // --- 1. 逐項統計（強制數值化） ---
  let lockedPY = 0;        // 已鎖定積分 (point × percent)
  let gradedWeight = 0;    // 已評分權重
  let totalWeight = 0;     // 全部權重
  const ca = [], ea = [], other = [];

  list.forEach(a => {
    const i = assessInfo(a);
    if (!Number.isFinite(i.weight) || i.weight < 0) {
      issues.push(`${a.name}：權重不是有效數字`);
    }
    totalWeight += Math.max(0, i.weight);
    if (i.scored) {
      gradedWeight += i.weight;
      lockedPY += i.ratio * i.weight * PY;
      if (i.ratio < 0 || i.ratio > 1) issues.push(`${a.name}：得分不在 0 至滿分之間`);
    }
    if (CA_GROUPS.has(a.assessmentGroup)) ca.push(a);
    else if (EA_GROUPS.has(a.assessmentGroup)) ea.push(a);
    else other.push(a);
  });

  const ungradedWeight = Math.max(0, totalWeight - gradedWeight);
  const isWeightValid = Math.abs(totalWeight - 100) < 0.01;
  const isGraded = totalWeight > 0 && ungradedWeight < 1e-6;

  // --- 2. CA / EA 獨立門檻 ---
  const caStats = groupStats(ca);
  const eaStats = groupStats(ea);

  // --- 3. 目標計算 ---
  const targetMark = getMarkFromGrade(targetGrade);
  const maxFinal = (lockedPY + ungradedWeight * PY) / PY;   // 剩餘全拿滿分的最高總分
  const securedScore = lockedPY / PY;

  let targetStatus;
  let requiredAvg = null;
  if (securedScore >= targetMark - EPS) {
    targetStatus = 'locked';
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
  let grade = null, gp = null;
  if (isGraded && isWeightValid) {
    const failGate = caStats.pass === false || eaStats.pass === false;
    const g = getGrade(failGate ? Math.min(securedScore, PASS - 0.1) : securedScore);
    grade = g.grade;
    gp = g.gp;
  }

  return {
    // 原有欄位（向後相容）
    secured: roundTo(securedScore, 4),
    gradedWeight: roundTo(gradedWeight, 4),
    ungradedWeight: roundTo(ungradedWeight, 4),
    maxFinal: roundTo(maxFinal, 4),
    isWeightValid,
    isGraded,
    caWeight: caStats.weight,
    eaWeight: eaStats.weight,
    otherWeight: roundTo(other.reduce((s, a) => s + (num(a.weightPercent) || 0), 0), 4),
    targetGrade,
    targetMark,
    targetStatus,
    requiredAvg,

    // 新增：CA / EA 雙門檻
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

    // 資料品質提示（前端可顯示）
    issues,

    // 只有全部評分完畢才有值
    grade,
    gp
  };
}

module.exports = { getGrade, calculateCourse, getMarkFromGrade, roundTo, ceilTo1dp, PASS_LINE: PASS };
