/* =====================================================================
 * db.js — 雙模資料層（2.0 Batch 1.1）
 *
 * - 雲端寫入改走 Supabase RPC「gpa_replace_snapshot」：在單一資料庫交易內
 *   完成快照替換（必要時 migration 需先執行），並以 revision 做樂觀並發控制。
 * - 合併以穩定 uid（非本地數字 id）判斷同一筆資料，合併後重新映射關聯。
 * - 純函式 stateToRows / rowsToState / mergeStates 可在 Node 測試。
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.GpaDb = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Auth = (root && root.GpaAuth) || (typeof require === 'function' ? require('./auth.js') : null);
  var Storage = (root && root.GpaStorage) || (typeof require === 'function' ? require('../storage.js') : null);
  var Seed = (root && root.GpaSeed) || (typeof require === 'function' ? require('../seed-data.js') : null);

  var REV_PREFIX = 'gpa-tracker-rev:';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ensure(state) { return Storage.ensureUids(state); }

  // ---------- revision（樂觀並發控制，per-user）----------
  function getKnownRevision(userId) {
    try {
      if (typeof localStorage === 'undefined') return null;
      var raw = localStorage.getItem(REV_PREFIX + userId);
      if (raw == null) return null;
      var n = parseInt(raw, 10);
      return isFinite(n) ? n : null;
    } catch (e) { return null; }
  }
  function setKnownRevision(userId, rev) {
    try {
      if (typeof localStorage !== 'undefined' && rev != null) localStorage.setItem(REV_PREFIX + userId, String(rev));
    } catch (e) { /* ignore */ }
  }

  // ---------- 純函式：狀態 ↔ 資料列 ----------
  function stateToRows(state) {
    var s = ensure(state);
    var semesters = (s.terms || []).map(function (t) {
      return { local_id: t.id, uid: t.uid, name: t.name, sort_order: t.sortOrder };
    });
    var courses = (s.courses || []).map(function (c) {
      return {
        local_id: c.id, uid: c.uid, semester_local_id: c.termId, code: c.code, title: c.title,
        credits: c.credits, gpa_inclusion: c.gpaInclusion, official_mark: c.officialMark,
        official_gp: c.officialGP, cross_semester_policy: c.crossSemesterPolicy, target_grade: c.targetGrade
      };
    });
    var assessments = (s.assessments || []).map(function (a) {
      return {
        local_id: a.id, uid: a.uid, course_local_id: a.courseId, name: a.name, assessment_group: a.assessmentGroup,
        weight_percent: a.weightPercent, max_points: a.maxPoints, earned_points: a.earnedPoints
      };
    });
    return { semesters: semesters, courses: courses, assessments: assessments };
  }

  function rowsToState(rows) {
    var terms = (rows.semesters || []).map(function (s) {
      return { id: s.local_id, uid: s.uid, name: s.name, sortOrder: s.sort_order };
    });
    var termById = {};
    terms.forEach(function (t) { termById[t.id] = t; });
    var courses = (rows.courses || []).map(function (c) {
      return {
        id: c.local_id, uid: c.uid, termId: c.semester_local_id,
        termUid: termById[c.semester_local_id] ? termById[c.semester_local_id].uid : null,
        code: c.code, title: c.title, credits: c.credits, gpaInclusion: c.gpa_inclusion,
        officialMark: c.official_mark, officialGP: c.official_gp,
        crossSemesterPolicy: c.cross_semester_policy, targetGrade: c.target_grade
      };
    });
    var courseById = {};
    courses.forEach(function (c) { courseById[c.id] = c; });
    var assessments = (rows.assessments || []).map(function (a) {
      return {
        id: a.local_id, uid: a.uid, courseId: a.course_local_id,
        courseUid: courseById[a.course_local_id] ? courseById[a.course_local_id].uid : null,
        name: a.name, assessmentGroup: a.assessment_group, weightPercent: a.weight_percent,
        maxPoints: a.max_points, earnedPoints: a.earned_points
      };
    });
    return ensure({ version: 1, terms: terms, courses: courses, assessments: assessments });
  }

  function seedState() {
    return ensure({ version: 1, terms: clone(Seed.terms), courses: clone(Seed.courses), assessments: clone(Seed.assessments) });
  }

  // ---------- 訪客（localStorage）----------
  function readLocalState() { return Storage.load(); }

  function hasLocalData() {
    try {
      if (typeof localStorage === 'undefined') return false;
      var raw = localStorage.getItem(Storage.STORAGE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed) return false;
      return (Array.isArray(parsed.courses) && parsed.courses.length > 0) ||
             (Array.isArray(parsed.terms) && parsed.terms.length > 0);
    } catch (e) { return false; }
  }

  // ---------- 雲端 ----------
  function isCloud() { return !!(Auth && Auth.isAvailable() && Auth.isLoggedIn()); }

  async function loadCloud(deps) {
    var client = (deps && deps.client) || Auth.getClient();
    var userId = (deps && deps.userId) || (Auth.getUser() && Auth.getUser().id);
    var res = await Promise.all([
      client.from('semesters').select('*').eq('user_id', userId),
      client.from('courses').select('*').eq('user_id', userId),
      client.from('assessments').select('*').eq('user_id', userId)
    ]);
    var sem = res[0], cou = res[1], ass = res[2];
    if ((sem && sem.error) || (cou && cou.error) || (ass && ass.error)) {
      throw new Error(((sem && sem.error) || (cou && cou.error) || (ass && ass.error)).message || 'load failed');
    }
    // 讀取目前 revision（若 migration 尚未執行則忽略）
    try {
      var revRes = await client.from('gpa_user_state').select('revision').eq('user_id', userId);
      if (revRes && !revRes.error && revRes.data && revRes.data.length) setKnownRevision(userId, revRes.data[0].revision);
    } catch (e) { /* optional */ }

    var s = (sem && sem.data) || [], c = (cou && cou.data) || [], a = (ass && ass.data) || [];
    if (s.length === 0 && c.length === 0 && a.length === 0) return seedState();
    return rowsToState({ semesters: s, courses: c, assessments: a });
  }

  // ---------- 原子快照寫入（RPC）----------
  // 依賴 migration：public.gpa_replace_snapshot(...)，在單一交易內完成「刪除+插入」。
  async function persistCloud(state, deps) {
    var client = (deps && deps.client) || Auth.getClient();
    var userId = (deps && deps.userId) || (Auth.getUser() && Auth.getUser().id);
    var rows = stateToRows(state);
    var expected = (deps && Object.prototype.hasOwnProperty.call(deps, 'expectedRevision'))
      ? deps.expectedRevision
      : getKnownRevision(userId);

    var backup = { ok: false, error: 'not attempted' };
    try { backup = Storage.saveBackup(state, 'before-cloud-persist'); } catch (e) { backup = { ok: false, error: String(e) }; }

    var res = await client.rpc('gpa_replace_snapshot', {
      p_semesters: rows.semesters,
      p_courses: rows.courses,
      p_assessments: rows.assessments,
      p_expected_revision: (expected == null ? null : expected)
    });
    if (res && res.error) {
      var msg = res.error.message || 'rpc failed';
      var err = new Error(msg);
      if (/function .*gpa_replace_snapshot.* does not exist/i.test(msg) || /schema cache/i.test(msg)) {
        err.code = 'MIGRATION_REQUIRED';
      }
      throw err;
    }
    var data = (res && res.data) || {};
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
    if (data && data.conflict) {
      var ce = new Error('revision conflict');
      ce.code = 'REVISION_CONFLICT';
      ce.currentRevision = data.current_revision;
      throw ce;
    }
    if (data && data.revision != null) setKnownRevision(userId, data.revision);
    return { revision: data && data.revision, backup: backup };
  }

  // ---------- 安全合併（以 uid 為身份，重映射關聯，丟棄孤兒）----------
  function mergeStates(cloudState, localState) {
    var c = ensure(cloudState);
    var l = ensure(localState);

    function union(a, b) {
      var map = {}, order = [];
      (a || []).forEach(function (x) { if (x.uid && !map[x.uid]) { map[x.uid] = x; order.push(x.uid); } });
      (b || []).forEach(function (x) { if (x.uid && !map[x.uid]) { map[x.uid] = x; order.push(x.uid); } });
      return order.map(function (uid) { return map[uid]; });
    }

    var terms = union(c.terms, l.terms);
    var courses = union(c.courses, l.courses);
    var assessments = union(c.assessments, l.assessments);

    var termByUid = {};
    terms.forEach(function (t) { termByUid[t.uid] = t; });

    // 丟棄孤兒科目（父學期不存在）
    var keptCourses = [], droppedCourses = 0;
    courses.forEach(function (x) {
      if (x.termUid && termByUid[x.termUid]) keptCourses.push(x);
      else droppedCourses++;
    });
    var courseByUid = {};
    keptCourses.forEach(function (x) { courseByUid[x.uid] = x; });

    // 丟棄孤兒評核（父科目不存在）
    var keptAssessments = [], droppedAssessments = 0;
    assessments.forEach(function (x) {
      if (x.courseUid && courseByUid[x.courseUid]) keptAssessments.push(x);
      else droppedAssessments++;
    });

    // 重新分配整數 id 並映射關聯
    terms.forEach(function (t, i) { t.id = i + 1; });
    keptCourses.forEach(function (x, i) { x.id = i + 1; x.termId = termByUid[x.termUid].id; });
    var keptCourseByUid = {};
    keptCourses.forEach(function (x) { keptCourseByUid[x.uid] = x; });
    keptAssessments.forEach(function (x, i) { x.id = i + 1; x.courseId = keptCourseByUid[x.courseUid].id; });

    return {
      version: 1,
      terms: terms,
      courses: keptCourses,
      assessments: keptAssessments,
      orphans: { courses: droppedCourses, assessments: droppedAssessments }
    };
  }

  // ---------- 統一介面 ----------
  async function loadState(deps) {
    if (isCloud()) return await loadCloud(deps);
    return readLocalState();
  }

  async function persist(state, deps) {
    if (isCloud()) return await persistCloud(state, deps);
    var ok = Storage.save(state);
    if (ok !== true) throw new Error('本機儲存失敗（可能是瀏覽器儲存空間不足）');
    return { ok: true };
  }

  async function syncLocalToCloud(localState, deps) {
    return await persistCloud(localState, deps);
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
    seedState: seedState,
    mergeStates: mergeStates,
    getKnownRevision: getKnownRevision,
    setKnownRevision: setKnownRevision,
    _persistCloud: persistCloud,
    _loadCloud: loadCloud
  };
});
