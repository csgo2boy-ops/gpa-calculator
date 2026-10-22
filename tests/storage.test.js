'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const Storage = require('../public/storage.js');

beforeEach(() => { Storage.clear(); Storage.clearBackups(); });

test('預設為空白（不再內建任何課程）', () => {
  const state = Storage.load();
  assert.strictEqual(state.terms.length, 0);
  assert.strictEqual(state.courses.length, 0);
  assert.strictEqual(state.assessments.length, 0);
});

test('ensureUids：補 uid 並建立關聯 uid（舊資料相容、冪等）', () => {
  const s = Storage.ensureUids({
    version: 1,
    terms: [{ id: 1, name: 'S1', sortOrder: 1 }],
    courses: [{ id: 1, termId: 1, title: 'C1', credits: 3 }],
    assessments: [{ id: 1, courseId: 1, name: 'A1', assessmentGroup: 'CA', weightPercent: 100, maxPoints: 100, earnedPoints: 50 }]
  });
  assert.ok(s.terms[0].uid);
  assert.ok(s.courses[0].uid);
  assert.strictEqual(s.courses[0].termUid, s.terms[0].uid);
  assert.strictEqual(s.assessments[0].courseUid, s.courses[0].uid);
  const s2 = Storage.ensureUids(s);
  assert.strictEqual(s2.terms[0].uid, s.terms[0].uid);
});

test('save / load 往返（含中文與 null）', () => {
  const state = Storage.load();
  state.terms.push({ id: 1, uid: Storage.genUid(), name: '上學期', sortOrder: 1 });
  state.courses.push({ id: 1, uid: Storage.genUid(), termId: 1, termUid: state.terms[0].uid, code: 'X', title: '測試科目', credits: 3, gpaInclusion: 'include', officialMark: 88, officialGP: 4, crossSemesterPolicy: 'single', targetGrade: 'A' });
  state.assessments.push({ id: 1, uid: Storage.genUid(), courseId: 1, courseUid: state.courses[0].uid, name: '小測', assessmentGroup: 'CA', weightPercent: 30, maxPoints: 100, earnedPoints: null });
  assert.strictEqual(Storage.save(state), true);
  const r = Storage.load();
  assert.strictEqual(r.terms.length, 1);
  assert.strictEqual(r.courses[0].title, '測試科目');
  assert.strictEqual(r.assessments[0].earnedPoints, null);
  assert.ok(r.terms[0].uid);
});

test('多版本備份：保留多份、時間戳、可個別還原', () => {
  const s1 = { version: 1, terms: [{ id: 1, name: 'v1', sortOrder: 1 }], courses: [], assessments: [] };
  const s2 = { version: 1, terms: [{ id: 1, name: 'v2', sortOrder: 1 }], courses: [], assessments: [] };
  assert.strictEqual(Storage.saveBackup(s1, 'first').ok, true);
  assert.strictEqual(Storage.saveBackup(s2, 'second').ok, true);
  const list = Storage.listBackups();
  assert.strictEqual(list.length, 2);
  assert.ok(list[0].savedAt && list[1].savedAt);
  assert.strictEqual(Storage.loadBackup(0).state.terms[0].name, 'v2');
  assert.strictEqual(Storage.loadBackup(1).state.terms[0].name, 'v1');
  assert.strictEqual(Storage.loadBackup(0).reason, 'second');
});

test('備份上限 5 份（最舊被淘汰）', () => {
  for (let i = 0; i < 8; i++) Storage.saveBackup({ version: 1, terms: [{ id: 1, name: 'v' + i, sortOrder: 1 }], courses: [], assessments: [] }, 'r' + i);
  assert.strictEqual(Storage.listBackups().length, Storage.MAX_BACKUPS);
  assert.strictEqual(Storage.loadBackup(0).state.terms[0].name, 'v7');
});

test('saveBackup：localStorage 空間不足時回報失敗（不假裝成功）', () => {
  const original = global.localStorage;
  global.localStorage = {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem() { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
    removeItem(k) { delete this.store[k]; }
  };
  try {
    const r = Storage.saveBackup({ version: 1, terms: [], courses: [], assessments: [] }, 'test');
    assert.strictEqual(r.ok, false);
    assert.ok(/空間不足/.test(r.error));
  } finally {
    if (original === undefined) delete global.localStorage; else global.localStorage = original;
  }
});

test('exportJson / importJson 往返一致', () => {
  const state = Storage.load();
  state.terms.push({ id: 1, uid: Storage.genUid(), name: 'S1', sortOrder: 1 });
  const exported = Storage.exportJson(state);
  assert.ok(exported.exportedAt);
  const result = Storage.importJson(exported);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.terms.length, 1);
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
});
