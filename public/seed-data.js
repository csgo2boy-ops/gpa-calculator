/* =========================================================================
 * seed-data.js
 * 種子資料：預設為「空白」——不內建任何課程。
 * 使用者需自行新增學期、科目與評核，方便不同課程／學校的人使用。
 * 以 UMD 方式匯出，可在瀏覽器（window.GpaSeed）與 Node.js（module.exports）使用。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GpaSeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    // 跨學期科目代碼（保留欄位供未來擴充；預設不啟用）
    CROSS_SEMESTER_CODES: [],
    terms: [],
    courses: [],
    assessments: []
  };
});
