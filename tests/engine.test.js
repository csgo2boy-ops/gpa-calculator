'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/engine.js');
const LegacyEngine = require('../examples/legacy-server/engine.js');

function a(name, g, w, max, earned) {
  return { name, assessmentGroup: g, weightPercent: w, maxPoints: max, earnedPoints: earned };
}

test('getGrade 邊界值', () => {
  assert.deepStrictEqual(Engine.getGrade(75), { grade: 'A', gp: 4.0 });
  assert.deepStrictEqual(Engine.getGrade(74.9), { grade: 'A-', gp: 3.7 });
  assert.deepStrictEqual(Engine.getGrade(70), { grade: 'A-', gp: 3.7 });
  assert.deepStrictEqual(Engine.getGrade(63), { grade: 'B', gp: 3.0 });
  assert.deepStrictEqual(Engine.getGrade(40), { grade: 'D', gp: 1.0 });
  assert.deepStrictEqual(Engine.getGrade(39.9), { grade: 'F', gp: 0.0 });
});

test('getMarkFromGrade 反查', () => {
  assert.strictEqual(Engine.getMarkFromGrade('A'), 75);
  assert.strictEqual(Engine.getMarkFromGrade('A-'), 70);
  assert.strictEqual(Engine.getMarkFromGrade('D'), 40);
});

test('驗收：無條件進位 requiredAvg = 67.4', () => {
  const s = Engine.calculateCourse([a('mid', 'CA', 40, 100, 86.5), a('final', 'EA', 60, 100, null)], 'A');
  assert.strictEqual(s.requiredAvg, 67.4);
  assert.strictEqual(s.targetStatus, 'achievable');
  assert.ok(Math.abs(s.secured - 34.6) < 1e-9);
});

test('驗收：CA/EA 雙門檻（總分 60、EA 未達標 30%）', () => {
  const s = Engine.calculateCourse([a('ca', 'CA', 60, 100, 80), a('ea', 'EA', 40, 100, 30)], 'A');
  assert.ok(Math.abs(s.secured - 60) < 1e-6);
  assert.strictEqual(s.ea.pass, false);
  assert.ok(Math.abs(s.ea.percentage - 30) < 1e-6);
  assert.strictEqual(s.ca.pass, true);
  assert.ok(Math.abs(s.ca.percentage - 80) < 1e-6);
});

test('驗收：不可達（maxFinal = 70）', () => {
  const s = Engine.calculateCourse([a('mid', 'CA', 60, 100, 50), a('final', 'EA', 40, 100, null)], 'A');
  assert.ok(Math.abs(s.maxFinal - 70) < 1e-6);
  assert.strictEqual(s.targetStatus, 'impossible');
});

test('穩健性：字串 / 垃圾權重不崩潰（強制數值化）', () => {
  let s;
  assert.doesNotThrow(() => {
    s = Engine.calculateCourse([a('x', 'CA', '30', 100, 50), a('y', 'CA', 'abc', 100, 50), a('z', 'EA', 40, 100, 50)], 'A');
  });
  assert.ok(Number.isFinite(s.secured));
  // 得分超出滿分時才會進入 issues（資料品質提示）
  const s2 = Engine.calculateCourse([a('x', 'CA', 60, 100, 150), a('z', 'EA', 40, 100, 50)], 'A');
  assert.ok(s2.issues.length > 0);
});

test('EA 未評分 → pending', () => {
  const s = Engine.calculateCourse([a('ca', 'CA', 60, 100, 80), a('ea', 'EA', 40, 100, null)], 'A');
  assert.strictEqual(s.ea.pass, 'pending');
});

test('已達標 → locked + grade A', () => {
  const s = Engine.calculateCourse([a('ca', 'CA', 50, 100, 80), a('ea', 'EA', 50, 100, 80)], 'A');
  assert.strictEqual(s.targetStatus, 'locked');
  assert.strictEqual(s.grade, 'A');
});

test('ITP3902 真實資料（secured 34.6 / CA 86.5% / EA pending）', () => {
  const s = Engine.calculateCourse([
    a('ca', 'CA', 30, 50, 41),
    a('hw', '作業', 10, 10, 10),
    a('ea', 'EA', 30, null, null),
    a('final', '考試', 30, null, null)
  ], 'A');
  assert.ok(Math.abs(s.secured - 34.6) < 1e-9);
  assert.strictEqual(s.ca.pass, true);
  assert.ok(Math.abs(s.ca.percentage - 86.5) < 1e-6);
  assert.strictEqual(s.ea.pass, 'pending');
  assert.strictEqual(s.requiredAvg, 67.4);
});

test('Batch 1.2：CA 80% 得 95、EA 20% 得 0 → 總分 76 但 EA 未達 40%，不得顯示已達標', () => {
  const s = Engine.calculateCourse([a('CA', 'CA', 80, 100, 95), a('EA', 'EA', 20, 100, 0)], 'A');
  assert.ok(Math.abs(s.secured - 76) < 1e-6);
  assert.strictEqual(s.ca.pass, true);
  assert.strictEqual(s.ea.pass, false);
  assert.strictEqual(s.passGate, 'fail');
  assert.notStrictEqual(s.targetStatus, 'locked');
  assert.strictEqual(s.targetStatus, 'threshold-failed');
  assert.strictEqual(s.grade, 'F');
});

test('Batch 1.2：CA 已評分、EA 待評分 → 即使分數達標也只顯示 pending', () => {
  const s = Engine.calculateCourse([a('CA', 'CA', 70, 100, 100), a('EA', 'EA', 30, 100, null)], 'B');
  assert.ok(Math.abs(s.secured - 70) < 1e-6);
  assert.strictEqual(s.ca.pass, true);
  assert.strictEqual(s.ea.pass, 'pending');
  assert.strictEqual(s.passGate, 'pending');
  assert.strictEqual(s.targetStatus, 'locked-pending');
});

test('Batch 1.2：CA/EA 皆達標且分數達標 → locked', () => {
  const s = Engine.calculateCourse([a('CA', 'CA', 50, 100, 80), a('EA', 'EA', 50, 100, 80)], 'A');
  assert.strictEqual(s.passGate, 'pass');
  assert.strictEqual(s.targetStatus, 'locked');
  assert.strictEqual(s.grade, 'A');
});

test('Batch 1.2：CA 未達標且目標無法達成 → impossible（不得顯示已達標）', () => {
  const s = Engine.calculateCourse([a('CA', 'CA', 80, 100, 20), a('EA', 'EA', 20, 100, 90)], 'A');
  assert.ok(Math.abs(s.secured - 34) < 1e-6);
  assert.strictEqual(s.ca.pass, false);
  assert.strictEqual(s.passGate, 'fail');
  assert.strictEqual(s.targetStatus, 'impossible');
});

test('新舊引擎 100% 一致（隨機對照 2000 組）', () => {
  const groups = ['CA', 'EA', '作業', '專題', '考試', '其他'];
  let seed = 42;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function randInt(n) { return Math.floor(rand() * n); }

  for (let round = 0; round < 2000; round++) {
    const n = 1 + randInt(6);
    const list = [];
    for (let i = 0; i < n; i++) {
      const weight = rand() < 0.15 ? String(randInt(101)) : Math.round(rand() * 1000) / 10;
      const max = rand() < 0.3 ? null : Math.round(rand() * 200);
      const earned = max === null || rand() < 0.25 ? null : Math.round(rand() * (max + 20));
      list.push(a('item' + i, groups[randInt(groups.length)], weight, max, earned));
    }
    const grades = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'];
    const tg = grades[randInt(grades.length)];
    const gotNew = Engine.calculateCourse(list, tg);
    const gotLegacy = LegacyEngine.calculateCourse(list, tg);
    // Batch 1.2 起 targetStatus / passGate 語義已強化，只比較未變更的穩定欄位
    const stable = function (o) {
      return {
        secured: o.secured, gradedWeight: o.gradedWeight, ungradedWeight: o.ungradedWeight,
        maxFinal: o.maxFinal, isWeightValid: o.isWeightValid, isGraded: o.isGraded,
        ca: o.ca, ea: o.ea, otherWeight: o.otherWeight, grade: o.grade, gp: o.gp
      };
    };
    assert.deepStrictEqual(stable(gotNew), stable(gotLegacy), 'mismatch at round ' + round + ' target ' + tg + ' list ' + JSON.stringify(list));
  }
});
