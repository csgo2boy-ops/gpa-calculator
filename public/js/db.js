/* =====================================================================
 * db.js — 雙模資料層（雲端 Supabase vs 訪客 localStorage）
 *
 * - 已登入（Auth.isLoggedIn()）：呼叫 Supabase 做雲端增刪查改。
 * - 未登入（訪客）：回退至 localStorage（GpaStorage）。
 *
 * 純函式 stateToRows / rowsToState 負責「前端狀態 ↔ 資料表列」的對映，
 * 可在 Node.js 測試環境直接驗證，無需真實 Supabase。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaDb = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Auth = (root && root.GpaAuth) || (typeof require === 'function' ? require('./auth.js') : null);
  var Storage = (root && root.GpaStorage) || (typeof require === 'function' ? require('../storage.js') : null);
  var Seed = (root && root.GpaSeed) || (typeof require === 'function' ? require('../seed-data.js') : null);

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- 純函式：前端狀態 ↔ 資料表列 ----------
  function stateToRows(state) {
    var semesters = (state.terms || []).map(function (t) {
      return { local_id: t.id, name: t.name, sort_order: t.sortOrder };
    });
    var courses = (state.courses || []).map(function (c) {
      return {
        local_id: c.id, semester_local_id: c.termId, code: c.code, title: c.title,
        credits: c.credits, gpa_inclusion: c.gpaInclusion, official_mark: c.officialMark,
        official_gp: c.officialGP, cross_semester_policy: c.crossSemesterPolicy, target_grade: c.targetGrade
      };
    });
    var assessments = (state.assessments || []).map(function (a) {
      return {
        local_id: a.id, course_local_id: a.courseId, name: a.name, assessment_group: a.assessmentGroup,
        weight_percent: a.weightPercent, max_points: a.maxPoints, earned_points: a.earnedPoints
      };
    });
    return { semesters: semesters, courses: courses, assessments: assessments };
  }

  function rowsToState(rows) {
    var terms = (rows.semesters || []).map(function (s) {
      return { id: s.local_id, name: s.name, sortOrder: s.sort_order };
    });
    var courses = (rows.courses || []).map(function (c) {
      return {
        id: c.local_id, termId: c.semester_local_id, code: c.code, title: c.title, credits: c.credits,
        gpaInclusion: c.gpa_inclusion, officialMark: c.official_mark, officialGP: c.official_gp,
        crossSemesterPolicy: c.cross_semester_policy, targetGrade: c.target_grade
      };
    });
    var assessments = (rows.assessments || []).map(function (a) {
      return {
        id: a.local_id, courseId: a.course_local_id, name: a.name, assessmentGroup: a.assessment_group,
        weightPercent: a.weight_percent, maxPoints: a.max_points, earnedPoints: a.earned_points
      };
    });
    return { version: 1, terms: terms, courses: courses, assessments: assessments };
  }

  function seedState() {
    return {
      version: 1,
      terms: clone(Seed.terms),
      courses: clone(Seed.courses),
      assessments: clone(Seed.assessments)
    };
  }

  // ---------- 訪客（localStorage）----------
  function readLocalState() { return Storage.load(); }

  function hasLocalData() {
    try {
      if (typeof localStorage === 'undefined') return false;
      var raw = localStorage.getItem(Storage.STORAGE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.courses) && parsed.courses.length > 0;
    } catch (e) { return false; }
  }

  // ---------- 雲端 ----------
  function isCloud() { return !!(Auth && Auth.isAvailable() && Auth.isLoggedIn()); }

  async function loadCloud() {
    var client = Auth.getClient();
    var userId = Auth.getUser().id;
    var res = await Promise.all([
      client.from('semesters').select('*').eq('user_id', userId),
      client.from('courses').select('*').eq('user_id', userId),
      client.from('assessments').select('*').eq('user_id', userId)
    ]);
    var sem = res[0], cou = res[1], ass = res[2];
    if (sem.error || cou.error || ass.error) {
      throw new Error(((sem.error || cou.error || ass.error).message));
    }
    var s = sem.data || [], c = cou.data || [], a = ass.data || [];
    if (s.length === 0 && c.length === 0 && a.length === 0) {
      // 首次登入：雲端尚無資料，先以課程結構種子作為起始（待首次變更時才寫入雲端）
      return seedState();
    }
    return rowsToState({ semesters: s, courses: c, assessments: a });
  }

  async function persistCloud(state) {
    var client = Auth.getClient();
    var userId = Auth.getUser().id;
    var rows = stateToRows(state);

    // 簡易「全量快照」策略：先刪後寫。資料量小（< 100 列），最穩健且能正確處理刪除。
    var d3 = await client.from('assessments').delete().eq('user_id', userId);
    var d2 = await client.from('courses').delete().eq('user_id', userId);
    var d1 = await client.from('semesters').delete().eq('user_id', userId);
    if (d1.error) throw d1.error;
    if (d2.error) throw d2.error;
    if (d3.error) throw d3.error;

    if (rows.semesters.length) {
      var i1 = await client.from('semesters').insert(rows.semesters);
      if (i1.error) throw i1.error;
    }
    if (rows.courses.length) {
      var i2 = await client.from('courses').insert(rows.courses);
      if (i2.error) throw i2.error;
    }
    if (rows.assessments.length) {
      var i3 = await client.from('assessments').insert(rows.assessments);
      if (i3.error) throw i3.error;
    }
  }

  // ---------- 統一介面 ----------
  async function loadState() {
    if (isCloud()) return await loadCloud();
    return readLocalState();
  }

  async function persist(state) {
    if (isCloud()) return await persistCloud(state);
    Storage.save(state);
  }

  async function syncLocalToCloud(localState) {
    return await persistCloud(localState);
  }

  return {
    isCloud: isCloud,
    loadState: loadState,
    persist: persist,
    hasLocalData: hasLocalData,
    readLocalState: readLocalState,
    syncLocalToCloud: syncLocalToCloud,
    stateToRows: stateToRows,
    rowsToState: rowsToState,
    seedState: seedState
  };
});
