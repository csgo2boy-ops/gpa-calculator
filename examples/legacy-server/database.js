const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'gpa.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS Program (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE IF NOT EXISTS Term (id INTEGER PRIMARY KEY, name TEXT, sortOrder INTEGER);
  CREATE TABLE IF NOT EXISTS Course (
    id INTEGER PRIMARY KEY,
    termId INTEGER,
    code TEXT,
    title TEXT,
    credits REAL,
    gpaInclusion TEXT DEFAULT 'needs-review',
    officialMark REAL,
    officialGP REAL,
    crossSemesterPolicy TEXT DEFAULT 'unknown',
    targetGrade TEXT DEFAULT 'A'
  );
  CREATE TABLE IF NOT EXISTS Assessment (
    id INTEGER PRIMARY KEY,
    courseId INTEGER,
    name TEXT,
    assessmentGroup TEXT,
    weightPercent REAL,
    maxPoints REAL,
    earnedPoints REAL
  );
`);

// 自動升級資料庫結構：新增 targetGrade 欄位 (若已存在則忽略)
try {
  db.exec("ALTER TABLE Course ADD COLUMN targetGrade TEXT DEFAULT 'A';");
} catch (e) {
  // 欄位已存在，忽略錯誤
}

// 跨學期科目代碼（GPA 入帳待確認）
const CROSS_SEMESTER_CODES = ['ITE4116M', 'ITP4915M', 'ITP4523M', 'SDD4006M'];

// 正規化 crossSemesterPolicy：只有真正的跨學期科目才是 needs-review，
// 其餘單一學期科目為 single。修復舊資料「全部 unknown 導致 CGPA 永遠算不出」的問題。
// 用 try/catch 包住：即使資料庫唯讀（例如備份檔被設成唯讀），也不應讓伺服器崩潰，
// 讀取與既有功能仍可正常運作。
try {
  db.prepare('UPDATE Course SET crossSemesterPolicy = ? WHERE code IN (' + CROSS_SEMESTER_CODES.map(() => '?').join(',') + ')')
    .run('needs-review', ...CROSS_SEMESTER_CODES);
  db.prepare("UPDATE Course SET crossSemesterPolicy = 'single' WHERE crossSemesterPolicy = 'unknown'").run();
} catch (err) {
  console.warn('[database] 跳過 crossSemesterPolicy 正規化（資料庫可能唯讀）：' + err.message);
}

// 初始化真實 IT114105 資料 (若為空)
const count = db.prepare('SELECT COUNT(*) as c FROM Term').get().c;
if (count === 0) {
  const insertTerm = db.prepare('INSERT INTO Term (name, sortOrder) VALUES (?, ?)');
  const insertCourse = db.prepare('INSERT INTO Course (termId, code, title, credits, gpaInclusion, crossSemesterPolicy) VALUES (?, ?, ?, ?, ?, ?)');

  const terms = ['Semester 1', 'Semester 2', 'Semester 3', 'Semester 4', 'Semester 5'];
  terms.forEach((t, i) => insertTerm.run(t, i + 1));

  const courses = [
    // S1
    [1, 'ITP3914', 'Programming', 13, 'include'],
    [1, 'ITE3102', 'Network Fundamentals', 10, 'include'],
    [1, 'ITP3902', 'Discrete Mathematics and Statistics', 10, 'include'],
    [1, 'ITP3901', 'Operating Systems Fundamentals', 10, 'include'],
    [1, 'ITP4903', 'Database Principles', 10, 'include'],
    [1, 'LAN3107', 'Essential Workplace Communication: Effective Oral Interaction', 6, 'include'],
    [1, 'SDD4005', 'Whole Person Development: MindShift', 6, 'include'],
    // S2
    [2, 'ITP4522', 'Software Project Management & Quality Assurance', 13, 'include'],
    [2, 'ITP4915M', 'System Development Project', 6.5, 'needs-review'],
    [2, 'ITP4909', 'Object Oriented Technology', 13, 'include'],
    [2, 'ITP4510', 'Data Structures & Algorithms', 13, 'include'],
    [2, 'ITE3006', 'IT Essentials – Web', 6, 'include'],
    [2, 'ITP4523M', 'Internet & Multimedia Applications Development', 6.5, 'needs-review'],
    [2, 'LAN3108', 'Essential Workplace Communication: Digital Written Correspondence', 6, 'include'],
    [2, 'SDD4006M', 'Whole Person Development: Collaboration, Teamwork & Social Engagement', 3, 'needs-review'],
    // S3
    [3, 'ITP4501', 'Programming Techniques for Mobile Systems', 13, 'include'],
    [3, 'ITP4523M', 'Internet & Multimedia Applications Development', 6.5, 'needs-review'],
    [3, 'ITP4915M', 'System Development Project', 6.5, 'needs-review'],
    [3, 'SDD4006M', 'Whole Person Development: Collaboration, Teamwork & Social Engagement', 3, 'needs-review'],
    [3, 'LAN4103', 'Professional Workplace Communication: Proposal and Report Writing', 9, 'include'],
    [3, null, 'Enrichment Module B', 3, 'include'],
    // S4
    [4, 'ITE4103', 'IT Professionalism', 6, 'include'],
    [4, 'ITP4514', 'Artificial Intelligence and Machine Learning', 17, 'include'],
    [4, 'ITP4507', 'Contemporary Topics in Software Engineering', 13, 'include'],
    [4, 'ITE4116M', 'Final Year Project', 19, 'needs-review'],
    [4, 'LAN3003', '職業中文傳意：普通話對話與匯報', 6, 'include'],
    [4, null, 'Professional Workplace Communication: Storytelling and Job Search', 9, 'include'],
    // S5
    [5, 'ITP4506', 'Human Computer Interaction & GUI Programming', 13, 'include'],
    [5, 'ITP4511', 'Enterprise Systems Development', 13, 'include'],
    [5, 'ITE4116M', 'Final Year Project', 19, 'needs-review'],
    [5, null, 'Enrichment Module A', 6, 'include'],
    [5, null, 'Professional Workplace Communication: Pitching and Persuasive Presentation', 10, 'include'],
    [5, 'LAN4003', '職業中文傳意：普通話報告與紀實文書', 9, 'include'],
    [5, 'SDD4007', 'Whole Person Development: Enhancing Competencies in the 21st Century Workplace', 3, 'include']
  ];

  const insertMany = db.transaction((rows) => {
    for (const c of rows) {
      const isCross = CROSS_SEMESTER_CODES.includes(c[1]);
      const policy = c[1] === null ? 'single' : (isCross ? 'needs-review' : 'single');
      insertCourse.run(c[0], c[1], c[2], c[3], c[4], policy);
    }
  });
  insertMany(courses);
  console.log('Seeded database with IT114105 curriculum.');
}

module.exports = db;
