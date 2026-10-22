/* =========================================================================
 * storage.js
 * 瀏覽器 localStorage 持久化模組。
 * 負責：讀取、儲存、匯出、匯入、格式防呆與自動種子資料初始化。
 * 可在瀏覽器（window.GpaStorage）與 Node.js（module.exports，配合記憶體後備）執行。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaStorage = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var STORAGE_KEY = 'gpa-tracker-data';
  var SCHEMA_VERSION = 1;

  // --- 種子資料取得（瀏覽器用全域 GpaSeed；Node 用 require） ---
  function getSeed() {
    if (typeof root !== 'undefined' && root.GpaSeed) return root.GpaSeed;
    if (typeof require === 'function') {
      try { return require('./seed-data.js'); } catch (e) { /* ignore */ }
    }
    return null;
  }

  // --- 儲存後端（瀏覽器用 localStorage，否則回傳 null 走記憶體） ---
  var memory = null;
  function backend() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* ignore */ }
    return null;
  }

  function clone(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function emptyState() {
    var seed = getSeed();
    var terms = seed ? clone(seed.terms) : [];
    var courses = seed ? clone(seed.courses) : [];
    var assessments = seed ? clone(seed.assessments) : [];
    return { version: SCHEMA_VERSION, terms: terms, courses: courses, assessments: assessments };
  }

  // 驗證並正規化外來資料形狀；無效回傳 null
  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.terms) || !Array.isArray(data.courses) || !Array.isArray(data.assessments)) return null;
    return {
      version: SCHEMA_VERSION,
      terms: data.terms,
      courses: data.courses,
      assessments: data.assessments
    };
  }

  // 從 localStorage（或記憶體後備）讀取狀態；無效或不存在則回種子資料
  function load() {
    var store = backend();
    if (store) {
      var raw = null;
      try { raw = store.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          var norm = normalize(parsed);
          if (norm) return norm;
        } catch (e) { /* 損毀則回種子 */ }
      }
    }
    if (memory) return memory;
    return emptyState();
  }

  // 寫入狀態；回傳是否成功
  function save(state) {
    var store = backend();
    var serialized = JSON.stringify(state);
    if (store) {
      try { store.setItem(STORAGE_KEY, serialized); return true; }
      catch (e) { return false; }
    }
    memory = JSON.parse(serialized); // Node 測試用記憶體後備
    return true;
  }

  // 清除儲存（回到種子資料）
  function clear() {
    var store = backend();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
    memory = null;
  }

  // 匯出成可攜帶的備份物件（不含 version 以外的多餘欄位）
  function exportJson(state) {
    return {
      exportedAt: new Date().toISOString(),
      version: SCHEMA_VERSION,
      terms: clone(state.terms),
      courses: clone(state.courses),
      assessments: clone(state.assessments)
    };
  }

  // 匯入備份：接受 {terms, courses, assessments} 或含此三欄的外層包裝
  function importJson(data) {
    var norm = normalize(data);
    if (!norm) return { ok: false, error: '備份格式無效：需包含 terms / courses / assessments 陣列。' };
    return { ok: true, state: { version: SCHEMA_VERSION, terms: norm.terms, courses: norm.courses, assessments: norm.assessments } };
  }

  // 產生下一個可用 id（給新增評核用）
  function nextId(items) {
    var max = 0;
    items.forEach(function (it) { if (typeof it.id === 'number' && it.id > max) max = it.id; });
    return max + 1;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    load: load,
    save: save,
    clear: clear,
    exportJson: exportJson,
    importJson: importJson,
    nextId: nextId
  };
});
