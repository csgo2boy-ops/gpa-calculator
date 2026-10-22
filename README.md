# GPA Tracker

A **100% client-side, offline-capable** GPA (Grade Point Average) tracker and calculator tailored for Hong Kong **VTC / IVE** programs. Deployed on **Cloudflare Pages**, with optional **Supabase**-backed user accounts and cloud sync.

> 一款 100% 純前端、可離線運作的香港 VTC / IVE GPA 成績追蹤與試算工具，部署於 Cloudflare Pages，並可選用 Supabase 提供使用者帳號與雲端同步。

<p align="center">
  <img alt="Cloudflare Pages" src="https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/Vanilla%20JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge">
</p>

## Live Demo

🔗 **https://<你的專案名稱>.pages.dev**

> Replace the placeholder above with your own Cloudflare Pages URL after deployment.

---

## ✨ Features

- **Zero backend server** — no Express, no SQLite; the static frontend talks directly to Supabase (Backend-as-a-Service) or runs fully offline.
- **Guest mode** — without an account, everything works offline with localStorage persistence.
- **User accounts & cloud sync** — sign up / sign in via Supabase Auth; grades are stored in your own Supabase project with row-level isolation (RLS).
- **VTC / IVE grading rules** — A/A-/B+/…/F grade → grade point (GP) lookup table.
- **CA / EA dual threshold** — CA and EA each require 40% to pass, independently flagged.
- **Real-time target tracking** — shows the required average with **ceiling rounding** (e.g. 67.34% → 67.4%) so you never fall 0.02 short.
- **CGPA auto-computation** — weighted by credits, excluding cross-semester courses pending confirmation.
- **Dual persistence** — guest data lives in localStorage; signed-in data syncs to Supabase, surviving reloads and devices.
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
node tests/db.test.js
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

## 🔐 雲端資料庫設定指南（Supabase）

要啟用「使用者帳號 + 雲端同步」，需建立一個免費的 Supabase 專案：

1. 到 [supabase.com](https://supabase.com) 註冊並 **New project**（選擇免費方案）。
2. 進入 **SQL Editor**，貼上專案根目錄的 `supabase_schema.sql` 並執行——它會建立 `semesters` / `courses` / `assessments` 三張資料表，並啟用 Row Level Security（每位使用者只能讀寫自己的資料）。
3. 到 **Project Settings → API**，複製 **Project URL** 與 **anon public key**。
4. 開啟 `public/config.js`，填入 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`。
5. 到 **Authentication → Providers → Email** 啟用 Email 認證（可關閉「確認 Email」以方便測試）。
6. （選用，Google 快捷登入）到 **Authentication → Providers → Google**，填入 Google Cloud 的 OAuth Client ID / Secret 並啟用；再到 **Authentication → URL Configuration → Redirect URLs**，加入你的網站網址（例如 `https://<專案>.pages.dev` 與本機 `http://localhost:3000`）。

> ⚠️ 安全提醒：只能使用「公開的」Anon / Publishable Key，**絕對不要**把 Service Role Key 放進前端（它可繞過 RLS，一旦外洩即代表所有使用者資料曝險）。

未填入設定時，網站會自動以「訪客模式」運作，完全不影響離線試算。

---

## 📁 Project Structure

~~~text
gpa-tracker/
├── public/                    # Cloudflare Pages 部署根目錄（無構建）
│   ├── index.html             # 頁面結構（含 Navbar 與 Auth Modal）
│   ├── styles.css             # 自足樣式
│   ├── config.js              # Supabase URL / Anon Key 設定（佔位）
│   ├── seed-data.js           # IT114105 課程與評核種子資料
│   ├── engine.js              # 計算引擎（純函式，前後端通用）
│   ├── storage.js             # localStorage 持久化模組（訪客模式）
│   ├── app.js                 # UI 渲染與事件處理（雙模整合）
│   └── js/
│       ├── auth.js            # Supabase 認證（登入 / 註冊 / 登出）
│       └── db.js              # 雙模資料層（雲端 vs localStorage）
├── tests/
│   ├── engine.test.js         # 計算引擎測試（含新舊引擎 2000 組對照）
│   ├── storage.test.js        # 持久化模組測試
│   └── db.test.js             # 雙模資料層與欄位對映測試
├── examples/
│   └── legacy-server/         # 封存的舊版 Express + SQLite 架構（僅供參考）
├── supabase_schema.sql        # Supabase 資料表與 RLS 腳本
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

- **Guest mode**: records live only in your browser's localStorage — nothing leaves your device.
- **Cloud mode**: records are stored in **your own Supabase project**, isolated per-user by Row Level Security. Other users cannot read your data.
- Use **匯出備份** to download a JSON snapshot and **匯入備份** to restore it.

---

## 📝 繁體中文功能說明

- **導覽列帳號區塊**：未登入顯示「登入 / 註冊」；已登入顯示 Email、「雲端同步正常」徽章與「登出」按鈕。
- **學期總覽**：左側顯示五個學期與各學期學分合計，以及 CGPA 覆蓋率。
- **科目卡片**：每個科目顯示已鎖定分數、已評分權重、最高可達分數，以及 CA/EA 獨立達標狀態。
- **目標追蹤**：可切換目標等級（A～D），即時顯示「剩餘評核平均需達 XX%」。
- **評核管理**：新增 / 編輯 / 刪除評核，內建防呆（得分不可大於滿分、權重需 0–100）。
- **官方成績**：可輸入校方公布的最終分數，供 CGPA 計算。
- **訪客同步提示**：登入後若偵測到本地暫存資料，會詢問是否同步至雲端帳號。
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
- Dual-mode data layer: state ↔ row mapping (snake_case), null handling, guest-mode fallback.

---

## 📄 License

[MIT](LICENSE)

> 此專案之 IT114105 課程結構由使用者提供，僅供個人學業用途。
