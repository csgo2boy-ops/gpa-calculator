'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Db = require('../public/js/db.js');

function stateWithUids() {
  return {
    version: 1,
    terms: [{ id: 1, uid: 't1', name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: 'c1', termId: 1, termUid: 't1', code: 'X', title: 'C1', credits: 3, gpaInclusion: 'include', officialMark: null, officialGP: null, crossSemesterPolicy: 'single', targetGrade: 'A' }],
    assessments: [{ id: 1, uid: 'a1', courseId: 1, courseUid: 'c1', name: 'A1', assessmentGroup: 'CA', weightPercent: 100, maxPoints: 100, earnedPoints: 50 }]
  };
}

function makeRpcClient(opts) {
  const calls = [];
  return {
    calls,
    rpc(name, params) {
      calls.push({ name, params });
      if (opts && opts.error) return Promise.resolve({ data: null, error: opts.error });
      if (opts && opts.conflict != null) return Promise.resolve({ data: { ok: false, conflict: true, current_revision: opts.conflict }, error: null });
      return Promise.resolve({ data: { ok: true, revision: (opts && opts.revision != null) ? opts.revision : 6 }, error: null });
    }
  };
}

test('seedState：預設為空白', () => {
  const s = Db.seedState();
  assert.strictEqual(s.terms.length, 0);
  assert.strictEqual(s.courses.length, 0);
  assert.strictEqual(s.assessments.length, 0);
});

test('stateToRows：含 uid 與 snake_case 欄位', () => {
  const rows = Db.stateToRows(stateWithUids());
  assert.strictEqual(rows.semesters[0].uid, 't1');
  assert.strictEqual(rows.courses[0].uid, 'c1');
  assert.ok('semester_local_id' in rows.courses[0] && 'gpa_inclusion' in rows.courses[0]);
  assert.ok('course_local_id' in rows.assessments[0] && 'weight_percent' in rows.assessments[0]);
});

test('rowsToState：還原 uid 與關聯 uid', () => {
  const rows = {
    semesters: [{ local_id: 1, uid: 't1', name: 'S1', sort_order: 1 }],
    courses: [{ local_id: 1, uid: 'c1', semester_local_id: 1, code: null, title: 'C1', credits: 3, gpa_inclusion: 'include', official_mark: null, official_gp: null, cross_semester_policy: 'single', target_grade: 'A' }],
    assessments: [{ local_id: 1, uid: 'a1', course_local_id: 1, name: 'A1', assessment_group: 'CA', weight_percent: 100, max_points: null, earned_points: null }]
  };
  const s = Db.rowsToState(rows);
  assert.strictEqual(s.terms[0].uid, 't1');
  assert.strictEqual(s.courses[0].termUid, 't1');
  assert.strictEqual(s.assessments[0].courseUid, 'c1');
  assert.strictEqual(s.assessments[0].earnedPoints, null);
});

test('mergeStates：相同 uid 視為同一筆（不重複）', () => {
  const m = Db.mergeStates(stateWithUids(), stateWithUids());
  assert.strictEqual(m.terms.length, 1);
  assert.strictEqual(m.courses.length, 1);
  assert.strictEqual(m.assessments.length, 1);
});

test('mergeStates：不同 uid 即使本地 id 相同也不衝突，並重新映射關聯', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 1, uid: 't2', name: 'L-Term', sortOrder: 1 }],
    courses: [{ id: 1, uid: 'c2', termId: 1, termUid: 't2', title: 'L-Course', credits: 3 }],
    assessments: [{ id: 1, uid: 'a2', courseId: 1, courseUid: 'c2', name: 'L-A', assessmentGroup: 'CA', weightPercent: 100, maxPoints: 100, earnedPoints: 50 }]
  };
  const m = Db.mergeStates(cloud, local);
  assert.strictEqual(m.terms.length, 2);
  assert.strictEqual(m.courses.length, 2);
  assert.strictEqual(m.assessments.length, 2);
  assert.deepStrictEqual(m.courses.map(c => c.id).sort(), [1, 2]);
  const courseByUid = {};
  m.courses.forEach(c => { courseByUid[c.uid] = c; });
  m.assessments.forEach(a => { assert.strictEqual(courseByUid[a.courseUid].id, a.courseId); });
  const termByUid = {};
  m.terms.forEach(t => { termByUid[t.uid] = t; });
  m.courses.forEach(c => { assert.strictEqual(termByUid[c.termUid].id, c.termId); });
});

test('mergeStates：父項被刪除時丟棄孤兒並回報', () => {
  const cloud = { version: 1, terms: [], courses: [], assessments: [] };
  const local = { version: 1, terms: [], courses: stateWithUids().courses, assessments: stateWithUids().assessments };
  const m = Db.mergeStates(cloud, local);
  assert.strictEqual(m.courses.length, 0);
  assert.strictEqual(m.assessments.length, 0);
  assert.strictEqual(m.orphans.courses, 1);
  assert.strictEqual(m.orphans.assessments, 1);
});

test('persistCloud：以 RPC 傳入 expected revision 並更新 revision', async () => {
  const client = makeRpcClient({ revision: 7 });
  const res = await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 });
  assert.strictEqual(res.revision, 7);
  assert.strictEqual(client.calls.length, 1);
  assert.strictEqual(client.calls[0].name, 'gpa_replace_snapshot');
  assert.strictEqual(client.calls[0].params.p_expected_revision, 6);
  assert.strictEqual(client.calls[0].params.p_semesters[0].uid, 't1');
  assert.strictEqual(client.calls[0].params.p_courses[0].uid, 'c1');
});

test('persistCloud：revision 衝突時丟出 REVISION_CONFLICT', async () => {
  const client = makeRpcClient({ conflict: 9 });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 }); }
  catch (e) { caught = e; }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'REVISION_CONFLICT');
  assert.strictEqual(caught.currentRevision, 9);
});

test('persistCloud：RPC 錯誤時丟出例外（不宣稱成功）', async () => {
  const client = makeRpcClient({ error: { message: 'boom' } });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1' }); } catch (e) { caught = e; }
  assert.ok(caught);
  assert.strictEqual(caught.code, undefined);
});

test('persistCloud：缺少 migration（function does not exist）→ MIGRATION_REQUIRED', async () => {
  const client = makeRpcClient({ error: { message: 'function public.gpa_replace_snapshot(jsonb, jsonb, jsonb, bigint) does not exist' } });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1' }); } catch (e) { caught = e; }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'MIGRATION_REQUIRED');
});

test('訪客模式：未登入時 isCloud=false，loadState 回傳空白', async () => {
  assert.strictEqual(Db.isCloud(), false);
  const state = await Db.loadState();
  assert.strictEqual(state.terms.length, 0);
  assert.strictEqual(state.courses.length, 0);
});
