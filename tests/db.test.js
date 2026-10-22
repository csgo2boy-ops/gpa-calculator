'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Db = require('../public/js/db.js');

test('seedState：5 學期 / 34 課程 / 5 評核', () => {
  const s = Db.seedState();
  assert.strictEqual(s.terms.length, 5);
  assert.strictEqual(s.courses.length, 34);
  assert.strictEqual(s.assessments.length, 5);
});

test('stateToRows → rowsToState 往返一致（含 null 與中文）', () => {
  const state = Db.seedState();
  // 加入一個含 null 與中文的評核，驗證欄位保真
  state.assessments.push({ id: 999, courseId: 2, name: '小測（中文）', assessmentGroup: 'CA', weightPercent: 15, maxPoints: null, earnedPoints: null });
  state.courses[0].officialMark = 88.5;
  state.courses[0].officialGP = 4.0;

  const rows = Db.stateToRows(state);
  const back = Db.rowsToState(rows);

  assert.deepStrictEqual(back.terms, state.terms);
  assert.deepStrictEqual(back.courses, state.courses);
  assert.deepStrictEqual(back.assessments, state.assessments);
});

test('stateToRows 使用 snake_case 欄位（對應 Supabase 資料表）', () => {
  const state = Db.seedState();
  const rows = Db.stateToRows(state);
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

test('訪客模式：未登入時 isCloud=false，loadState 回傳種子', async () => {
  // Node 環境無 Supabase，auth 會自動降級 → isCloud false
  assert.strictEqual(Db.isCloud(), false);
  const state = await Db.loadState();
  assert.strictEqual(state.courses.length, 34);
  assert.strictEqual(state.terms.length, 5);
});
