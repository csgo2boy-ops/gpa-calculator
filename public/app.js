/* =========================================================================
 * app.js
 * 前端主程式：渲染、事件綁定、資料編輯與即時試算。
 * 資料層透過 GpaDb 在「雲端（Supabase）」與「訪客（localStorage）」之間自動切換。
 * 課程完全自訂：使用者可新增／刪除學期、科目與評核。
 * 依賴：GpaSeed、GpaEngine、GpaStorage、GpaAuth、GpaDb。
 * ========================================================================= */
(function () {
  'use strict';

  var Engine = window.GpaEngine;
  var Storage = window.GpaStorage;
  var Db = window.GpaDb;
  var Auth = window.GpaAuth;

  if (!Engine || !Storage || !Db || !Auth) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<div style="padding:2rem;color:#991b1b;font-family:sans-serif">載入失敗：缺少必要的腳本。</div>';
    });
    return;
  }

  var GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'];
  var state = null;
  var lastRevision = null;
  var revisionKnown = true;
  var authTab = 'login';

  // ---------- 工具 ----------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function toast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'error');
    el.textContent = message;
    container.appendChild(el);
    var raf = (typeof window !== 'undefined' && window.requestAnimationFrame) || function (fn) { setTimeout(fn, 10); };
    raf(function () { el.classList.add('toast-show'); });
    setTimeout(function () {
      el.classList.remove('toast-show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3200);
  }

  function currentScroll() { try { return (typeof window !== 'undefined' && window.scrollY) || 0; } catch (e) { return 0; } }
  function restoreScroll(y) { try { if (y > 0 && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, y); } catch (e) {} }
  function focusAfter(id) {
    setTimeout(function () {
      try { var el = document.getElementById(id); if (el) { el.focus(); if (el.select) el.select(); } } catch (e) {}
    }, 60);
  }

  function assessmentsOf(courseId) {
    return state.assessments.filter(function (a) { return a.courseId === courseId; });
  }
  function computeStats(course) {
    return Engine.calculateCourse(assessmentsOf(course.id), course.targetGrade || 'A');
  }
  function setSyncStatus(status) {
    var el = document.getElementById('sync-badge');
    if (!el) return;
    if (status === 'ok') { el.className = 'badge badge-emerald'; el.textContent = '☁ 雲端同步正常'; }
    else if (status === 'error') { el.className = 'badge badge-danger'; el.textContent = '⚠ 同步失敗'; }
    else if (status === 'syncing') { el.className = 'badge badge-pending'; el.textContent = '⏳ 同步中…'; }
  }
  function backupOrWarn(reason) {
    var r = Storage.saveBackup(state, reason);
    if (!r || !r.ok) {
      toast('備份未建立：' + ((r && r.error) || '儲存空間不足'), 'error');
      return false;
    }
    return true;
  }

  async function handleSyncError(e) {
    if (!e) return;
    if (e.code === 'REVISION_CONFLICT') {
      var meta = null;
      try { meta = await Db.loadStateWithMeta(); } catch (e2) { meta = null; }
      var info = meta
        ? ('雲端目前有 ' + meta.state.terms.length + ' 學期 / ' + meta.state.courses.length + ' 科目 / ' + meta.state.assessments.length + ' 評核')
        : '無法讀取雲端最新狀態';
      var reload = confirm('偵測到雲端已被其他裝置更新（版本衝突）。\n\n' + info + '。\n\n按「確定」= 重新載入雲端最新資料（捨棄本機未同步變更）；\n按「取消」= 用本機資料覆蓋雲端。');
      if (reload) {
        if (!meta) { toast('重新載入失敗，請稍後再試。', 'error'); return; }
        state = meta.state; lastRevision = meta.revision; revisionKnown = meta.revisionKnown;
        render(); if (Auth.isLoggedIn()) setSyncStatus('ok');
        toast('已重新載入雲端最新資料。', 'success');
      } else {
        var freshRev = meta ? meta.revision : null;
        if (freshRev == null) { toast('無法確認雲端版本，已停止覆蓋以避免資料遺失。', 'error'); return; }
        if (!confirm('確定要用本機資料覆蓋雲端嗎？\n\n' + info + '\n\n此操作會覆蓋上述雲端資料，且無法復原。')) return;
        try {
          var res2 = await Db.persist(state, { expectedRevision: freshRev });
          lastRevision = res2.revision; revisionKnown = true;
          if (Auth.isLoggedIn()) setSyncStatus('ok');
          toast('已用本機資料覆蓋雲端。', 'success');
        } catch (e3) {
          if (e3.code === 'REVISION_CONFLICT') toast('覆蓋時又被其他裝置更新，請重新載入後再試。', 'error');
          else toast('覆蓋失敗：' + (e3.message || e3), 'error');
        }
      }
      return;
    }
    if (e.code === 'REVISION_UNKNOWN') {
      toast('無法確認雲端版本（可能有資料但缺少 revision），已停止同步以避免覆蓋。請先執行 Batch 1.2 migration。', 'error');
      return;
    }
    if (e.code === 'RPC_INVALID_RESPONSE') {
      toast('雲端回應異常（缺少 ok 或 revision），已視為同步失敗。', 'error');
      return;
    }
    if (e.code === 'MIGRATION_REQUIRED') {
      toast('雲端尚未套用 Batch 1.2 migration，請先執行 supabase/migrations/001_batch1_1_data_safety.sql', 'error');
      return;
    }
    toast('同步失敗：' + (e.message || e), 'error');
  }

  async function persist() {
    if (Auth.isLoggedIn()) setSyncStatus('syncing');
    try {
      var res = await Db.persist(state, { expectedRevision: lastRevision });
      if (res && res.revision != null) { lastRevision = res.revision; revisionKnown = true; }
      if (Auth.isLoggedIn()) setSyncStatus('ok');
    } catch (e) {
      console.error(e);
      if (Auth.isLoggedIn()) setSyncStatus('error');
      await handleSyncError(e);
    }
  }
  async function commit() { await persist(); render(); }

  // ---------- 導覽列 ----------
  function renderNavbar() {
    var area = document.getElementById('account-area');
    if (!area) return;
    if (Auth.isLoggedIn()) {
      var name = Auth.getDisplayName();
      area.innerHTML =
        '<span class="nav-email">👤 ' + escapeHtml(name) + '</span>' +
        '<span id="sync-badge" class="badge badge-emerald">☁ 雲端同步正常</span>' +
        '<button id="btn-logout" class="btn btn-ghost btn-sm">登出</button>';
      document.getElementById('btn-logout').addEventListener('click', function () { Auth.signOut(); });
    } else {
      area.innerHTML =
        '<span class="badge badge-slate">訪客模式（本地暫存）</span>' +
        '<button id="btn-open-auth" class="btn btn-ghost btn-sm">登入 / 註冊</button>';
      document.getElementById('btn-open-auth').addEventListener('click', function () { openAuthModal('login'); });
    }
  }

  // ---------- 渲染 ----------
  function groupBadge(label, g) {
    if (!g || g.weight <= 0) return '';
    if (g.pass === 'pending') return '<span class="badge badge-pending">⏳ ' + label + ' 待評分</span>';
    var pct = g.percentage !== null ? g.percentage.toFixed(1) : '--';
    if (g.pass === false) return '<span class="badge badge-danger">✗ ' + label + ' 未達標 (' + pct + '%)</span>';
    return '<span class="badge badge-emerald">✓ ' + label + ' 已達標 (' + pct + '%)</span>';
  }

  function renderEmptyState() {
    return '<div class="empty-state">' +
      '<div class="empty-icon">📘</div>' +
      '<h3 class="empty-title">歡迎使用 GPA Tracker</h3>' +
      '<p class="empty-desc">免費、免安裝的 GPA 成績追蹤工具，適用於任何學校與課程。你可以從零開始建立自己的課程，或載入 IT114105 範本作為起點。</p>' +
      '<div class="empty-steps">' +
        '<div class="step"><span class="step-num">1</span><span>新增學期</span></div>' +
        '<div class="step"><span class="step-num">2</span><span>新增科目</span></div>' +
        '<div class="step"><span class="step-num">3</span><span>新增評核</span></div>' +
      '</div>' +
      '<div class="empty-actions">' +
        '<button class="btn btn-primary" onclick="window.__gpa.openTermModal()">＋ 從零開始</button>' +
        '<button class="btn btn-ghost" onclick="window.__gpa.loadTemplate()">📋 使用 IT114105 預設課程</button>' +
      '</div>' +
      '<button class="link-btn" onclick="window.__gpa.openHelpModal()">📖 查看完整使用說明與算分規則</button>' +
    '</div>';
  }

  function render() {
    if (!state) return;
    var y = currentScroll();
    var terms = state.terms.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

    var termList = document.getElementById('term-list');
    termList.innerHTML = terms.map(function (t) {
      var tCourses = state.courses.filter(function (c) { return c.termId === t.id; });
      var totalCredits = tCourses.reduce(function (sum, c) { return sum + (Number(c.credits) || 0); }, 0);
      return '<li class="term-item">' +
        '<span class="term-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="term-meta">' +
          '<span class="term-credits">' + totalCredits + ' cr</span>' +
          '<button class="icon-btn icon-btn-danger" data-action="del-term" data-id="' + t.id + '" title="刪除此學期">✕</button>' +
        '</span>' +
      '</li>';
    }).join('');

    var summaryEl = document.getElementById('summary');
    if (summaryEl) {
      if (state.courses.length > 0) {
        var totalAllCredits = state.courses.reduce(function (s, c) { return s + (Number(c.credits) || 0); }, 0);
        summaryEl.textContent = '共 ' + state.courses.length + ' 個科目 · ' + totalAllCredits + ' 學分';
        summaryEl.classList.remove('hidden');
      } else {
        summaryEl.textContent = '';
        summaryEl.classList.add('hidden');
      }
    }

    var container = document.getElementById('course-container');
    if (terms.length === 0) {
      container.innerHTML = renderEmptyState();
      calculateCGPA();
      restoreScroll(y);
      return;
    }

    var html = terms.map(function (t) {
      var tCourses = state.courses.filter(function (c) { return c.termId === t.id; });

      var semesterHeader = '<div class="semester-header">' +
        '<span class="semester-bar"></span>' +
        '<span class="semester-title">' + escapeHtml(t.name) + '</span>' +
        '<button class="btn btn-sm btn-ghost semester-add" onclick="window.__gpa.openCourseModal(' + t.id + ')">＋ 新增科目</button>' +
        '<button class="icon-btn icon-btn-danger semester-del" data-action="del-term" data-id="' + t.id + '" title="刪除此學期">✕</button>' +
      '</div>';

      if (tCourses.length === 0) {
        return semesterHeader + '<div class="semester-empty">此學期尚無科目。點「＋ 新增科目」開始。</div>';
      }

      var cards = tCourses.map(function (c) {
        var s = computeStats(c);
        var isCrossTermPending = c.gpaInclusion === 'needs-review';
        var issueBadges = (s.issues || []).map(function (i) {
          return '<span class="badge badge-danger">⚠ ' + escapeHtml(i) + '</span>';
        }).join('');

        var targetHtml = '';
        if (s.targetStatus === 'locked') {
          targetHtml = '<div class="target-ok">🎉 已達標！</div>';
        } else if (s.targetStatus === 'locked-pending') {
          targetHtml = '<div class="target-warn">⏳ 分數已達目標，但 CA/EA 仍有未評分項目，尚未確認達標</div>';
        } else if (s.targetStatus === 'threshold-failed') {
          targetHtml = '<div class="target-bad">⚠️ 分數達標，但 CA/EA 未達 40% 及格門檻，不符合及格</div>';
        } else if (s.targetStatus === 'impossible') {
          targetHtml = '<div class="target-bad">⚠️ 目標已無法達成（最高可達 ' + s.maxFinal.toFixed(1) + ' 分）</div>';
        } else if (s.targetStatus === 'failed') {
          targetHtml = '<div class="target-muted">已評分完畢，未達目標</div>';
        } else {
          var req = s.requiredAvg !== null ? s.requiredAvg.toFixed(1) : '--';
          targetHtml = '<div class="target-muted">剩餘評核平均需達 <strong class="target-strong">' + req + '%</strong></div>';
        }

        var gradeOptions = GRADES.map(function (g) {
          return '<option value="' + g + '"' + (c.targetGrade === g ? ' selected' : '') + '>' + g + ' (' + Engine.getMarkFromGrade(g) + ')</option>';
        }).join('');

        var rows = '';
        var list = assessmentsOf(c.id);
        if (list.length > 0) {
          rows = list.map(function (a) {
            var earnedTxt = a.earnedPoints !== null ? a.earnedPoints : '--';
            var maxTxt = a.maxPoints !== null && a.maxPoints > 0 ? a.maxPoints : '未知';
            var scoreCls = a.earnedPoints !== null && a.maxPoints > 0 ? 'score-has' : 'score-empty';
            return '<tr class="row">' +
              '<td class="cell-name">' + escapeHtml(a.name) + '</td>' +
              '<td class="cell-group"><span class="group-chip">' + escapeHtml(a.assessmentGroup) + '</span></td>' +
              '<td class="cell-weight">' + a.weightPercent + '%</td>' +
              '<td class="cell-score ' + scoreCls + '">' + earnedTxt + ' <span class="sep">/</span> ' + maxTxt + '</td>' +
              '<td class="cell-actions">' +
                '<button class="icon-btn" data-action="edit-assess" data-id="' + a.id + '" data-courseid="' + c.id + '" title="編輯">✎</button>' +
                '<button class="icon-btn icon-btn-danger" data-action="del-assess" data-id="' + a.id + '" title="刪除">✕</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        } else {
          rows = '<tr><td colspan="5" class="cell-empty">尚未新增評核項目</td></tr>';
        }

        var badges = groupBadge('CA', s.ca) +
          groupBadge('EA', s.ea) +
          (isCrossTermPending ? '<span class="badge badge-slate">跨學期 GPA 入帳待確認</span>' : '') +
          (!s.isWeightValid ? '<span class="badge badge-danger">⚠ 權重合計不等於 100%</span>' : '') +
          (s.otherWeight > 0 ? '<span class="badge badge-pending" title="非 CA/EA 的項目不參與及格線判定，請確認是否漏標。">⚠ 含有 ' + s.otherWeight + '% 「其他」 組別</span>' : '') +
          issueBadges;

        return '<div class="card">' +
          '<div class="card-head">' +
            '<div class="card-title-wrap">' +
              '<h3 class="card-title">' + escapeHtml(c.title) + '</h3>' +
              '<div class="card-meta">' +
                '<span class="code-chip">' + escapeHtml(c.code || '無代碼') + '</span>' +
                '<span class="credits">學分: <strong>' + c.credits + '</strong>' +
                  '<button class="icon-btn" onclick="window.__gpa.editCredits(' + c.id + ', ' + c.credits + ')" title="修改學分">✎</button>' +
                '</span>' +
                '<button class="icon-btn icon-btn-danger" data-action="del-course" data-id="' + c.id + '" title="刪除此科目">✕</button>' +
              '</div>' +
            '</div>' +
            '<div class="card-score">' +
              '<div class="score-big">' + s.secured.toFixed(2) + ' <span class="score-unit">/ 已鎖定分</span></div>' +
              '<div class="score-sub">已評分權重: ' + s.gradedWeight + '% | 最高可達: ' + s.maxFinal.toFixed(2) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="badge-row">' + badges + '</div>' +
          '<div class="target-block">' +
            '<div class="target-left"><span class="target-label">目標等級：</span>' +
              '<select class="target-select" onchange="window.__gpa.updateTarget(' + c.id + ', this.value)">' + gradeOptions + '</select>' +
            '</div>' +
            '<div class="target-right">' + targetHtml + '</div>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="table">' +
              '<thead><tr>' +
                '<th class="th-name">評核項目</th><th>組別</th><th>權重</th><th class="th-score">得分 / 滿分</th><th class="th-actions">操作</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="card-foot">' +
            '<button class="btn btn-primary" onclick="window.__gpa.openModal(' + c.id + ')">＋ 新增評核</button>' +
            '<button class="btn btn-ghost" onclick="window.__gpa.confirmCourse(' + c.id + ')">輸入官方成績</button>' +
          '</div>' +
        '</div>';
      }).join('');

      return semesterHeader + cards;
    }).join('');

    container.innerHTML = html;
    calculateCGPA();
    restoreScroll(y);
  }

  function calculateCGPA() {
    var eligible = state.courses.filter(function (c) {
      return c.officialMark !== null && c.officialMark !== undefined && c.gpaInclusion === 'include';
    });
    var totalPoints = 0, totalCredits = 0;
    eligible.forEach(function (c) {
      var gp = Engine.getGrade(Number(c.officialMark)).gp;
      totalPoints += gp * c.credits;
      totalCredits += c.credits;
    });
    var totalIncludeCredits = state.courses
      .filter(function (c) { return c.gpaInclusion === 'include'; })
      .reduce(function (sum, c) { return sum + c.credits; }, 0);
    var cgpa = totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '--';
    document.getElementById('cgpa-display').textContent = cgpa;
    document.getElementById('cgpa-coverage').textContent = '覆蓋學分: ' + totalCredits + ' / ' + totalIncludeCredits;
  }

  // ---------- 學期 Modal ----------
  function openTermModal() {
    document.getElementById('term-form').reset();
    document.getElementById('term-modal').classList.remove('hidden');
    document.getElementById('term-modal').classList.add('flex');
    focusAfter('term-name');
  }
  function closeTermModal() {
    document.getElementById('term-modal').classList.add('hidden');
    document.getElementById('term-modal').classList.remove('flex');
  }
  document.getElementById('term-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = document.getElementById('term-name').value.trim();
    if (!name) { toast('請輸入學期名稱。'); return; }
    var maxOrder = state.terms.reduce(function (m, t) { return Math.max(m, t.sortOrder || 0); }, 0);
    state.terms.push({ id: Storage.nextId(state.terms), uid: Storage.genUid(), name: name, sortOrder: maxOrder + 1 });
    closeTermModal();
    await commit();
  });

  // ---------- 科目 Modal ----------
  function openCourseModal(termId) {
    document.getElementById('course-form').reset();
    document.getElementById('course-termId').value = termId;
    document.getElementById('course-include').checked = true;
    document.getElementById('course-modal').classList.remove('hidden');
    document.getElementById('course-modal').classList.add('flex');
    focusAfter('course-title');
  }
  function closeCourseModal() {
    document.getElementById('course-modal').classList.add('hidden');
    document.getElementById('course-modal').classList.remove('flex');
  }
  document.getElementById('course-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var termId = parseInt(document.getElementById('course-termId').value, 10);
    var title = document.getElementById('course-title').value.trim();
    var code = document.getElementById('course-code').value.trim();
    var creditsStr = document.getElementById('course-credits').value;
    var credits = creditsStr === '' ? 0 : parseFloat(creditsStr);
    var include = document.getElementById('course-include').checked;
    if (!title) { toast('請輸入科目名稱。'); return; }
    if (isNaN(credits) || credits < 0) { toast('學分必須是非負數。'); return; }
    var parentTerm = state.terms.find(function (t) { return t.id === termId; });
    state.courses.push({
      id: Storage.nextId(state.courses),
      uid: Storage.genUid(),
      termId: termId,
      termUid: parentTerm ? parentTerm.uid : null,
      code: code || null,
      title: title,
      credits: credits,
      gpaInclusion: include ? 'include' : 'exclude',
      officialMark: null,
      officialGP: null,
      crossSemesterPolicy: 'single',
      targetGrade: 'A'
    });
    closeCourseModal();
    await commit();
  });

  // ---------- 評核 Modal ----------
  var modal = document.getElementById('assessment-modal');
  var form = document.getElementById('assessment-form');

  function openModal(courseId, editData) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (editData) {
      document.getElementById('modal-title').textContent = '編輯評核項目';
      document.getElementById('form-id').value = editData.id;
      document.getElementById('form-courseId').value = courseId;
      document.getElementById('form-name').value = editData.name;
      document.getElementById('form-group').value = editData.assessmentGroup;
      document.getElementById('form-weight').value = editData.weightPercent;
      document.getElementById('form-max').value = editData.maxPoints > 0 ? editData.maxPoints : '';
      document.getElementById('form-earned').value = editData.earnedPoints !== null ? editData.earnedPoints : '';
    } else {
      document.getElementById('modal-title').textContent = '新增評核項目';
      form.reset();
      document.getElementById('form-id').value = '';
      document.getElementById('form-courseId').value = courseId;
      document.getElementById('form-max').value = '100';
    }
    focusAfter('form-name');
  }
  function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = document.getElementById('form-id').value;
    var courseId = parseInt(document.getElementById('form-courseId').value, 10);
    var name = document.getElementById('form-name').value;
    var assessmentGroup = document.getElementById('form-group').value;
    var weightPercent = parseFloat(document.getElementById('form-weight').value);

    if (isNaN(weightPercent) || weightPercent < 0 || weightPercent > 100) { toast('權重必須是 0 至 100 之間的數字。'); return; }
    var maxStr = document.getElementById('form-max').value;
    var maxPoints = maxStr === '' ? null : parseFloat(maxStr);
    var earnedStr = document.getElementById('form-earned').value;
    var earnedPoints = earnedStr === '' ? null : parseFloat(earnedStr);
    if (maxPoints !== null && maxPoints <= 0) { toast('滿分必須大於 0。'); return; }
    if (earnedPoints !== null && earnedPoints < 0) { toast('得分不可小於 0。'); return; }
    if (earnedPoints !== null && maxPoints !== null && earnedPoints > maxPoints) { toast('得分不可大於滿分，請檢查後再儲存。'); return; }

    if (id) {
      var existing = state.assessments.find(function (a) { return a.id === parseInt(id, 10); });
      if (existing) {
        existing.name = name.trim();
        existing.assessmentGroup = assessmentGroup;
        existing.weightPercent = weightPercent;
        existing.maxPoints = maxPoints;
        existing.earnedPoints = earnedPoints;
      }
    } else {
      var parentCourse = state.courses.find(function (c) { return c.id === courseId; });
      state.assessments.push({
        id: Storage.nextId(state.assessments),
        uid: Storage.genUid(),
        courseId: courseId,
        courseUid: parentCourse ? parentCourse.uid : null,
        name: name.trim(), assessmentGroup: assessmentGroup,
        weightPercent: weightPercent, maxPoints: maxPoints, earnedPoints: earnedPoints
      });
    }
    closeModal();
    await commit();
  });

  // ---------- 刪除 ----------
  async function deleteAssessment(id) {
    if (!confirm('確定要刪除這筆評核紀錄嗎？刪除後無法復原。')) return;
    state.assessments = state.assessments.filter(function (a) { return a.id !== id; });
    await commit();
  }
  async function deleteTerm(id) {
    if (!confirm('確定要刪除此學期？此學期下的所有科目與評核也會一併刪除。')) return;
    var courseIds = state.courses.filter(function (c) { return c.termId === id; }).map(function (c) { return c.id; });
    state.courses = state.courses.filter(function (c) { return c.termId !== id; });
    state.assessments = state.assessments.filter(function (a) { return courseIds.indexOf(a.courseId) === -1; });
    state.terms = state.terms.filter(function (t) { return t.id !== id; });
    await commit();
  }
  async function deleteCourse(id) {
    if (!confirm('確定要刪除此科目？其評核也會一併刪除。')) return;
    state.courses = state.courses.filter(function (c) { return c.id !== id; });
    state.assessments = state.assessments.filter(function (a) { return a.courseId !== id; });
    await commit();
  }

  // ---------- 編輯 ----------
  async function updateTarget(courseId, targetGrade) {
    var c = state.courses.find(function (x) { return x.id === courseId; });
    if (c) { c.targetGrade = targetGrade; await commit(); }
  }
  async function editCredits(courseId, currentCredits) {
    var newCreditsStr = prompt('請輸入新的學分數 (可輸入小數):', currentCredits);
    if (newCreditsStr === null) return;
    var newCredits = parseFloat(newCreditsStr);
    if (isNaN(newCredits) || newCredits < 0) { toast('請輸入有效的非負數！'); return; }
    var c = state.courses.find(function (x) { return x.id === courseId; });
    if (c) { c.credits = newCredits; await commit(); }
  }
  async function confirmCourse(courseId) {
    var course = state.courses.find(function (c) { return c.id === courseId; });
    if (!course) return;
    var markStr = prompt('請輸入校方公布的科目最終分數 (0-100)，留空可清除:', course.officialMark !== null && course.officialMark !== undefined ? course.officialMark : '');
    if (markStr === null) return;
    var trimmed = markStr.trim();
    var mark = trimmed === '' ? null : parseFloat(trimmed);
    if (mark !== null && (isNaN(mark) || mark < 0 || mark > 100)) { toast('請輸入 0 至 100 之間的有效數字。'); return; }
    course.officialMark = mark;
    course.officialGP = mark === null ? null : Engine.getGrade(mark).gp;
    await commit();
  }

  // ---------- 載入 IT114105 範本 ----------
  async function loadTemplate() {
    var tpl = Storage.template();
    if (!tpl || !tpl.terms || tpl.terms.length === 0) { toast('沒有可用的範本課程。'); return; }
    if (state.terms.length > 0) {
      if (!confirm('目前已有資料，載入範本會覆蓋目前內容，確定嗎？')) return;
    }
    if (!backupOrWarn('before-template')) return;
    state = Storage.ensureUids({ version: 1, terms: tpl.terms, courses: tpl.courses, assessments: tpl.assessments });
    await commit();
    toast('已載入 IT114105 範本（可按「還原備份」回復）。', 'success');
  }

  // ---------- 匯出 / 匯入 / 清空 ----------
  function exportBackup() {
    var data = Storage.exportJson(state);
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gpa-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function importBackup() {
    var fileInput = document.getElementById('import-file');
    if (!fileInput.files.length) return;
    if (!confirm('匯入會覆蓋目前所有資料，確定要繼續嗎？建議先匯出目前備份。')) { fileInput.value = ''; return; }
    var file = fileInput.files[0];
    var reader = new FileReader();
    reader.onload = async function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (err) { toast('無法解析 JSON 檔案，請確認是正確的備份檔。'); fileInput.value = ''; return; }
      var result = Storage.importJson(data);
      if (!result.ok) { toast(result.error); }
      else {
        if (!backupOrWarn('before-import')) { fileInput.value = ''; return; }
        state = result.state;
        await commit();
        toast('匯入成功：' + state.terms.length + ' 學期、' + state.courses.length + ' 科目、' + state.assessments.length + ' 評核。', 'success');
      }
      fileInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }
  async function resetData() {
    if (!confirm('確定要清空目前所有資料嗎？（學期、科目、評核都會被刪除）\n清空前會自動建立一份可還原的備份。')) return;
    if (!backupOrWarn('before-clear')) return;
    state = { version: 1, terms: [], courses: [], assessments: [] };
    await commit();
    toast('已清空。如需回復，請按「還原備份」。', 'success');
  }

  function openBackupModal() {
    var list = Storage.listBackups();
    var body = document.getElementById('backup-list');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<p class="sync-desc">目前沒有任何備份。</p>';
    } else {
      body.innerHTML = list.map(function (b) {
        return '<div class="backup-item">' +
          '<div class="backup-meta"><strong>' + escapeHtml(b.savedAt) + '</strong>' +
          '<span>' + escapeHtml(b.reason || '') + ' · ' + b.terms + ' 學期 / ' + b.courses + ' 科目 / ' + b.assessments + ' 評核</span></div>' +
          '<button class="btn btn-ghost btn-sm" data-restore="' + b.index + '">還原</button>' +
        '</div>';
      }).join('');
    }
    document.getElementById('backup-modal').classList.remove('hidden');
    document.getElementById('backup-modal').classList.add('flex');
  }
  function closeBackupModal() {
    document.getElementById('backup-modal').classList.add('hidden');
    document.getElementById('backup-modal').classList.remove('flex');
  }
  async function restoreBackupAt(index) {
    var b = Storage.loadBackup(index);
    if (!b || !b.state) { toast('沒有可還原的備份。'); return; }
    if (!confirm('確定還原到 ' + b.savedAt + ' 的備份嗎？目前內容會被覆蓋（還原前會再備份一次）。')) return;
    if (!backupOrWarn('before-restore')) return;
    state = Storage.ensureUids(b.state);
    closeBackupModal();
    await commit();
    toast('已還原備份。', 'success');
  }

  // ---------- 認證 Modal ----------
  function openAuthModal(tab) {
    authTab = tab || 'login';
    setAuthTab();
    var errEl = document.getElementById('auth-error');
    errEl.classList.add('hidden');
    errEl.textContent = '';
    document.getElementById('auth-form').reset();
    document.getElementById('auth-modal').classList.remove('hidden');
    document.getElementById('auth-modal').classList.add('flex');
    focusAfter('auth-username');
  }
  function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('auth-modal').classList.remove('flex');
  }
  function openHelpModal() {
    document.getElementById('help-modal').classList.remove('hidden');
    document.getElementById('help-modal').classList.add('flex');
  }
  function closeHelpModal() {
    document.getElementById('help-modal').classList.add('hidden');
    document.getElementById('help-modal').classList.remove('flex');
  }
  function setAuthTab() {
    document.getElementById('auth-modal-title').textContent = authTab === 'login' ? '登入' : '註冊';
    document.getElementById('auth-submit').textContent = authTab === 'login' ? '登入' : '註冊';
    var tabs = document.querySelectorAll('.auth-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === authTab);
    }
  }
  function showAuthError(msg, isInfo) {
    var el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.toggle('auth-error-info', !!isInfo);
  }

  document.querySelectorAll('.auth-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      authTab = tab.getAttribute('data-tab');
      setAuthTab();
      document.getElementById('auth-error').classList.add('hidden');
    });
  });

  document.getElementById('auth-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var username = document.getElementById('auth-username').value.trim();
    var password = document.getElementById('auth-password').value;
    if (!Auth.isValidUsername(username)) { showAuthError('帳號名稱需為 3–20 個英文字母、數字或底線（_）。'); return; }
    if (password.length < 6) { showAuthError('密碼長度不足，至少需要 6 個字元。'); return; }
    var res;
    if (authTab === 'login') res = await Auth.signIn(username, password);
    else res = await Auth.signUp(username, password);
    if (!res.ok) { showAuthError(res.error); return; }
    if (res.needConfirm) { showAuthError('註冊成功，但此帳號需要 Email 驗證。請在 Supabase 關閉「Confirm email」後再試。', true); return; }
    closeAuthModal();
  });

  document.getElementById('btn-google').addEventListener('click', async function () {
    var res = await Auth.signInWithGoogle();
    if (!res.ok) showAuthError(res.error);
  });

  // ---------- 事件委派 ----------
  document.addEventListener('click', function (e) {
    var restoreBtn = e.target.closest('[data-restore]');
    if (restoreBtn) { restoreBackupAt(parseInt(restoreBtn.getAttribute('data-restore'), 10)); return; }
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var id = Number(btn.dataset.id);
    var courseId = Number(btn.dataset.courseid);
    if (action === 'edit-assess') {
      var a = state.assessments.find(function (x) { return x.id === id; });
      if (a) openModal(courseId, a);
    } else if (action === 'del-assess') { deleteAssessment(id); }
    else if (action === 'del-term') { deleteTerm(id); }
    else if (action === 'del-course') { deleteCourse(id); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      closeAuthModal(); closeTermModal(); closeCourseModal(); closeModal(); closeHelpModal(); closeBackupModal();
      var rm = document.getElementById('reconcile-modal');
      if (rm) { rm.classList.add('hidden'); rm.classList.remove('flex'); }
    }
  });

  document.getElementById('btn-help').addEventListener('click', openHelpModal);
  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', function () { document.getElementById('import-file').click(); });
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('btn-reset').addEventListener('click', resetData);
  document.getElementById('btn-restore').addEventListener('click', openBackupModal);

  // 暴露給 inline onclick
  window.__gpa = {
    editCredits: editCredits,
    updateTarget: updateTarget,
    openModal: openModal,
    closeModal: closeModal,
    closeAuthModal: closeAuthModal,
    confirmCourse: confirmCourse,
    openTermModal: openTermModal,
    closeTermModal: closeTermModal,
    openCourseModal: openCourseModal,
    closeCourseModal: closeCourseModal,
    loadTemplate: loadTemplate,
    openHelpModal: openHelpModal,
    closeHelpModal: closeHelpModal,
    closeBackupModal: closeBackupModal
  };

  // ---------- 同步衝突處理（保留雲端 / 保留本機 / 安全合併）----------
  function askSyncConflict() {
    return new Promise(function (resolve) {
      var modal = document.getElementById('sync-modal');
      if (!modal) { resolve('cloud'); return; }
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      function handler(e) {
        var b = e.target.closest('[data-sync]');
        if (!b) return;
        cleanup();
        resolve(b.getAttribute('data-sync'));
      }
      function cleanup() {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.removeEventListener('click', handler);
      }
      modal.addEventListener('click', handler);
    });
  }

  // ---------- 舊資料對帳：人工確認（保守預設＝保留本機）----------
  function reconcileKindLabel(kind) {
    return kind === 'term' ? '學期' : (kind === 'course' ? '科目' : '評核');
  }
  function askReconcile(list) {
    return new Promise(function (resolve) {
      var modal = document.getElementById('reconcile-modal');
      var body = document.getElementById('reconcile-list');
      if (!modal || !body) { resolve({}); return; }
      body.innerHTML = (list || []).map(function (x) {
        return '<label class="reconcile-item">' +
          '<input type="checkbox" data-rkey="' + escapeHtml(x.key) + '">' +
          '<span><strong>' + escapeHtml(reconcileKindLabel(x.kind)) + ' #' + x.localId + '</strong> ' +
          '本機：' + escapeHtml(x.localLabel) + ' ／ 雲端：' + escapeHtml(x.cloudLabel) + '</span></label>';
      }).join('');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      function handler(e) {
        var b = e.target.closest('[data-reconcile]');
        if (!b) return;
        var decisions = {};
        if (b.getAttribute('data-reconcile') === 'apply') {
          var boxes = body.querySelectorAll('input[data-rkey]');
          boxes.forEach(function (box) { decisions[box.getAttribute('data-rkey')] = box.checked ? 'cloud' : 'local'; });
        } else {
          (list || []).forEach(function (x) { decisions[x.key] = 'local'; });
        }
        cleanup();
        resolve(decisions);
      }
      function cleanup() {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        modal.removeEventListener('click', handler);
      }
      modal.addEventListener('click', handler);
    });
  }

  // ---------- 認證狀態監聽 ----------
  Auth.onAuthChange(async function (user, event) {
    renderNavbar();
    if (event === 'SIGNED_IN') {
      try {
        var lm = (Storage.getLoadMeta ? Storage.getLoadMeta() : { persistOk: true, uidsBackfilled: false });

        var cloudMeta = null;
        try { cloudMeta = await Db.loadStateWithMeta(); } catch (e2) { console.error(e2); }
        if (!cloudMeta) {
          setSyncStatus('error');
          toast('無法讀取雲端資料，已停止同步。', 'error');
          return;
        }

        // UID 遷移未能持久化 → 禁止雲端同步（避免重複資料）
        if (lm.persistOk === false) {
          state = cloudMeta.state; lastRevision = cloudMeta.revision; revisionKnown = cloudMeta.revisionKnown;
          render(); setSyncStatus('error');
          toast('本機 UID 遷移未能持久化，已停止雲端同步以避免重複資料。請清理本機儲存後再試。', 'error');
          return;
        }
        // Revision 未知（有資料但缺 state）→ 禁止覆蓋
        if (cloudMeta.revisionKnown === false) {
          state = cloudMeta.state; lastRevision = null; revisionKnown = false;
          render(); setSyncStatus('error');
          toast('雲端資料版本狀態不一致（有資料但缺少 revision），已停止同步。請先執行 Batch 1.2 migration。', 'error');
          return;
        }

        var localHas = Db.hasLocalData();
        var cloudState = cloudMeta.state;
        var cloudHas = !!(cloudState && ((cloudState.courses && cloudState.courses.length) || (cloudState.terms && cloudState.terms.length)));
        var localState = Db.readLocalState();

        // 舊資料遷移：以相同 local_id 對帳雲端 uid，避免第一次合併產生重複
        if (cloudHas && lm.uidsBackfilled) {
          var rec = Db.reconcileLocalUids(localState, cloudState);
          if (rec.ambiguous && rec.ambiguous.length > 0) {
            var decisions = await askReconcile(rec.ambiguous);
            rec = Db.reconcileLocalUids(localState, cloudState, decisions);
          }
          localState = rec.state;
          try { Storage.save(localState); } catch (e4) { /* ignore */ }
        }

        if (localHas && cloudHas) {
          var choice = await askSyncConflict();
          if (choice === 'local') {
            await Db.syncLocalToCloud(localState, { expectedRevision: cloudMeta.revision });
          } else if (choice === 'merge') {
            var merged = Db.mergeStates(cloudState, localState);
            await Db.persist(merged, { expectedRevision: cloudMeta.revision });
            var orph = merged.orphans || { courses: 0, assessments: 0 };
            if (orph.courses || orph.assessments) {
              toast('合併完成；已移除 ' + orph.courses + ' 個孤立科目、' + orph.assessments + ' 個孤立評核（其父項已被刪除）。', 'info');
            }
          }
        } else if (localHas && !cloudHas) {
          if (confirm('雲端尚無資料，是否將本機暫存資料同步到雲端？')) {
            await Db.syncLocalToCloud(localState, { expectedRevision: cloudMeta.revision });
          }
        }

        var after = await Db.loadStateWithMeta();
        state = after.state;
        lastRevision = after.revision;
        revisionKnown = after.revisionKnown;
        render();
        if (Auth.isLoggedIn()) setSyncStatus('ok');
      } catch (e) {
        console.error(e);
        setSyncStatus('error');
        await handleSyncError(e);
      }
    } else if (event === 'SIGNED_OUT') {
      try {
        var m2 = await Db.loadStateWithMeta();
        state = m2.state; lastRevision = m2.revision; revisionKnown = m2.revisionKnown;
        render();
      } catch (e) { console.error(e); }
    }
  });

  // ---------- 啟動 ----------
  function maybeShowHelpOnFirstVisit() {
    try {
      if (localStorage.getItem('gpa-tracker-help-seen')) return;
      openHelpModal();
      localStorage.setItem('gpa-tracker-help-seen', '1');
    } catch (e) {}
  }

  async function bootstrap() {
    await Auth.ready;
    try {
      var meta = await Db.loadStateWithMeta();
      state = meta.state;
      lastRevision = meta.revision;
      revisionKnown = meta.revisionKnown;
    } catch (e) {
      console.error(e);
      state = { version: 1, terms: [], courses: [], assessments: [] };
    }
    renderNavbar();
    render();
    maybeShowHelpOnFirstVisit();
  }
  bootstrap();
})();
