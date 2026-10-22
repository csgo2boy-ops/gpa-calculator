# GPA Tracker

A **100% client-side, offline-capable** GPA (Grade Point Average) tracker and calculator tailored for Hong Kong **VTC / IVE** programs, built for static deployment on **Cloudflare Pages**.

> 一款 100% 純前端、可離線運作的香港 VTC / IVE GPA 成績追蹤與試算工具，可直接部署於 Cloudflare Pages。

<p align="center">
  <img alt="Cloudflare Pages" src="https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/Vanilla%20JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black">
  <img alt="LocalStorage" src="https://img.shields.io/badge/Persistence-LocalStorage-4F46E5?style=for-the-badge">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge">
</p>

## Live Demo

🔗 **https://<你的專案名稱>.pages.dev**

> Replace the placeholder above with your own Cloudflare Pages URL after deployment.

---

## ✨ Features

- **Zero backend** — no Express, no SQLite, no API calls. Everything runs in the browser.
- **Offline by design** — self-contained HTML/CSS/JS with **no CDN dependencies**.
- **VTC / IVE grading rules** — A/A-/B+/…/F grade → grade point (GP) lookup table.
- **CA / EA dual threshold** — CA and EA each require 40% to pass, independently flagged.
- **Real-time target tracking** — shows the required average with **ceiling rounding** (e.g. 67.34% → 67.4%) so you never fall 0.02 short.
- **CGPA auto-computation** — weighted by credits, excluding cross-semester courses pending confirmation.
- **Data persistence** — everything is saved to localStorage, surviving page reloads.
- **Portable backup** — one-click JSON **export / import** for cross-device migration.
- **Traditional Chinese UI** — all labels in 繁體中文.

---

## 🚀 Getting Started

### Local preview (no install required)

方式一：直接用瀏覽器開啟 public/index.html（無需伺服器）。

方式二（推薦，避免 file:// 限制）：

~~~bash
npx --yes serve public
# 或
npx --yes http-server public
~~~

Then open http://localhost:3000 (or the printed URL).

### Run tests

~~~bash
node tests/engine.test.js
node tests/storage.test.js
# 或
npm test
~~~

---

## ☁️ Deploy to Cloudflare Pages

public/ is the deploy root and requires **no build step**.

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Set **Build command** to *(empty)* and **Build output directory** to public.
4. Deploy. Done.

Alternatively use Wrangler:

~~~bash
npx wrangler pages deploy public
~~~

---

## 📁 Project Structure

~~~text
gpa-tracker/
├── public/                    # Cloudflare Pages 部署根目錄（無構建）
│   ├── index.html             # 頁面結構
│   ├── styles.css             # 自足樣式（無 Tailwind CDN）
│   ├── seed-data.js           # IT114105 課程與評核種子資料
│   ├── engine.js              # 計算引擎（純函式，前後端通用）
│   ├── storage.js             # localStorage 持久化模組
│   └── app.js                 # UI 渲染與事件處理
├── tests/
│   ├── engine.test.js         # 計算引擎測試（含新舊引擎 2000 組對照）
│   └── storage.test.js        # 持久化模組測試
├── examples/
│   └── legacy-server/         # 封存的舊版 Express + SQLite 架構（僅供參考）
├── package.json
├── .gitignore
└── README.md
~~~

---

## 🧮 Grading & Calculation Rules

| Grade | Minimum Mark | Grade Point |
|------:|-------------:|------------:|
| A     | 75           | 4.0         |
| A-    | 70           | 3.7         |
| B+    | 67           | 3.3         |
| B     | 63           | 3.0         |
| B-    | 60           | 2.7         |
| C+    | 57           | 2.3         |
| C     | 53           | 2.0         |
| C-    | 50           | 1.7         |
| D+    | 46           | 1.3         |
| D     | 40           | 1.0         |
| F     | < 40         | 0.0         |

- **Weighted total** = Σ (score ÷ max × weight%).
- **CGPA** = Σ (GP × credits) ÷ Σ credits, over courses with gpaInclusion = include.
- **CA / EA thresholds**: both groups independently require 40%; incomplete groups report pending.
- **Target required average** = (target − locked) ÷ remaining-weight, ceiling-rounded to 0.1.
- **Cross-semester courses** (e.g. ITE4116M) are marked needs-review and excluded from CGPA until manually confirmed.

---

## 🗄️ Data & Privacy

All records live **only in your browser's localStorage** — nothing is ever uploaded to a server. Use the **匯出備份** button to download a JSON snapshot and **匯入備份** to restore it on another device.

---

## 📝 繁體中文功能說明

- **學期總覽**：左側顯示五個學期與各學期學分合計，以及 CGPA 覆蓋率。
- **科目卡片**：每個科目顯示已鎖定分數、已評分權重、最高可達分數，以及 CA/EA 獨立達標狀態。
- **目標追蹤**：可切換目標等級（A～D），即時顯示「剩餘評核平均需達 XX%」。
- **評核管理**：新增 / 編輯 / 刪除評核，內建防呆（得分不可大於滿分、權重需 0–100）。
- **官方成績**：可輸入校方公布的最終分數，供 CGPA 計算。
- **備份**：右上角「匯出備份」下載 JSON，「匯入備份」還原，「重設資料」回到預設課程結構。

---

## 🧪 Verification

The test suite asserts:

- Grade boundary values and the grade-point lookup table.
- Ceiling rounding (67.34% → 67.4%).
- CA/EA dual-threshold behaviour.
- Impossible-target detection.
- **2000 randomized cases** comparing the frontend engine against the archived legacy engine for 100% parity.
- localStorage load/save/import/export/round-trip.

---

## 📄 License

[MIT](LICENSE)

> 此專案之 IT114105 課程結構由使用者提供，僅供個人學業用途。
