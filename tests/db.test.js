'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const Db = require('../public/js/db.js');

const U = {
  t1: '11111111-1111-4111-8111-111111111111',
  c1: '22222222-2222-4222-8222-222222222222',
  a1: '33333333-3333-4333-8333-333333333333',
  t2: '44444444-4444-4444-8444-444444444444',
  c2: '55555555-5555-4555-8555-555555555555',
  a2: '66666666-6666-4666-8666-666666666666'
};

function stateWithUids() {
  return {
    version: 1,
    terms: [{ id: 1, uid: U.t1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c1, termId: 1, termUid: U.t1, code: 'X', title: 'C1', credits: 3, gpaInclusion: 'include', officialMark: null, officialGP: null, crossSemesterPolicy: 'single', targetGrade: 'A' }],
    assessments: [{ id: 1, uid: U.a1, courseId: 1, courseUid: U.c1, name: 'A1', assessmentGroup: 'CA', weightPercent: 100, maxPoints: 100, earnedPoints: 50 }]
  };
}

function makeClient(opts) {
  const calls = [];
  return {
    calls,
    rpc(name, params) {
      calls.push({ name, params });
      if (opts && opts.reject) return Promise.reject(opts.reject);
      if (name === 'gpa_read_snapshot') {
        if (opts && opts.readError) return Promise.resolve({ data: null, error: opts.readError });
        return Promise.resolve({ data: opts && opts.readData, error: null });
      }
      if (opts && opts.writeError) return Promise.resolve({ data: null, error: opts.writeError });
      return Promise.resolve({ data: opts && opts.writeData, error: null });
    }
  };
}

test('seedState：預設為空白', () => {
  const s = Db.seedState();
  assert.strictEqual(s.terms.length, 0);
});

test('stateToRows / rowsToState：含 uid 與關聯 uid', () => {
  const rows = Db.stateToRows(stateWithUids());
  assert.strictEqual(rows.semesters[0].uid, U.t1);
  const back = Db.rowsToState(rows);
  assert.strictEqual(back.terms[0].uid, U.t1);
  assert.strictEqual(back.courses[0].termUid, U.t1);
  assert.strictEqual(back.assessments[0].courseUid, U.c1);
});

test('mergeStates：相同 uid 不重複；不同 uid 同本地 id 會重映射', () => {
  const m1 = Db.mergeStates(stateWithUids(), stateWithUids());
  assert.strictEqual(m1.terms.length, 1);
  assert.strictEqual(m1.courses.length, 1);
  assert.strictEqual(m1.assessments.length, 1);

  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t2, name: 'L', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c2, termId: 1, termUid: U.t2, title: 'LC', credits: 3 }],
    assessments: [{ id: 1, uid: U.a2, courseId: 1, courseUid: U.c2, name: 'LA', assessmentGroup: 'CA', weightPercent: 100 }]
  };
  const m2 = Db.mergeStates(stateWithUids(), local);
  assert.strictEqual(m2.terms.length, 2);
  assert.strictEqual(m2.courses.length, 2);
  const byUid = {};
  m2.courses.forEach(c => { byUid[c.uid] = c; });
  m2.assessments.forEach(a => { assert.strictEqual(byUid[a.courseUid].id, a.courseId); });
});

test('mergeStates：孤兒被丟棄並回報', () => {
  const m = Db.mergeStates({ version: 1, terms: [], courses: [], assessments: [] },
    { version: 1, terms: [], courses: stateWithUids().courses, assessments: stateWithUids().assessments });
  assert.strictEqual(m.courses.length, 0);
  assert.strictEqual(m.assessments.length, 0);
  assert.strictEqual(m.orphans.courses, 1);
  assert.strictEqual(m.orphans.assessments, 1);
});

test('reconcileLocalUids：untrusted + 相同 id + 相同內容 → 仍不自動採用（交人工確認）', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t2, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c2, termId: 1, termUid: U.t2, code: 'X', title: 'C1', credits: 3 }],
    assessments: []
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true });
  assert.strictEqual(rec.state.courses[0].uid, U.c2);      // 未自動採用
  assert.ok(rec.ambiguous.length >= 1);
  const merged = Db.mergeStates(cloud, rec.state);
  assert.strictEqual(merged.courses.length, 2);            // 未確認 → 保留兩筆
});

test('reconcileLocalUids：untrusted + 人工確認同一筆 → 採用雲端 uid，合併 1 筆', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t2, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c2, termId: 1, termUid: U.t2, code: 'X', title: 'C1', credits: 3 }],
    assessments: []
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true, decisions: { 'term:1': 'cloud', 'course:1': 'cloud' } });
  assert.strictEqual(rec.ambiguous.length, 0);
  assert.strictEqual(rec.state.courses[0].uid, cloud.courses[0].uid);
  const merged = Db.mergeStates(cloud, rec.state);
  assert.strictEqual(merged.courses.length, 1);
});

test('reconcileLocalUids：untrusted + 相同 id 但科目內容不同 → 不自動對帳', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c2, termId: 1, termUid: U.t1, title: '完全不同科目', credits: 3 }],
    assessments: []
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true });
  assert.strictEqual(rec.state.courses[0].uid, U.c2);
  assert.strictEqual(rec.ambiguous.length, 1);
  assert.strictEqual(rec.ambiguous[0].kind, 'course');
  const merged = Db.mergeStates(cloud, rec.state);
  assert.strictEqual(merged.courses.length, 2);
});

test('reconcileLocalUids：相同名稱 + 相同權重但不同評核 → 不合併', () => {
  const cloud = {
    version: 1,
    terms: [{ id: 1, uid: U.t1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c1, termId: 1, termUid: U.t1, code: 'X', title: 'C1', credits: 3 }],
    assessments: [{ id: 1, uid: U.a1, courseId: 1, courseUid: U.c1, name: 'Quiz', assessmentGroup: 'CA', weightPercent: 30, maxPoints: 100, earnedPoints: 50 }]
  };
  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c1, termId: 1, termUid: U.t1, code: 'X', title: 'C1', credits: 3 }],
    assessments: [{ id: 1, uid: U.a2, courseId: 1, courseUid: U.c1, name: 'Quiz', assessmentGroup: 'CA', weightPercent: 30, maxPoints: 20, earnedPoints: 10 }]
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true });
  assert.strictEqual(rec.ambiguous.length, 1);
  assert.strictEqual(rec.ambiguous[0].kind, 'assessment');
  const merged = Db.mergeStates(cloud, rec.state);
  assert.strictEqual(merged.assessments.length, 2); // 不被錯併
});

test('reconcileLocalUids：uid 相同 → 視為同一筆（可靠身份）', () => {
  const cloud = stateWithUids();
  const local = stateWithUids();
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true });
  assert.strictEqual(rec.ambiguous.length, 0);
  assert.strictEqual(rec.state.terms[0].uid, cloud.terms[0].uid);
});

test('reconcileLocalUids：已信任 uid 但不同 → 不同筆（不列 ambiguous）', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 1, uid: U.t2, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, uid: U.c2, termId: 1, termUid: U.t2, code: 'X', title: 'C1', credits: 3 }],
    assessments: []
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: false });
  assert.strictEqual(rec.ambiguous.length, 0);
  assert.strictEqual(rec.state.courses[0].uid, U.c2);
  const merged = Db.mergeStates(cloud, rec.state);
  assert.strictEqual(merged.courses.length, 2);
});

test('reconcileLocalUids：不同 local_id 不互相對帳', () => {
  const cloud = stateWithUids();
  const local = {
    version: 1,
    terms: [{ id: 9, uid: U.t2, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 9, uid: U.c2, termId: 9, termUid: U.t2, title: 'C1', credits: 3 }],
    assessments: []
  };
  const rec = Db.reconcileLocalUids(local, cloud, { untrusted: true });
  assert.strictEqual(rec.state.courses[0].uid, U.c2);
  assert.strictEqual(rec.ambiguous.length, 0);
});

test('persistCloud：expected revision 必填 → null 立即 REVISION_UNKNOWN（不發 RPC）', async () => {
  const client = makeClient({ writeData: { ok: true, revision: 7 } });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: null }); }
  catch (e) { caught = e; }
  assert.ok(caught);
  assert.strictEqual(caught.code, 'REVISION_UNKNOWN');
  assert.strictEqual(client.calls.length, 0);
});

test('persistCloud：成功需 ok===true 且 revision 合法', async () => {
  const client = makeClient({ writeData: { ok: true, revision: 7 } });
  const res = await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 });
  assert.strictEqual(res.revision, 7);
  assert.strictEqual(client.calls[0].name, 'gpa_replace_snapshot');
  assert.strictEqual(client.calls[0].params.p_expected_revision, 6);
});

test('persistCloud：回應缺 ok / revision → RPC_INVALID_RESPONSE', async () => {
  for (const bad of [{ revision: 3 }, { ok: true }, { ok: 'true', revision: 3 }, null]) {
    const client = makeClient({ writeData: bad });
    let caught = null;
    try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 }); }
    catch (e) { caught = e; }
    assert.strictEqual(caught && caught.code, 'RPC_INVALID_RESPONSE', 'bad=' + JSON.stringify(bad));
  }
});

test('persistCloud：revision 衝突 → REVISION_CONFLICT', async () => {
  const client = makeClient({ writeData: { ok: false, conflict: true, current_revision: 9 } });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 }); }
  catch (e) { caught = e; }
  assert.strictEqual(caught.code, 'REVISION_CONFLICT');
  assert.strictEqual(caught.currentRevision, 9);
});

test('persistCloud：網絡中斷（reject）→ 拋出錯誤', async () => {
  const client = makeClient({ reject: new Error('network down') });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 }); }
  catch (e) { caught = e; }
  assert.ok(caught);
  assert.strictEqual(caught.message, 'network down');
});

test('persistCloud：缺少 migration → MIGRATION_REQUIRED', async () => {
  const client = makeClient({ writeError: { message: 'function public.gpa_replace_snapshot(jsonb, jsonb, jsonb, bigint) does not exist' } });
  let caught = null;
  try { await Db._persistCloud(stateWithUids(), { client, userId: 'u1', expectedRevision: 6 }); }
  catch (e) { caught = e; }
  assert.strictEqual(caught.code, 'MIGRATION_REQUIRED');
});

test('loadCloud：回傳 state / revision / revisionKnown', async () => {
  const client = makeClient({ readData: {
    has_state: true, revision: 5,
    semesters: [{ local_id: 1, uid: U.t1, name: 'S1', sort_order: 1 }],
    courses: [{ local_id: 1, uid: U.c1, semester_local_id: 1, title: 'C1', credits: 3, gpa_inclusion: 'include' }],
    assessments: []
  } });
  const m = await Db._loadCloud({ client, userId: 'u1' });
  assert.strictEqual(m.revision, 5);
  assert.strictEqual(m.revisionKnown, true);
  assert.strictEqual(m.state.courses.length, 1);
});

test('loadCloud：有資料但無 state 列 → revisionKnown=false（禁止覆蓋）', async () => {
  const client = makeClient({ readData: {
    has_state: false, revision: 0,
    semesters: [{ local_id: 1, uid: U.t1, name: 'S1', sort_order: 1 }],
    courses: [], assessments: []
  } });
  const m = await Db._loadCloud({ client, userId: 'u1' });
  assert.strictEqual(m.revisionKnown, false);
  assert.strictEqual(m.revision, null);
});

test('loadCloud：全新空白 → revision 0、revisionKnown=true', async () => {
  const client = makeClient({ readData: { has_state: false, revision: 0, semesters: [], courses: [], assessments: [] } });
  const m = await Db._loadCloud({ client, userId: 'u1' });
  assert.strictEqual(m.revision, 0);
  assert.strictEqual(m.revisionKnown, true);
});

test('loadCloud：回應格式異常 → RPC_INVALID_RESPONSE', async () => {
  const client = makeClient({ readData: { has_state: true } });
  let caught = null;
  try { await Db._loadCloud({ client, userId: 'u1' }); }
  catch (e) { caught = e; }
  assert.strictEqual(caught.code, 'RPC_INVALID_RESPONSE');
});

test('訪客模式：未登入時 isCloud=false', () => {
  assert.strictEqual(Db.isCloud(), false);
});
