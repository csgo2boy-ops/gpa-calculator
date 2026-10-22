'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

// Node 環境沒有 localStorage，storage.js 會自動退回記憶體後備。
const Storage = require('../public/storage.js');
const Seed = require('../public/seed-data.js');

beforeEach(() => Storage.clear());

test('種子資料完整（5 學期 / 34 課程 / 5 評核）', () => {
  const state = Storage.load();
  assert.strictEqual(state.terms.length, 5);
  assert.strictEqual(state.courses.length, 34);
  assert.strictEqual(state.assessments.length, 5);
  assert.strictEqual(state.version, Storage.SCHEMA_VERSION);
});

test('load 時若無資料會回種子（非空）', () => {
  Storage.clear();
  const state = Storage.load();
  assert.strictEqual(state.courses.length, 34);
  assert.strictEqual(state.courses[0].code, 'ITP3914');
});

test('save 後 load 可還原（含中文與 null）', () => {
  const state = Storage.load();
  state.assessments.push({ id: 999, courseId: 2, name: '小測', assessmentGroup: 'CA', weightPercent: 10, maxPoints: null, earnedPoints: null });
  state.courses[0].officialMark = 88;
  assert.strictEqual(Storage.save(state), true);
  const reloaded = Storage.load();
  assert.strictEqual(reloaded.assessments.length, 6);
  assert.strictEqual(reloaded.courses[0].officialMark, 88);
  const last = reloaded.assessments.find((x) => x.id === 999);
  assert.strictEqual(last.name, '小測');
  assert.strictEqual(last.maxPoints, null);
});

test('exportJson / importJson 往返一致', () => {
  const state = Storage.load();
  const exported = Storage.exportJson(state);
  assert.ok(exported.exportedAt);
  const result = Storage.importJson(exported);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.courses.length, 34);
  assert.strictEqual(result.state.assessments.length, 5);
});

test('importJson 拒絕無效格式', () => {
  assert.strictEqual(Storage.importJson({ foo: 1 }).ok, false);
  assert.strictEqual(Storage.importJson(null).ok, false);
  assert.strictEqual(Storage.importJson({ terms: [], courses: [], assessments: 'x' }).ok, false);
});

test('nextId 遞增', () => {
  const state = Storage.load();
  const id = Storage.nextId(state.assessments);
  assert.strictEqual(id, 6);
});

test('種子 crossSemesterPolicy 正規化（8 needs-review / 26 single）', () => {
  const state = Storage.load();
  const needs = state.courses.filter((c) => c.gpaInclusion === 'needs-review').length;
  const single = state.courses.filter((c) => c.crossSemesterPolicy === 'single').length;
  assert.strictEqual(needs, 8);
  assert.strictEqual(single, 26);
});
