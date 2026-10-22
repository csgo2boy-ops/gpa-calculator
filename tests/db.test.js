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

function makeMockClient(opts) {
  const ops = [];
  function builder(table) {
    return {
      upsert(rows, o) {
        ops.push({ op: 'upsert', table, count: rows.length, onConflict: o && o.onConflict });
        if (opts && opts.failUpsert === table) return Promise.resolve({ error: { message: 'upsert failed' } });
        return Promise.resolve({ error: null });
      },
      delete() {
        return {
          eq() {
            const q = {
              not(col, op, val) {
                ops.push({ op: 'delete-not', table, col, val });
                return Promise.resolve({ error: null });
              },
              then(res) { ops.push({ op: 'delete-all', table }); res({ error: null }); return null; }
            };
            return q;
          }
        };
      }
    };
  }
  return { from: builder, ops };
}

test('mergeStates：以 id 取聯集、不重複、雲端優先', () => {
  const cloud = { version: 1, terms: [{ id: 1, name: 'CloudTerm', sortOrder: 1 }], courses: [{ id: 1, termId: 1, title: 'CloudCourse', credits: 3 }], assessments: [] };
  const local = {
    version: 1,
    terms: [{ id: 1, name: 'LocalTerm' }, { id: 2, name: 'LocalTerm2' }],
    courses: [{ id: 1, termId: 1, title: 'LocalCourse', credits: 3 }, { id: 2, termId: 1, title: 'LocalCourse2', credits: 3 }],
    assessments: [{ id: 1, courseId: 1, name: 'A', assessmentGroup: 'CA', weightPercent: 50, maxPoints: 100, earnedPoints: 80 }]
  };
  const m = Db.mergeStates(cloud, local);
  assert.strictEqual(m.terms.length, 2);
  assert.strictEqual(m.courses.length, 2);
  assert.strictEqual(m.assessments.length, 1);
  assert.strictEqual(m.terms.find(t => t.id === 1).name, 'CloudTerm');
  assert.strictEqual(m.courses.find(c => c.id === 2).title, 'LocalCourse2');
});

test('persistCloud：先 upsert 再刪除多餘列（不先刪光）', async () => {
  const client = makeMockClient();
  const state = {
    version: 1,
    terms: [{ id: 1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, termId: 1, code: null, title: 'C1', credits: 3, gpaInclusion: 'include', officialMark: null, officialGP: null, crossSemesterPolicy: 'single', targetGrade: 'A' }],
    assessments: [{ id: 1, courseId: 1, name: 'A1', assessmentGroup: 'CA', weightPercent: 100, maxPoints: 100, earnedPoints: 50 }]
  };
  await Db._persistCloud(state, { client, userId: 'u1' });
  const ops = client.ops.map(o => o.op);
  const lastUpsert = ops.lastIndexOf('upsert');
  const firstDelete = ops.findIndex(o => o.indexOf('delete') === 0);
  assert.ok(lastUpsert >= 0 && firstDelete > lastUpsert, 'upsert 必須在 delete 之前');
  const dn = client.ops.find(o => o.op === 'delete-not');
  assert.ok(dn && dn.col === 'local_id', '刪除應使用 not-in 只刪多餘列');
});

test('persistCloud：upsert 失敗時丟出錯誤且不執行刪除', async () => {
  const client = makeMockClient({ failUpsert: 'courses' });
  const state = { version: 1, terms: [{ id: 1, name: 'S1', sortOrder: 1 }], courses: [{ id: 1, termId: 1, title: 'C1', credits: 3 }], assessments: [] };
  let threw = false;
  try { await Db._persistCloud(state, { client, userId: 'u1' }); } catch (e) { threw = true; }
  assert.strictEqual(threw, true);
  assert.strictEqual(client.ops.find(o => o.op.indexOf('delete') === 0), undefined, '失敗時不應執行刪除');
});

test('訪客模式：未登入時 isCloud=false，loadState 回傳空白', async () => {
  assert.strictEqual(Db.isCloud(), false);
  const state = await Db.loadState();
  assert.strictEqual(state.terms.length, 0);
  assert.strictEqual(state.courses.length, 0);
});
