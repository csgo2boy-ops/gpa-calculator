/* =========================================================================
 * storage.js — 瀏覽器 localStorage 持久化模組（2.0 Batch 1.1）
 *
 * 新增：
 *  - 每個實體（學期/科目/評核）都有穩定 uid（跨裝置識別，用於安全合併）
 *  - ensureUids()：為舊資料補上 uid 與關聯 uid（termUid / courseUid），純函式
 *  - 多版本備份（最多 5 份，含時間戳與原因），並在 localStorage 空間不足時回報失敗
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaStorage = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var STORAGE_KEY = 'gpa-tracker-data';
  var BACKUPS_KEY = 'gpa-tracker-backups';
  var MAX_BACKUPS = 5;
  var SCHEMA_VERSION = 1;

  function getSeed() {
    if (typeof root !== 'undefined' && root.GpaSeed) return root.GpaSeed;
    if (typeof require === 'function') {
      try { return require('./seed-data.js'); } catch (e) { /* ignore */ }
    }
    return null;
  }

  var memory = null;
  var memoryBackups = [];
  function backend() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* ignore */ }
    return null;
  }

  function clone(data) { return JSON.parse(JSON.stringify(data)); }

  // ---------- 穩定 uid（合法 UUID v4）----------
  function isUuid(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }

  function genUid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        var id = crypto.randomUUID();
        if (isUuid(id)) return id;
      }
    } catch (e) { /* ignore */ }
    var b = [];
    for (var i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = '';
    for (var j = 0; j < 16; j++) hex += ('0' + b[j].toString(16)).slice(-2);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  // 為每個實體補上 uid，並由整數關聯推導 termUid / courseUid（舊資料相容）。純函式。
  function ensureUids(state) {
    var src = state || {};
    var terms = (src.terms || []).map(function (t) {
      return Object.assign({}, t, { uid: isUuid(t.uid) ? t.uid : genUid() });
    });
    var termById = {};
    terms.forEach(function (t) { termById[t.id] = t; });

    var courses = (src.courses || []).map(function (c) {
      var termUid = isUuid(c.termUid) ? c.termUid : (termById[c.termId] ? termById[c.termId].uid : null);
      return Object.assign({}, c, { uid: isUuid(c.uid) ? c.uid : genUid(), termUid: termUid });
    });
    var courseById = {};
    courses.forEach(function (c) { courseById[c.id] = c; });

    var assessments = (src.assessments || []).map(function (a) {
      var courseUid = isUuid(a.courseUid) ? a.courseUid : (courseById[a.courseId] ? courseById[a.courseId].uid : null);
      return Object.assign({}, a, { uid: isUuid(a.uid) ? a.uid : genUid(), courseUid: courseUid });
    });

    return { version: SCHEMA_VERSION, terms: terms, courses: courses, assessments: assessments };
  }

  function needsUidBackfill(state) {
    var arrs = [(state && state.terms), (state && state.courses), (state && state.assessments)];
    for (var i = 0; i < arrs.length; i++) {
      var a = arrs[i] || [];
      for (var j = 0; j < a.length; j++) { if (!isUuid(a[j].uid)) return true; }
    }
    return false;
  }

  var loadMeta = { uidsBackfilled: false, persistOk: true };
  function getLoadMeta() { return { uidsBackfilled: loadMeta.uidsBackfilled, persistOk: loadMeta.persistOk }; }

  function emptyState() {
    var seed = getSeed();
    var terms = seed ? clone(seed.terms) : [];
    var courses = seed ? clone(seed.courses) : [];
    var assessments = seed ? clone(seed.assessments) : [];
    return ensureUids({ version: SCHEMA_VERSION, terms: terms, courses: courses, assessments: assessments });
  }

  function template() {
    var seed = getSeed();
    if (seed && seed.template) return clone(seed.template);
    return { terms: [], courses: [], assessments: [] };
  }

  // ---------- 多版本備份 ----------
  // 回傳 { ok:true, count } 或 { ok:false, error }；空間不足不會假裝成功。
  function saveBackup(state, reason) {
    var store = backend();
    var entry = { savedAt: new Date().toISOString(), reason: reason || 'manual', state: clone(state) };
    if (!store) {
      memoryBackups.unshift(entry);
      memoryBackups = memoryBackups.slice(0, MAX_BACKUPS);
      return { ok: true, count: memoryBackups.length };
    }
    var list = [];
    try {
      var raw = store.getItem(BACKUPS_KEY);
      if (raw) { var parsed = JSON.parse(raw); if (Array.isArray(parsed)) list = parsed; }
    } catch (e) { list = []; }
    list.unshift(entry);
    list = list.slice(0, MAX_BACKUPS);
    try {
      store.setItem(BACKUPS_KEY, JSON.stringify(list));
      return { ok: true, count: list.length };
    } catch (e) {
      var quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
      return { ok: false, error: quota ? '本機儲存空間不足，備份未建立' : ('備份失敗：' + (e && e.message ? e.message : String(e))) };
    }
  }

  function readBackups() {
    var store = backend();
    if (store) {
      try {
        var raw = store.getItem(BACKUPS_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) { return []; }
    }
    return memoryBackups.slice();
  }

  // 只回傳中繼資料（供 UI 列表），不含完整 state
  function listBackups() {
    return readBackups().map(function (b, i) {
      return {
        index: i,
        savedAt: b.savedAt,
        reason: b.reason,
        terms: (b.state && b.state.terms || []).length,
        courses: (b.state && b.state.courses || []).length,
        assessments: (b.state && b.state.assessments || []).length
      };
    });
  }

  function loadBackup(index) {
    var list = readBackups();
    var i = (typeof index === 'number' && index >= 0 && index < list.length) ? index : 0;
    var b = list[i];
    if (!b || !b.state) return null;
    return { savedAt: b.savedAt, reason: b.reason, state: ensureUids(b.state) };
  }

  function clearBackups() {
    var store = backend();
    if (store) { try { store.removeItem(BACKUPS_KEY); } catch (e) { /* ignore */ } }
    memoryBackups = [];
  }

  // ---------- 驗證 ----------
  function normalize(data) {
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.terms) || !Array.isArray(data.courses) || !Array.isArray(data.assessments)) return null;
    return ensureUids({ version: SCHEMA_VERSION, terms: data.terms, courses: data.courses, assessments: data.assessments });
  }

  // ---------- 讀寫 ----------
  function load() {
    loadMeta = { uidsBackfilled: false, persistOk: true };
    var store = backend();
    if (store) {
      var raw = null;
      try { raw = store.getItem(STORAGE_KEY); } catch (e) { raw = null; }
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          var backfilled = needsUidBackfill(parsed);
          var norm = normalize(parsed);
          if (norm) {
            loadMeta.uidsBackfilled = backfilled;
            if (backfilled) {
              // 立即持久化補齊的 uid，確保重新整理 / 關閉瀏覽器 / 重登後 uid 不變
              try { store.setItem(STORAGE_KEY, JSON.stringify(norm)); }
              catch (e) { loadMeta.persistOk = false; }
            }
            return norm;
          }
        } catch (e) { /* 損毀則回種子 */ }
      }
    } else if (memory) {
      return ensureUids(memory);
    }
    return emptyState();
  }

  function save(state) {
    var store = backend();
    var serialized = JSON.stringify(state);
    if (store) {
      try { store.setItem(STORAGE_KEY, serialized); return true; }
      catch (e) { return false; }
    }
    memory = JSON.parse(serialized);
    return true;
  }

  function clear() {
    var store = backend();
    if (store) { try { store.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ } }
    memory = null;
  }

  function exportJson(state) {
    return {
      exportedAt: new Date().toISOString(),
      version: SCHEMA_VERSION,
      terms: clone(state.terms),
      courses: clone(state.courses),
      assessments: clone(state.assessments)
    };
  }

  function importJson(data) {
    var norm = normalize(data);
    if (!norm) return { ok: false, error: '備份格式無效：需包含 terms / courses / assessments 陣列。' };
    return { ok: true, state: norm };
  }

  function nextId(items) {
    var max = 0;
    (items || []).forEach(function (it) { if (typeof it.id === 'number' && it.id > max) max = it.id; });
    return max + 1;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    BACKUPS_KEY: BACKUPS_KEY,
    MAX_BACKUPS: MAX_BACKUPS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    genUid: genUid,
    isUuid: isUuid,
    ensureUids: ensureUids,
    getLoadMeta: getLoadMeta,
    load: load,
    save: save,
    clear: clear,
    exportJson: exportJson,
    importJson: importJson,
    nextId: nextId,
    template: template,
    saveBackup: saveBackup,
    listBackups: listBackups,
    loadBackup: loadBackup,
    clearBackups: clearBackups
  };
});
