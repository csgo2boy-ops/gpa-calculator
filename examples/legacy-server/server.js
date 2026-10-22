const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { calculateCourse, getGrade, getMarkFromGrade } = require('./engine');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 驗證工具 ----------
const GROUPS = ['CA', 'EA', '作業', '專題', '考試', '其他'];
const GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'];
const INCLUSIONS = ['include', 'exclude', 'needs-review'];

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function courseExists(id) {
  return db.prepare('SELECT id FROM Course WHERE id = ?').get(id) !== undefined;
}

function fail(res, status, error) {
  return res.status(status).json({ error });
}

// ---------- 1. 獲取所有資料 ----------
app.get('/api/data', (req, res) => {
  const terms = db.prepare('SELECT * FROM Term ORDER BY sortOrder').all();
  const courses = db.prepare('SELECT * FROM Course').all();
  const assessments = db.prepare('SELECT * FROM Assessment').all();

  const coursesWithStats = courses.map(c => {
    const cAssessments = assessments.filter(a => a.courseId === c.id);
    const stats = calculateCourse(cAssessments, c.targetGrade || 'A');
    return { ...c, assessments: cAssessments, stats };
  });

  res.json({ terms, courses: coursesWithStats });
});

// ---------- 2. 新增或更新評核 ----------
app.post('/api/assessment', (req, res) => {
  const { id, courseId, name, assessmentGroup, weightPercent, maxPoints, earnedPoints } = req.body || {};

  // 型別與存在性驗證
  if (!courseId || !courseExists(courseId)) {
    return fail(res, 400, '科目不存在，請重新整理後再試。');
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return fail(res, 400, '評核名稱不可為空。');
  }
  if (!GROUPS.includes(assessmentGroup)) {
    return fail(res, 400, '組別無效。');
  }

  const weight = numOrNull(weightPercent);
  if (weight === null || weight < 0 || weight > 100) {
    return fail(res, 400, '權重必須是 0 至 100 之間的數字。');
  }

  const max = numOrNull(maxPoints);
  const earned = numOrNull(earnedPoints);
  if (max !== null && max <= 0) {
    return fail(res, 400, '滿分必須大於 0，或留空表示未知。');
  }
  if (earned !== null) {
    if (earned < 0) return fail(res, 400, '得分不可小於 0。');
    if (max !== null && earned > max) return fail(res, 400, '得分不可大於滿分。');
  }
  if (max === null && earned !== null) {
    // 有得分但無滿分：允許，但會被視為「未完整評分」，僅提醒不阻擋
  }

  try {
    if (id) {
      const existing = db.prepare('SELECT id FROM Assessment WHERE id = ?').get(id);
      if (!existing) return fail(res, 404, '找不到要編輯的評核。');
      db.prepare('UPDATE Assessment SET name=?, assessmentGroup=?, weightPercent=?, maxPoints=?, earnedPoints=? WHERE id=?')
        .run(name.trim(), assessmentGroup, weight, max, earned, id);
    } else {
      db.prepare('INSERT INTO Assessment (courseId, name, assessmentGroup, weightPercent, maxPoints, earnedPoints) VALUES (?, ?, ?, ?, ?, ?)')
        .run(courseId, name.trim(), assessmentGroup, weight, max, earned);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    fail(res, 500, error.message);
  }
});

// ---------- 3. 刪除評核 ----------
app.delete('/api/assessment/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM Assessment WHERE id=?').run(req.params.id);
    if (info.changes === 0) return fail(res, 404, '找不到要刪除的評核。');
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    fail(res, 500, error.message);
  }
});

// ---------- 4. 更新科目最終成績 (官方確認) ----------
app.post('/api/course/:id/confirm', (req, res) => {
  const { officialMark, gpaInclusion } = req.body || {};

  if (!courseExists(req.params.id)) return fail(res, 404, '科目不存在。');
  if (!INCLUSIONS.includes(gpaInclusion)) return fail(res, 400, 'GPA 計入選項無效。');

  const mark = numOrNull(officialMark);
  if (mark !== null && (mark < 0 || mark > 100)) {
    return fail(res, 400, '官方分數必須介於 0 至 100 之間。');
  }

  const officialGP = mark === null ? null : getGrade(mark).gp;
  db.prepare('UPDATE Course SET officialMark=?, officialGP=?, gpaInclusion=? WHERE id=?')
    .run(mark, officialGP, gpaInclusion, req.params.id);
  res.json({ success: true, officialMark: mark, officialGP });
});

// ---------- 5. 更新科目學分 ----------
app.post('/api/course/:id/credits', (req, res) => {
  const { credits } = req.body || {};
  const c = numOrNull(credits);
  if (!courseExists(req.params.id)) return fail(res, 404, '科目不存在。');
  if (c === null || c < 0) return fail(res, 400, '學分必須是非負數。');
  db.prepare('UPDATE Course SET credits = ? WHERE id = ?').run(c, req.params.id);
  res.json({ success: true });
});

// ---------- 6. 更新科目目標 Grade ----------
app.post('/api/course/:id/target', (req, res) => {
  const { targetGrade } = req.body || {};
  if (!courseExists(req.params.id)) return fail(res, 404, '科目不存在。');
  if (!GRADES.includes(targetGrade)) return fail(res, 400, '目標等級無效。');
  db.prepare('UPDATE Course SET targetGrade = ? WHERE id = ?').run(targetGrade, req.params.id);
  res.json({ success: true });
});

// ---------- 7. 匯出備份 ----------
app.get('/api/export', (req, res) => {
  const data = {
    exportedAt: new Date().toISOString(),
    terms: db.prepare('SELECT * FROM Term').all(),
    courses: db.prepare('SELECT * FROM Course').all(),
    assessments: db.prepare('SELECT * FROM Assessment').all()
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="gpa-backup.json"');
  res.send(JSON.stringify(data, null, 2));
});

// ---------- 8. 匯入還原備份 ----------
app.post('/api/import', (req, res) => {
  const data = req.body || {};
  if (!Array.isArray(data.terms) || !Array.isArray(data.courses) || !Array.isArray(data.assessments)) {
    return fail(res, 400, '備份格式無效：需包含 terms / courses / assessments 陣列。');
  }

  const insertTerm = db.prepare('INSERT INTO Term (id, name, sortOrder) VALUES (?, ?, ?)');
  const insertCourse = db.prepare('INSERT INTO Course (id, termId, code, title, credits, gpaInclusion, officialMark, officialGP, crossSemesterPolicy, targetGrade) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertAssessment = db.prepare('INSERT INTO Assessment (id, courseId, name, assessmentGroup, weightPercent, maxPoints, earnedPoints) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const runImport = db.transaction(() => {
    db.prepare('DELETE FROM Assessment').run();
    db.prepare('DELETE FROM Course').run();
    db.prepare('DELETE FROM Term').run();

    for (const t of data.terms) {
      insertTerm.run(t.id, t.name, t.sortOrder ?? 0);
    }
    for (const c of data.courses) {
      insertCourse.run(
        c.id, c.termId, c.code ?? null, c.title, c.credits ?? 0,
        c.gpaInclusion ?? 'needs-review', c.officialMark ?? null, c.officialGP ?? null,
        c.crossSemesterPolicy ?? 'unknown', c.targetGrade ?? 'A'
      );
    }
    for (const a of data.assessments) {
      insertAssessment.run(a.id, a.courseId, a.name, a.assessmentGroup, a.weightPercent ?? 0, a.maxPoints ?? null, a.earnedPoints ?? null);
    }
  });

  try {
    runImport();
    res.json({ success: true, imported: { terms: data.terms.length, courses: data.courses.length, assessments: data.assessments.length } });
  } catch (error) {
    console.error(error);
    fail(res, 500, '匯入失敗：' + error.message);
  }
});

// ---------- 統一錯誤處理（回傳 JSON 而非 HTML） ----------
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(err);
  res.status(status).json({ error: err.message || '伺服器錯誤' });
});

const PORT = 3000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`GPA Tracker running at http://127.0.0.1:${PORT}`);
});
