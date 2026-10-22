/* =========================================================================
 * seed-data.js
 * 預設為「空白」，但提供一份「IT114105 範本課程」讓使用者自行選擇是否載入。
 * 以 UMD 方式匯出，可在瀏覽器（window.GpaSeed）與 Node.js（module.exports）使用。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GpaSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CROSS_SEMESTER_CODES = ['ITE4116M', 'ITP4915M', 'ITP4523M', 'SDD4006M'];

  var TEMPLATE_TERMS = [
    { id: 1, name: 'Semester 1', sortOrder: 1 },
    { id: 2, name: 'Semester 2', sortOrder: 2 },
    { id: 3, name: 'Semester 3', sortOrder: 3 },
    { id: 4, name: 'Semester 4', sortOrder: 4 },
    { id: 5, name: 'Semester 5', sortOrder: 5 }
  ];

  // [termId, code, title, credits, gpaInclusion]
  var TEMPLATE_COURSE_ROWS = [
    [1, 'ITP3914', 'Programming', 13, 'include'],
    [1, 'ITE3102', 'Network Fundamentals', 10, 'include'],
    [1, 'ITP3902', 'Discrete Mathematics and Statistics', 10, 'include'],
    [1, 'ITP3901', 'Operating Systems Fundamentals', 10, 'include'],
    [1, 'ITP4903', 'Database Principles', 10, 'include'],
    [1, 'LAN3107', 'Essential Workplace Communication: Effective Oral Interaction', 6, 'include'],
    [1, 'SDD4005', 'Whole Person Development: MindShift', 6, 'include'],
    [2, 'ITP4522', 'Software Project Management & Quality Assurance', 13, 'include'],
    [2, 'ITP4915M', 'System Development Project', 6.5, 'needs-review'],
    [2, 'ITP4909', 'Object Oriented Technology', 13, 'include'],
    [2, 'ITP4510', 'Data Structures & Algorithms', 13, 'include'],
    [2, 'ITE3006', 'IT Essentials – Web', 6, 'include'],
    [2, 'ITP4523M', 'Internet & Multimedia Applications Development', 6.5, 'needs-review'],
    [2, 'LAN3108', 'Essential Workplace Communication: Digital Written Correspondence', 6, 'include'],
    [2, 'SDD4006M', 'Whole Person Development: Collaboration, Teamwork & Social Engagement', 3, 'needs-review'],
    [3, 'ITP4501', 'Programming Techniques for Mobile Systems', 13, 'include'],
    [3, 'ITP4523M', 'Internet & Multimedia Applications Development', 6.5, 'needs-review'],
    [3, 'ITP4915M', 'System Development Project', 6.5, 'needs-review'],
    [3, 'SDD4006M', 'Whole Person Development: Collaboration, Teamwork & Social Engagement', 3, 'needs-review'],
    [3, 'LAN4103', 'Professional Workplace Communication: Proposal and Report Writing', 9, 'include'],
    [3, null, 'Enrichment Module B', 3, 'include'],
    [4, 'ITE4103', 'IT Professionalism', 6, 'include'],
    [4, 'ITP4514', 'Artificial Intelligence and Machine Learning', 17, 'include'],
    [4, 'ITP4507', 'Contemporary Topics in Software Engineering', 13, 'include'],
    [4, 'ITE4116M', 'Final Year Project', 19, 'needs-review'],
    [4, 'LAN3003', '職業中文傳意：普通話對話與匯報', 6, 'include'],
    [4, null, 'Professional Workplace Communication: Storytelling and Job Search', 9, 'include'],
    [5, 'ITP4506', 'Human Computer Interaction & GUI Programming', 13, 'include'],
    [5, 'ITP4511', 'Enterprise Systems Development', 13, 'include'],
    [5, 'ITE4116M', 'Final Year Project', 19, 'needs-review'],
    [5, null, 'Enrichment Module A', 6, 'include'],
    [5, null, 'Professional Workplace Communication: Pitching and Persuasive Presentation', 10, 'include'],
    [5, 'LAN4003', '職業中文傳意：普通話報告與紀實文書', 9, 'include'],
    [5, 'SDD4007', 'Whole Person Development: Enhancing Competencies in the 21st Century Workplace', 3, 'include']
  ];

  var TEMPLATE_ASSESSMENTS = [
    { id: 1, courseId: 3, name: '平時測驗 (CA Test)', assessmentGroup: 'CA', weightPercent: 30, maxPoints: 50, earnedPoints: 41 },
    { id: 2, courseId: 3, name: '導修作業與練習 (Tutorial Work)', assessmentGroup: '作業', weightPercent: 10, maxPoints: 10, earnedPoints: 10 },
    { id: 3, courseId: 3, name: '期末測驗 (EA Test)', assessmentGroup: 'EA', weightPercent: 30, maxPoints: null, earnedPoints: null },
    { id: 4, courseId: 3, name: '期末考試 (Final Examination)', assessmentGroup: '考試', weightPercent: 30, maxPoints: null, earnedPoints: null },
    { id: 5, courseId: 5, name: '平時測驗 (CA Test)', assessmentGroup: 'CA', weightPercent: 20, maxPoints: null, earnedPoints: null }
  ];

  function buildTemplateCourses() {
    return TEMPLATE_COURSE_ROWS.map(function (row, i) {
      var isCross = CROSS_SEMESTER_CODES.indexOf(row[1]) !== -1;
      return {
        id: i + 1, termId: row[0], code: row[1], title: row[2], credits: row[3],
        gpaInclusion: row[4], officialMark: null, officialGP: null,
        crossSemesterPolicy: isCross ? 'needs-review' : 'single', targetGrade: 'A'
      };
    });
  }

  return {
    CROSS_SEMESTER_CODES: CROSS_SEMESTER_CODES,
    // 預設空白
    terms: [],
    courses: [],
    assessments: [],
    // IT114105 可選範本
    template: {
      name: 'IT114105',
      terms: TEMPLATE_TERMS.map(function (t) { return Object.assign({}, t); }),
      courses: buildTemplateCourses(),
      assessments: TEMPLATE_ASSESSMENTS.map(function (a) { return Object.assign({}, a); })
    }
  };
});
