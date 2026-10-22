'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Validate = require('../public/js/rules/validate.js');
const Resolver = require('../public/js/rules/rule-resolver.js');
const Assessment = require('../public/js/engines/assessment-engine.js');
const Grading = require('../public/js/engines/grading-policy-engine.js');
const Gpa = require('../public/js/engines/gpa-aggregation-engine.js');
const Scenario = require('../public/js/engines/scenario-engine.js');
const Attendance = require('../public/js/engines/attendance-policy.js');
const Storage = require('../public/storage.js');

const cuhk2021 = require('../public/rules/cuhk-undergraduate-2021-22.json');
const cuhk2026 = require('../public/rules/cuhk-undergraduate-2026-27.json');
const vtc = require('../public/rules/vtc-higher-diploma-ba114062-2023.json');

test('Schema：三個官方 profile 通過驗證', () => {
  assert.deepStrictEqual(Validate.validateProfile(cuhk2021).errors, []);
  assert.deepStrictEqual(Validate.validateProfile(cuhk2026).errors, []);
  assert.deepStrictEqual(Validate.validateProfile(vtc).errors, []);
});

test('Schema：缺 identity / 非法 gp 被拒', () => {
  assert.strictEqual(Validate.validateProfile({}).ok, false);
  const bad = JSON.parse(JSON.stringify(cuhk2021));
  bad.profile.gradeScale.grades[0].gp = 'four';
  assert.strictEqual(Validate.validateProfile(bad).ok, false);
});

test('RuleResolver：三層覆寫（subject 優先）', () => {
  const subject = {
    schemaVersion: 1, identity: cuhk2021.identity, scope: 'subject',
    scopeRef: { subjectCode: 'ACCT1010' },
    profile: { gpaRules: { formula: 'unknown' } },
    itemStatus: { gpaRules: 'custom' }, itemSources: {}
  };
  const r = Resolver.resolve(Object.assign({}, cuhk2021.identity, { subjectCode: 'ACCT1010' }), [cuhk2021, subject]);
  assert.strictEqual(r.layers.length, 2);
  assert.strictEqual(r.status.gpaRules, 'custom');
  assert.strictEqual(r.status.gradeScale, 'verified');
});

test('RuleResolver：不同入學年份不混用', () => {
  const req = { institutionId: 'cuhk', qualificationLevel: 'bachelor', admissionYear: 2022, regulationVersion: '2022-23' };
  const r = Resolver.resolve(req, [cuhk2021, cuhk2026]);
  assert.strictEqual(r.status.gradeScale, 'unknown');
  assert.strictEqual(r.fields.gradeScale, undefined);
});

test('AssessmentEngine：CA 80%/95 + EA 20%/0 → 76；門檻 unknown → passGate unknown', () => {
  const s = Assessment.compute([
    { id: 1, name: 'CA', assessmentGroup: 'CA', weightPercent: 80, maxPoints: 100, earnedPoints: 95 },
    { id: 2, name: 'EA', assessmentGroup: 'EA', weightPercent: 20, maxPoints: 100, earnedPoints: 0 }
  ], {});
  assert.ok(Math.abs(s.secured - 76) < 1e-9);
  assert.strictEqual(s.ca.pass, 'unknown');
  assert.strictEqual(s.passGate, 'unknown');
});

test('AssessmentEngine：VTC 40% 門檻 → EA 0% 未達標', () => {
  const s = Assessment.compute([
    { id: 1, name: 'CA', assessmentGroup: 'CA', weightPercent: 80, maxPoints: 100, earnedPoints: 95 },
    { id: 2, name: 'EA', assessmentGroup: 'EA', weightPercent: 20, maxPoints: 100, earnedPoints: 0 }
  ], { caPassThreshold: 40, eaPassThreshold: 40 });
  assert.strictEqual(s.ea.pass, false);
  assert.strictEqual(s.passGate, 'fail');
});

test('GradingPolicyEngine：CUHK 只有 GP、無百分比分界 → 不得推導等級', () => {
  const r = Resolver.resolve(cuhk2021.identity, [cuhk2021]);
  const g = Grading.toGrade(95, r);
  assert.strictEqual(g.grade, null);
  assert.strictEqual(g.reason, 'no-mark-boundaries');
});

test('GradingPolicyEngine：VTC 有百分比分界 → 正確換算', () => {
  const r = Resolver.resolve(Object.assign({}, vtc.identity, { programmeId: 'BA114062' }), [vtc]);
  assert.strictEqual(Grading.toGrade(95, r).grade, 'A');
  assert.strictEqual(Grading.toGrade(75, r).grade, 'A');
  assert.strictEqual(Grading.toGrade(74.9, r).grade, 'A-');
  assert.strictEqual(Grading.toGrade(40, r).grade, 'D');
  assert.strictEqual(Grading.toGrade(39.9, r).grade, 'F');
  assert.strictEqual(Grading.toGrade(100, r).grade, 'A');
});

test('GradingPolicyEngine：未知 scale 不可換算', () => {
  assert.strictEqual(Grading.toGrade(90, { fields: {}, status: { gradeScale: 'unknown' } }).grade, null);
});

test('GpaAggregationEngine：CUHK 公式已核實 → 只計正式等級', () => {
  const r = Resolver.resolve(cuhk2021.identity, [cuhk2021]);
  const res = Gpa.computeGpa([
    { id: 1, units: 3, officialGrade: 'A' },
    { id: 2, units: 2, officialGrade: 'B' },
    { id: 3, units: 1, officialGrade: 'P' },
    { id: 4, units: 3, officialGrade: null }
  ], r);
  assert.strictEqual(res.value, 3.6);
  assert.ok(res.skippedCourses.some(c => c.reason === 'non-counted-grade'));
  assert.ok(res.skippedCourses.some(c => c.reason === 'no-official-grade'));
});

test('GpaAggregationEngine：公式 unknown → 不產生官方 GPA', () => {
  const r = Resolver.resolve(Object.assign({}, vtc.identity, { programmeId: 'BA114062' }), [vtc]);
  const res = Gpa.computeGpa([{ id: 1, units: 3, officialGrade: 'A' }], r);
  assert.strictEqual(res.value, null);
  assert.ok(res.skippedFields.indexOf('gpaRules') >= 0);
});

test('ScenarioEngine：預測 GPA 標示 predicted', () => {
  const r = Resolver.resolve(cuhk2021.identity, [cuhk2021]);
  const res = Scenario.predictGpa([{ id: 1, units: 3, assumedGrade: 'A' }], r);
  assert.strictEqual(res.predicted, true);
  assert.strictEqual(res.value, 4.0);
});

test('Attendance：session 模式、取消課堂不計、遲到權重', () => {
  const res = Attendance.compute([
    { status: 'present' }, { status: 'present' }, { status: 'late' }, { status: 'absent' }, { status: 'cancelled' }
  ], { countingUnit: 'session', lateWeight: 0.5, attendanceThresholdPercent: 75 });
  assert.strictEqual(res.sessions, 4);
  assert.ok(Math.abs(res.rate - 62.5) < 1e-9);
  assert.strictEqual(res.meetsThreshold, false);
});

test('Attendance：minute 模式', () => {
  const res = Attendance.compute([
    { status: 'present', sessionMinutes: 60 },
    { status: 'absent', sessionMinutes: 60 }
  ], { countingUnit: 'minute', attendanceThresholdPercent: 80 });
  assert.ok(Math.abs(res.rate - 50) < 1e-9);
  assert.strictEqual(res.basis, 'minute');
});

test('Attendance：門檻 unknown → 只顯示出席率，不判定', () => {
  const res = Attendance.compute([{ status: 'present' }], { countingUnit: 'session' });
  assert.strictEqual(res.status, 'rate-only');
  assert.strictEqual(res.meetsThreshold, null);
});

test('Attendance：早退 / 請假 / 缺席', () => {
  const res = Attendance.compute([
    { status: 'present' }, { status: 'earlyLeave' }, { status: 'leave' }, { status: 'absent' }
  ], { countingUnit: 'session', earlyLeaveWeight: 0.5, leaveCountsAsAbsent: true, attendanceThresholdPercent: 70 });
  // attended = 1 + 0.5 + 0 + 0 = 1.5 / 4 = 37.5%
  assert.ok(Math.abs(res.rate - 37.5) < 1e-9);
});

test('隔離：CUHK 與 VTC 不共用 Grade Scale', () => {
  assert.strictEqual(Validate.hasMarkBoundaries(cuhk2021.profile.gradeScale), false);
  assert.strictEqual(Validate.hasMarkBoundaries(vtc.profile.gradeScale), true);
  const rC = Resolver.resolve(cuhk2021.identity, [cuhk2021]);
  const rV = Resolver.resolve(Object.assign({}, vtc.identity, { programmeId: 'BA114062' }), [vtc]);
  assert.strictEqual(Grading.toGrade(95, rC).grade, null);
  assert.strictEqual(Grading.toGrade(95, rV).grade, 'A');
});

test('舊 VTC 資料仍可安全讀取（Storage 範本）', () => {
  const tpl = Storage.template();
  assert.strictEqual(tpl.terms.length, 5);
  assert.strictEqual(tpl.courses.length, 34);
});

test('不完整政策不會產生錯誤官方 GPA', () => {
  const r = Resolver.resolve({ institutionId: 'unknown', qualificationLevel: 'bachelor', admissionYear: 2024, regulationVersion: 'x' }, []);
  const res = Gpa.computeGpa([{ id: 1, units: 3, officialGrade: 'A' }], r);
  assert.strictEqual(res.value, null);
});
