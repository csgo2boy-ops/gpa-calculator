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
  }
  async function persist() {
    try {
      await Db.persist(state);
      if (Auth.isLoggedIn()) setSyncStatus('ok');
    } catch (e) {
      console.error(e);
      if (Auth.isLoggedIn()) setSyncStatus('error');
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
      '<p class="empty-desc">尚未新增任何學期。先新增一個學期，再於該學期下新增科目與評核。</p>' +
      '<button class="btn btn-primary" onclick="window.__gpa.openTermModal()">＋ 新增第一個學期</button>' +
    '</div>';
  }

  function render() {
    if (!state) return;
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

    var container = document.getElementById('course-container');
    if (terms.length === 0) {
      container.innerHTML = renderEmptyState();
      calculateCGPA();
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
  }
  function closeTermModal() {
    document.getElementById('term-modal').classList.add('hidden');
    document.getElementById('term-modal').classList.remove('flex');
  }
  document.getElementById('term-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = document.getElementById('term-name').value.trim();
    if (!name) { alert('請輸入學期名稱。'); return; }
    var maxOrder = state.terms.reduce(function (m, t) { return Math.max(m, t.sortOrder || 0); }, 0);
    state.terms.push({ id: Storage.nextId(state.terms), name: name, sortOrder: maxOrder + 1 });
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
    if (!title) { alert('請輸入科目名稱。'); return; }
    if (isNaN(credits) || credits < 0) { alert('學分必須是非負數。'); return; }
    state.courses.push({
      id: Storage.nextId(state.courses),
      termId: termId,
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

    if (isNaN(weightPercent) || weightPercent < 0 || weightPercent > 100) { alert('權重必須是 0 至 100 之間的數字。'); return; }
    var maxStr = document.getElementById('form-max').value;
    var maxPoints = maxStr === '' ? null : parseFloat(maxStr);
    var earnedStr = document.getElementById('form-earned').value;
    var earnedPoints = earnedStr === '' ? null : parseFloat(earnedStr);
    if (earnedPoints !== null && earnedPoints < 0) { alert('得分不可小於 0。'); return; }
    if (earnedPoints !== null && maxPoints !== null && earnedPoints > maxPoints) { alert('得分不可大於滿分，請檢查後再儲存。'); return; }

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
      state.assessments.push({
        id: Storage.nextId(state.assessments),
        courseId: courseId, name: name.trim(), assessmentGroup: assessmentGroup,
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
    if (isNaN(newCredits) || newCredits < 0) { alert('請輸入有效的非負數！'); return; }
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
    if (mark !== null && (isNaN(mark) || mark < 0 || mark > 100)) { alert('請輸入 0 至 100 之間的有效數字。'); return; }
    course.officialMark = mark;
    course.officialGP = mark === null ? null : Engine.getGrade(mark).gp;
    await commit();
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
      catch (err) { alert('無法解析 JSON 檔案，請確認是正確的備份檔。'); fileInput.value = ''; return; }
      var result = Storage.importJson(data);
      if (!result.ok) { alert(result.error); }
      else { state = result.state; await commit(); alert('匯入成功：' + state.terms.length + ' 學期、' + state.courses.length + ' 科目、' + state.assessments.length + ' 評核。'); }
      fileInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }
  async function resetData() {
    if (!confirm('確定要清空目前所有資料嗎？（學期、科目、評核都會被刪除）此動作無法復原。')) return;
    state = { version: 1, terms: [], courses: [], assessments: [] };
    await commit();
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
  }
  function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.getElementById('auth-modal').classList.remove('flex');
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

  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', function () { document.getElementById('import-file').click(); });
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('btn-reset').addEventListener('click', resetData);

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
    closeCourseModal: closeCourseModal
  };

  // ---------- 認證狀態監聽 ----------
  Auth.onAuthChange(async function (user, event) {
    renderNavbar();
    if (event === 'SIGNED_IN') {
      try {
        if (Db.hasLocalData()) {
          var ok = confirm('偵測到本地暫存資料，是否將成績同步至您的雲端帳號？');
          if (ok) await Db.syncLocalToCloud(Db.readLocalState());
        }
        state = await Db.loadState();
        render();
      } catch (e) { console.error(e); }
    } else if (event === 'SIGNED_OUT') {
      try { state = await Db.loadState(); render(); } catch (e) { console.error(e); }
    }
  });

  // ---------- 啟動 ----------
  async function bootstrap() {
    await Auth.ready;
    try { state = await Db.loadState(); }
    catch (e) { console.error(e); state = { version: 1, terms: [], courses: [], assessments: [] }; }
    renderNavbar();
    render();
  }
  bootstrap();
})();
