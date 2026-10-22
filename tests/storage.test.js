'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// Node 環境沒有 localStorage，storage.js 會自動退回記憶體後備。
const Storage = require('../public/storage.js');

beforeEach(() => Storage.clear());

test('預設為空白（不再內建任何課程）', () => {
  const state = Storage.load();
  assert.strictEqual(state.terms.length, 0);
  assert.strictEqual(state.courses.length, 0);
  assert.strictEqual(state.assessments.length, 0);
  assert.strictEqual(state.version, Storage.SCHEMA_VERSION);
});

test('手動新增後 save 再 load 可還原（含中文與 null）', () => {
  const state = Storage.load();
  state.terms.push({ id: 1, name: '上學期', sortOrder: 1 });
  state.courses.push({ id: 1, termId: 1, code: 'X', title: '測試科目', credits: 3, gpaInclusion: 'include', officialMark: 88, officialGP: 4, crossSemesterPolicy: 'single', targetGrade: 'A' });
  state.assessments.push({ id: 1, courseId: 1, name: '小測', assessmentGroup: 'CA', weightPercent: 30, maxPoints: 100, earnedPoints: null });
  assert.strictEqual(Storage.save(state), true);
  const r = Storage.load();
  assert.strictEqual(r.terms.length, 1);
  assert.strictEqual(r.courses.length, 1);
  assert.strictEqual(r.courses[0].title, '測試科目');
  assert.strictEqual(r.courses[0].officialMark, 88);
  assert.strictEqual(r.assessments[0].maxPoints, 100);
  assert.strictEqual(r.assessments[0].earnedPoints, null);
});

test('exportJson / importJson 往返一致', () => {
  const state = Storage.load();
  state.terms.push({ id: 1, name: 'S1', sortOrder: 1 });
  const exported = Storage.exportJson(state);
  assert.ok(exported.exportedAt);
  const result = Storage.importJson(exported);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.state.terms, state.terms);
});

test('importJson 拒絕無效格式', () => {
  assert.strictEqual(Storage.importJson({ foo: 1 }).ok, false);
  assert.strictEqual(Storage.importJson(null).ok, false);
  assert.strictEqual(Storage.importJson({ terms: [], courses: [], assessments: 'x' }).ok, false);
});

test('nextId 從空集合回傳 1，並取最大 id + 1', () => {
  assert.strictEqual(Storage.nextId([]), 1);
  assert.strictEqual(Storage.nextId([{ id: 3 }, { id: 7 }]), 8);
});

test('IT114105 範本可取得（5 學期 / 34 課程 / 5 評核）', () => {
  const tpl = Storage.template();
  assert.strictEqual(tpl.terms.length, 5);
  assert.strictEqual(tpl.courses.length, 34);
  assert.strictEqual(tpl.assessments.length, 5);
  assert.strictEqual(tpl.courses[0].code, 'ITP3914');
  // 每次取得都是獨立副本（避免污染種子）
  tpl.courses.pop();
  assert.strictEqual(Storage.template().courses.length, 34);
});
