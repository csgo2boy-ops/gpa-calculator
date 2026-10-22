'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Db = require('../public/js/db.js');

function sampleState() {
  return {
    version: 1,
    terms: [{ id: 1, name: '上學期', sortOrder: 1 }],
    courses: [{ id: 1, termId: 1, code: 'ABC', title: '測試科目', credits: 3, gpaInclusion: 'include', officialMark: 88.5, officialGP: 4.0, crossSemesterPolicy: 'single', targetGrade: 'A' }],
    assessments: [{ id: 1, courseId: 1, name: '小測（中文）', assessmentGroup: 'CA', weightPercent: 30, maxPoints: null, earnedPoints: null }]
  };
}

test('seedState：預設為空白', () => {
  const s = Db.seedState();
  assert.strictEqual(s.terms.length, 0);
  assert.strictEqual(s.courses.length, 0);
  assert.strictEqual(s.assessments.length, 0);
});

test('stateToRows → rowsToState 往返一致（含 null 與中文）', () => {
  const state = sampleState();
  const back = Db.rowsToState(Db.stateToRows(state));
  assert.deepStrictEqual(back.terms, state.terms);
  assert.deepStrictEqual(back.courses, state.courses);
  assert.deepStrictEqual(back.assessments, state.assessments);
});

test('stateToRows 使用 snake_case 欄位（對應 Supabase 資料表）', () => {
  const rows = Db.stateToRows(sampleState());
  const c = rows.courses[0];
  assert.ok('local_id' in c && 'semester_local_id' in c && 'gpa_inclusion' in c);
  assert.ok('official_mark' in c && 'cross_semester_policy' in c && 'target_grade' in c);
  const a = rows.assessments[0];
  assert.ok('course_local_id' in a && 'assessment_group' in a && 'weight_percent' in a);
  assert.ok('max_points' in a && 'earned_points' in a);
});

test('rowsToState 正確對映 null（earned/max/code）', () => {
  const rows = {
    semesters: [{ local_id: 1, name: 'S1', sort_order: 1 }],
    courses: [{ local_id: 3, semester_local_id: 1, code: null, title: 'Enrichment', credits: 3, gpa_inclusion: 'include', official_mark: null, official_gp: null, cross_semester_policy: 'single', target_grade: 'A' }],
    assessments: [{ local_id: 3, course_local_id: 3, name: 'EA', assessment_group: 'EA', weight_percent: 30, max_points: null, earned_points: null }]
  };
  const state = Db.rowsToState(rows);
  assert.strictEqual(state.courses[0].code, null);
  assert.strictEqual(state.courses[0].officialMark, null);
  assert.strictEqual(state.assessments[0].maxPoints, null);
  assert.strictEqual(state.assessments[0].earnedPoints, null);
  assert.strictEqual(state.courses[0].termId, 1);
});

test('訪客模式：未登入時 isCloud=false，loadState 回傳空白', async () => {
  assert.strictEqual(Db.isCloud(), false);
  const state = await Db.loadState();
  assert.strictEqual(state.terms.length, 0);
  assert.strictEqual(state.courses.length, 0);
});
