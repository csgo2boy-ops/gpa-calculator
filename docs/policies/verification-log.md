# 官方規則核實紀錄 (Batch 2)
更新日期：2026-10-22
原則：逐項核實；未取得官方原文並核對者，一律 unknown；不套用其他院校規則；不跨版本混用。

## 核實等級
- verified：官方原文逐項核對（附 URL + 存取日期 + 摘錄）
- partial：部分核實（例如只有 programme 層級文件、或某欄位未涵蓋）
- unknown：未能核實（預設，不得套用）
- custom：使用者自訂

---

## 一、CUHK（香港中文大學）本科 — 2021/22 版本
來源：CUHK Undergraduate Student Handbook, General Regulations, Students Admitted in 2021-22
URL：https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/public/handbook/view_document.aspx?id=1835&lang=en&seq=1
存取日期：2026-10-22（全文可讀）

### 1.1 等級與 Grade Point（Reg 9.2）— VERIFIED
原文：
    A Excellent A 4.0
    A– Very Good A– 3.7
    B Good B+ 3.3
    B 3.0
    B- 2.7
    C Fair C+ 2.3
    C 2.0
    C- 1.7
    D Pass D+ 1.3
    D 1.0
    F Failure F 0.0
    DI Distinction / PA Pass / FA Failure / P Pass / U Failure
    → DI/PA/FA/P/U「not counted in the calculation of grade point average」

### 1.2 GPA 公式（Reg 9.2）— VERIFIED
原文：The grade point average ... shall be computed by dividing the total weighted converted points for courses taken by the total number of units attempted inclusive of courses failed, where the weighted converted points are converted points multiplied by the number of units of the course concerned.
→ GPA = Σ(積點 × 學分) / Σ(已修讀學分，包括不及格)。

### 1.3 重修與重讀（Reg 5.6–5.7、9.3）— VERIFIED
- 5.6：必修科不及格須重讀或修讀替代科目；可安排補考（視課程而定）。
- 5.7：已及格科目不得重讀，除非規例另有規定。
- 9.3：已及格但被要求重讀的科目，其學分只計一次。

### 1.4 出席及缺席（Reg 8）— PARTIAL
- 8.1–8.5：缺席須申請補做、病假超過一週須書面申請及醫生證明、非醫療請假須事先批准、請假上限兩年等。
- **大學層級並無統一數字出席門檻**（門檻可能由課程/學院另訂）→ attendanceThresholdPercent 保持 unknown。

### 1.5 畢業要求與學位分類（Reg 12–13）— VERIFIED（僅供參考，不進 GPA 引擎）
- 12.1(b)：主修科（2000 級或以上）GPA 不低於 1.5。
- 13.2 學位分類最低 GPA（Major / Overall）：
    First Class Honours: 3.50 / 3.30
    Second Class Honours Upper Division: 3.10 / 2.80
    Second Class Honours Lower Division: 2.50 / 2.00
    Third Class Honours: 1.50 / 1.50
    Pass
- 10.1/10.2：GPA < 1.5 學術警告；< 1.0 或半數科目不及格 → 停學程序。

### 1.6 分數 → 正式等級換算 — UNKNOWN
Reg 9.1 只說「按課程既定準則評核」，**未提供原始分數對應等級的通用換算表**。
→ scoreToGrade.available = false；GradingPolicyEngine 必須回傳 null，不得自行推斷。

### 1.7 適用範圍
- 2021/22 版本（id=1835）。

---

## 二、CUHK 本科 — 2026/27 版本（現行）
來源：General Regulations, Students Admitted in 2026-27
URL：https://rgsntl.rgs.cuhk.edu.hk/aqs_prd_applx/public/handbook/view_document.aspx?id=1765&lang=en&seq=1
存取日期：2026-10-22
- Reg 9.2 原文與 2021/22 **完全一致**（等級表、GPA 公式、DI/PA/FA/P/U 不計）。
- 因此 gradeScale、gpaRules 對 2026/27 亦 VERIFIED。
- **兩版本分別存為獨立 profile，不混用**（RuleResolver 只做精確年份/版本比對）。

---

## 三、VTC / IVE 高級文憑
來源：IVE (Haking Wong) — New Student Orientation, Higher Diploma in Professional Accountancy (BA114062)
URL：https://www.vtc.edu.hk/ive/hw/Temp/orientation/ba/114062.pdf
文件年份：August 2023（2023/24 入學）
適用範圍：**單一課程 BA114062**（programme-level 文件）；VTC 全校通用性未由中央規例確認。

### 3.1 等級與 Grade Point — PARTIAL（文字已核實，範圍為 programme-level）
原文表：
    Pass A  4.0  75 ≤ X ≤ 100
    Pass A– 3.7  70 ≤ X < 75
    Pass B+ 3.3  67 ≤ X < 70
    Pass B  3.0  63 ≤ X < 67
    Pass B– 2.7  60 ≤ X < 63
    Pass C+ 2.3  57 ≤ X < 60
    Pass C  2.0  53 ≤ X < 57
    Pass C– 1.7  50 ≤ X < 53
    Pass D+ 1.3  46 ≤ X < 50
    Pass D  1.0  40 ≤ X < 46
    Fail F  0.0  0 ≤ X < 40
    # No Grade Points conversion for Modules assessed on a Pass / Fail basis
→ 因文件只涵蓋一個課程，status = partial。

### 3.2 及格與補考 — PARTIAL
- 最低及格分數及等級：40% 及 D 級。
- 每個評核形式亦以 40% 為最低及格。
- 必須通過 End-of-Module Assessment 方可及格。
- 正常不設 reassessment；不及格須重讀該單元（特殊情況除外）。

### 3.3 出席 — PARTIAL
- 每個單元最低出席率 70%。
- 未達 70% 者不得參加 EA，亦不獲頒單元分數/等級。

### 3.4 GPA 公式 — UNKNOWN
文件只列 Award GPA (AGPA) 等級（Distinction ≥3.5、Credit 3.0–3.5、Pass 1.0–3.0），**未提供計算公式**。
→ gpaRules.formula = unknown；GpaAggregationEngine 不產生官方 GPA。

### 3.5 分數 → 等級 — PARTIAL
文件提供百分比分界對應 A–F，故 GradingPolicyEngine 可用；但因範圍為單一課程，status = partial。

---

## 四、仍未核實（保持 unknown）
- VTC 全校通用 Grade Scale / GPA 公式 / 重修替換規則。
- VTC 其他課程（BA114062 以外）的規則。
- CUHK 原始分數 → 等級換算。
- CUHK 出席數字門檻（大學層級未見）。
- 兩校以外的院校（一律 unknown）。

## 五、規則種子檔
- public/rules/cuhk-undergraduate-2021-22.json（gradeScale/gpaRules verified；repeatRules partial；scoreToGrade unknown；attendance partial）
- public/rules/cuhk-undergraduate-2026-27.json（同上）
- public/rules/vtc-higher-diploma-ba114062-2023.json（gradeScale/scoreToGrade/attendance/repeat partial；gpaRules unknown）

## 六、核實紀律
- 不把 UNKNOWN 一次改為 VERIFIED；每項獨立附來源。
- 不跨院校套用規則。
- 不跨入學年份/版本混用（RuleResolver 精確比對）。
