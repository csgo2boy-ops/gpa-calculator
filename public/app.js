/* =========================================================================
 * app.js
 * 前端主程式：渲染、事件綁定、資料編輯與即時試算。
 * 完全在瀏覽器端運作，不發送任何網路請求。
 * 依賴：GpaSeed（種子資料）、GpaEngine（計算）、GpaStorage（持久化）。
 * ========================================================================= */
(function () {
  'use strict';

  var Engine = window.GpaEngine;
  var Storage = window.GpaStorage;
  if (!Engine || !Storage) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML = '<div style="padding:2rem;color:#991b1b;font-family:sans-serif">載入失敗：缺少必要的腳本（engine.js / storage.js）。</div>';
    });
    return;
  }

  var GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'];
  var state = Storage.load();

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

  function persist() {
    Storage.save(state);
  }

  // ---------- 渲染 ----------
  function groupBadge(label, g) {
    if (!g || g.weight <= 0) return '';
    if (g.pass === 'pending') {
      return '<span class="badge badge-pending">⏳ ' + label + ' 待評分</span>';
    }
    var pct = g.percentage !== null ? g.percentage.toFixed(1) : '--';
    if (g.pass === false) {
      return '<span class="badge badge-danger">✗ ' + label + ' 未達標 (' + pct + '%)</span>';
    }
    return '<span class="badge badge-emerald">✓ ' + label + ' 已達標 (' + pct + '%)</span>';
  }

  function render() {
    var termList = document.getElementById('term-list');
    var terms = state.terms.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

    termList.innerHTML = terms.map(function (t) {
      var tCourses = state.courses.filter(function (c) { return c.termId === t.id; });
      var totalCredits = tCourses.reduce(function (sum, c) { return sum + (Number(c.credits) || 0); }, 0);
      return '<li class="term-item">' +
        '<span class="term-name">' + escapeHtml(t.name) + '</span>' +
        '<span class="term-credits">' + totalCredits + ' cr</span>' +
      '</li>';
    }).join('');

    var container = document.getElementById('course-container');

    var html = terms.map(function (t) {
      var tCourses = state.courses.filter(function (c) { return c.termId === t.id; });
      if (tCourses.length === 0) return '';

      var semesterHeader = '<div class="semester-header">' +
        '<span class="semester-bar"></span>' +
        '<span class="semester-title">' + escapeHtml(t.name) + '</span>' +
      '</div>';

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
    document.getElementById('cgpa-display').innerText = cgpa;
    document.getElementById('cgpa-coverage').innerText = '覆蓋學分: ' + totalCredits + ' / ' + totalIncludeCredits;
  }

  // ---------- Modal ----------
  var modal = document.getElementById('assessment-modal');
  var form = document.getElementById('assessment-form');

  function openModal(courseId, editData) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (editData) {
      document.getElementById('modal-title').innerText = '編輯評核項目';
      document.getElementById('form-id').value = editData.id;
      document.getElementById('form-courseId').value = courseId;
      document.getElementById('form-name').value = editData.name;
      document.getElementById('form-group').value = editData.assessmentGroup;
      document.getElementById('form-weight').value = editData.weightPercent;
      document.getElementById('form-max').value = editData.maxPoints > 0 ? editData.maxPoints : '';
      document.getElementById('form-earned').value = editData.earnedPoints !== null ? editData.earnedPoints : '';
    } else {
      document.getElementById('modal-title').innerText = '新增評核項目';
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = document.getElementById('form-id').value;
    var courseId = parseInt(document.getElementById('form-courseId').value, 10);
    var name = document.getElementById('form-name').value;
    var assessmentGroup = document.getElementById('form-group').value;
    var weightPercent = parseFloat(document.getElementById('form-weight').value);

    if (isNaN(weightPercent) || weightPercent < 0 || weightPercent > 100) {
      alert('權重必須是 0 至 100 之間的數字。');
      return;
    }

    var maxStr = document.getElementById('form-max').value;
    var maxPoints = maxStr === '' ? null : parseFloat(maxStr);
    var earnedStr = document.getElementById('form-earned').value;
    var earnedPoints = earnedStr === '' ? null : parseFloat(earnedStr);

    if (earnedPoints !== null && earnedPoints < 0) {
      alert('得分不可小於 0。');
      return;
    }
    if (earnedPoints !== null && maxPoints !== null && earnedPoints > maxPoints) {
      alert('得分不可大於滿分，請檢查後再儲存。');
      return;
    }

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
        courseId: courseId,
        name: name.trim(),
        assessmentGroup: assessmentGroup,
        weightPercent: weightPercent,
        maxPoints: maxPoints,
        earnedPoints: earnedPoints
      });
    }
    persist();
    closeModal();
    render();
  });

  function deleteAssessment(id) {
    if (!confirm('確定要刪除這筆評核紀錄嗎？刪除後無法復原。')) return;
    state.assessments = state.assessments.filter(function (a) { return a.id !== id; });
    persist();
    render();
  }

  function updateTarget(courseId, targetGrade) {
    var c = state.courses.find(function (x) { return x.id === courseId; });
    if (c) { c.targetGrade = targetGrade; persist(); render(); }
  }

  function editCredits(courseId, currentCredits) {
    var newCreditsStr = prompt('請輸入新的學分數 (可輸入小數):', currentCredits);
    if (newCreditsStr === null) return;
    var newCredits = parseFloat(newCreditsStr);
    if (isNaN(newCredits) || newCredits < 0) {
      alert('請輸入有效的非負數！');
      return;
    }
    var c = state.courses.find(function (x) { return x.id === courseId; });
    if (c) { c.credits = newCredits; persist(); render(); }
  }

  function confirmCourse(courseId) {
    var course = state.courses.find(function (c) { return c.id === courseId; });
    if (!course) return;
    var markStr = prompt('請輸入校方公布的科目最終分數 (0-100)，留空可清除:', course.officialMark !== null && course.officialMark !== undefined ? course.officialMark : '');
    if (markStr === null) return;
    var trimmed = markStr.trim();
    var mark = trimmed === '' ? null : parseFloat(trimmed);
    if (mark !== null && (isNaN(mark) || mark < 0 || mark > 100)) {
      alert('請輸入 0 至 100 之間的有效數字。');
      return;
    }

    var gpaInclusion = 'include';
    if (['SDD4005', 'SDD4006M', 'SDD4007', 'LAN3107', 'LAN3108'].indexOf(course.code) !== -1) {
      if (confirm('此科目是否為 Pass/Fail 不計 GPA 科目？(確定=不計入，取消=計入)')) gpaInclusion = 'exclude';
    }

    course.officialMark = mark;
    course.officialGP = mark === null ? null : Engine.getGrade(mark).gp;
    course.gpaInclusion = gpaInclusion;
    persist();
    render();
  }

  // ---------- 匯出 / 匯入 / 重設 ----------
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
    if (!confirm('匯入會覆蓋目前所有資料，確定要繼續嗎？建議先匯出目前備份。')) {
      fileInput.value = '';
      return;
    }
    var file = fileInput.files[0];
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (err) { alert('無法解析 JSON 檔案，請確認是正確的備份檔。'); fileInput.value = ''; return; }
      var result = Storage.importJson(data);
      if (!result.ok) {
        alert(result.error);
      } else {
        state = result.state;
        persist();
        render();
        alert('匯入成功：' + state.terms.length + ' 學期、' + state.courses.length + ' 科目、' + state.assessments.length + ' 評核。');
      }
      fileInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  function resetData() {
    if (!confirm('確定要清除目前所有資料，並還原為預設課程結構嗎？此動作無法復原。')) return;
    Storage.clear();
    state = Storage.load();
    render();
  }

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
    } else if (action === 'del-assess') {
      deleteAssessment(id);
    }
  });

  document.getElementById('btn-export').addEventListener('click', exportBackup);
  document.getElementById('btn-import').addEventListener('click', function () { document.getElementById('import-file').click(); });
  document.getElementById('import-file').addEventListener('change', importBackup);
  document.getElementById('btn-reset').addEventListener('click', resetData);

  // 暴露給 inline onclick（渲染出的按鈕用）
  window.__gpa = {
    editCredits: editCredits,
    updateTarget: updateTarget,
    openModal: openModal,
    closeModal: closeModal,
    confirmCourse: confirmCourse
  };

  // ---------- 啟動 ----------
  render();
})();
