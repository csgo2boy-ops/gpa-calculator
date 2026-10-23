/* =====================================================================
 * db.js — 雙模資料層（2.0 Batch 1.2 Final Safety Hardening）
 *
 * 重點：
 *  - 讀取：gpa_read_snapshot() RPC（單一 SQL 語句、一致快照）＋ revision
 *  - 寫入：gpa_replace_snapshot() RPC（單一交易），p_expected_revision 必填
 *  - 回應驗證：只有 data.ok === true 且 revision 合法才算成功
 *  - Revision 未知（有資料但無 state）時禁止覆蓋
 *  - 合併以穩定 uid 為身份；reconcileLocalUids() 可在舊資料遷移時對帳
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
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ensure(state) { return Storage.ensureUids(state); }
  function isUuid(v) { return Storage.isUuid ? Storage.isUuid(v) : (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)); }
  function parseRpc(data) {
    var d = data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    return d;
  }

  // ---------- revision（per-user）----------
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

  // ---------- 訪客 ----------
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

  // 原子讀取快照 + revision（單一 SQL 語句）
  async function loadCloud(deps) {
    var client = (deps && deps.client) || Auth.getClient();
    var userId = (deps && deps.userId) || (Auth.getUser() && Auth.getUser().id);
    var res = await client.rpc('gpa_read_snapshot', {});
    if (res && res.error) {
      var e0 = new Error(res.error.message || 'read failed');
      if (/function .*gpa_read_snapshot.* does not exist/i.test(e0.message) || /schema cache/i.test(e0.message)) e0.code = 'MIGRATION_REQUIRED';
      throw e0;
    }
    var data = parseRpc(res && res.data);
    if (!data || typeof data !== 'object' ||
        !Array.isArray(data.semesters) || !Array.isArray(data.courses) || !Array.isArray(data.assessments)) {
      var ie = new Error('RPC invalid response (read)');
      ie.code = 'RPC_INVALID_RESPONSE';
      throw ie;
    }
    var hasState = !!data.has_state;
    var hasData = (data.semesters.length + data.courses.length + data.assessments.length) > 0;
    var revision = (data.revision == null) ? null : Number(data.revision);

    // 未知 revision：有資料但沒有 state 列 → 不允許覆蓋
    var revisionKnown = hasState || !hasData;
    var effectiveRevision = revisionKnown ? (hasState ? revision : 0) : null;

    if (revisionKnown && effectiveRevision != null) setKnownRevision(userId, effectiveRevision);

    var state = hasData
      ? rowsToState({ semesters: data.semesters, courses: data.courses, assessments: data.assessments })
      : seedState();

    return { state: state, revision: effectiveRevision, initialized: hasState, revisionKnown: revisionKnown };
  }

  async function loadStateWithMeta(deps) {
    if (isCloud()) return await loadCloud(deps);
    return { state: readLocalState(), revision: null, initialized: false, revisionKnown: true };
  }

  async function loadState(deps) {
    var m = await loadStateWithMeta(deps);
    return m.state;
  }

  // 原子快照寫入（RPC）：p_expected_revision 必填；嚴格驗證回應
  async function persistCloud(state, deps) {
    var client = (deps && deps.client) || Auth.getClient();
    var userId = (deps && deps.userId) || (Auth.getUser() && Auth.getUser().id);
    var rows = stateToRows(state);

    var expected = (deps && hasOwn(deps, 'expectedRevision')) ? deps.expectedRevision : getKnownRevision(userId);
    if (expected == null || !isFinite(Number(expected)) || Number(expected) < 0) {
      var ue = new Error('revision unknown');
      ue.code = 'REVISION_UNKNOWN';
      throw ue;
    }
    expected = Number(expected);

    // 先存本機快取 + 備份，讓同步失敗時仍可恢復
    try { Storage.save(state); } catch (e) { /* ignore */ }
    var backup = { ok: false, error: 'not attempted' };
    try { backup = Storage.saveBackup(state, 'before-cloud-persist'); } catch (e) { backup = { ok: false, error: String(e) }; }

    var res = await client.rpc('gpa_replace_snapshot', {
      p_semesters: rows.semesters,
      p_courses: rows.courses,
      p_assessments: rows.assessments,
      p_expected_revision: expected
    });

    if (res && res.error) {
      var msg = res.error.message || 'rpc failed';
      var err = new Error(msg);
      if (/function .*gpa_replace_snapshot.* does not exist/i.test(msg) || /schema cache/i.test(msg)) err.code = 'MIGRATION_REQUIRED';
      throw err;
    }
    var data = parseRpc(res && res.data);
    if (data && data.conflict) {
      var ce = new Error('revision conflict');
      ce.code = 'REVISION_CONFLICT';
      ce.currentRevision = (data.current_revision == null ? null : Number(data.current_revision));
      throw ce;
    }
    // 只有 ok === true 且 revision 合法才算成功
    if (!data || data.ok !== true || data.revision == null || !isFinite(Number(data.revision))) {
      var ie = new Error('RPC invalid response (write)');
      ie.code = 'RPC_INVALID_RESPONSE';
      throw ie;
    }
    setKnownRevision(userId, Number(data.revision));
    return { revision: Number(data.revision), backup: backup };
  }

  // ---------- 安全合併（uid）----------
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
    var keptCourses = [], droppedCourses = 0;
    courses.forEach(function (x) {
      if (x.termUid && termByUid[x.termUid]) keptCourses.push(x); else droppedCourses++;
    });
    var courseByUid = {};
    keptCourses.forEach(function (x) { courseByUid[x.uid] = x; });
    var keptAssessments = [], droppedAssessments = 0;
    assessments.forEach(function (x) {
      if (x.courseUid && courseByUid[x.courseUid]) keptAssessments.push(x); else droppedAssessments++;
    });

    terms.forEach(function (t, i) { t.id = i + 1; });
    keptCourses.forEach(function (x, i) { x.id = i + 1; x.termId = termByUid[x.termUid].id; });
    var keptCourseByUid = {};
    keptCourses.forEach(function (x) { keptCourseByUid[x.uid] = x; });
    keptAssessments.forEach(function (x, i) { x.id = i + 1; x.courseId = keptCourseByUid[x.courseUid].id; });

    return {
      version: 1, terms: terms, courses: keptCourses, assessments: keptAssessments,
      orphans: { courses: droppedCourses, assessments: droppedAssessments }
    };
  }

  // 舊資料遷移對帳（Batch 1.2 修正：保守策略，不再只憑 local_id）
  //
  // 規則：
  //  - 只有 local_id 相符「且」內容簽章相同，才自動採用雲端 uid（高信心）。
  //  - 內容不同 → 列入 ambiguous，預設「不採用」（視為不同資料，避免錯誤覆蓋）。
  //  - decisions 可對單筆人工指定：{ 'course:3': 'cloud' | 'local' }。
  //  - 回傳 { state, adopted, ambiguous }。
  function normalizeText(v) {
    return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function sigTerm(t) { return normalizeText(t.name); }
  function sigCourse(c) { return normalizeText(c.code) + '|' + normalizeText(c.title) + '|' + String(c.credits); }
  function sigAssessment(a) { return normalizeText(a.name) + '|' + normalizeText(a.assessmentGroup) + '|' + String(a.weightPercent); }

  function reconcileLocalUids(localState, cloudState, opts) {
    opts = opts || {};
    var untrusted = !!opts.untrusted;   // 本機 uid 是否為「剛補齊、未經使用者確認」
    var dec = opts.decisions || {};
    var adopted = 0;
    var ambiguous = [];

    function build(kind, arrLocal, arrCloud, describe) {
      var cloudById = {};
      (arrCloud || []).forEach(function (c) { if (c && c.id != null) cloudById[c.id] = c; });
      return (arrLocal || []).map(function (l) {
        var c = cloudById[l.id];
        if (!c || !isUuid(c.uid)) return Object.assign({}, l); // 雲端沒有此 id → 保留本機
        if (l.uid === c.uid) return Object.assign({}, l);      // uid 相同 → 同一筆（可靠身份）
        if (!untrusted) return Object.assign({}, l);           // 已信任但 uid 不同 → 不同筆
        // 本機 uid 不可信：即使 local_id 與內容相同，也不可自動認定為同一筆
        var key = kind + ':' + l.id;
        var choice = dec[key];
        if (choice === 'cloud') { adopted++; return Object.assign({}, l, { uid: c.uid }); }
        if (choice === 'local') return Object.assign({}, l);
        ambiguous.push({
          key: key, kind: kind, localId: l.id,
          localLabel: describe(l), cloudLabel: describe(c)
        });
        return Object.assign({}, l); // 預設：不採用，交由使用者確認
      });
    }

    var terms = build('term', localState.terms, cloudState.terms, sigTerm);
    var courses = build('course', localState.courses, cloudState.courses, sigCourse);
    var assessments = build('assessment', localState.assessments, cloudState.assessments, sigAssessment);

    // 對帳後重新推導關聯 uid（避免指向舊 uid）
    var termUidById = {};
    terms.forEach(function (t) { termUidById[t.id] = t.uid; });
    courses.forEach(function (c) { if (termUidById[c.termId]) c.termUid = termUidById[c.termId]; });
    var courseUidById = {};
    courses.forEach(function (c) { courseUidById[c.id] = c.uid; });
    assessments.forEach(function (a) { if (courseUidById[a.courseId]) a.courseUid = courseUidById[a.courseId]; });

    return {
      state: ensure({ version: 1, terms: terms, courses: courses, assessments: assessments }),
      adopted: adopted,
      ambiguous: ambiguous
    };
  }

  // ---------- 統一介面 ----------
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
    loadStateWithMeta: loadStateWithMeta,
    persist: persist,
    hasLocalData: hasLocalData,
    readLocalState: readLocalState,
    syncLocalToCloud: syncLocalToCloud,
    stateToRows: stateToRows,
    rowsToState: rowsToState,
    seedState: seedState,
    mergeStates: mergeStates,
    reconcileLocalUids: reconcileLocalUids,
    getKnownRevision: getKnownRevision,
    setKnownRevision: setKnownRevision,
    _persistCloud: persistCloud,
    _loadCloud: loadCloud
  };
});
