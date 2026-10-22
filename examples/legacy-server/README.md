# Legacy Express + SQLite Server（封存）

此資料夾保留舊版「本機 Express + SQLite」架構作為參考，**不會**用於 Cloudflare Pages 部署。

## 檔案
- `server.js` — Express API（/api/data、/api/assessment、/api/export…）
- `database.js` — better-sqlite3 建表與 IT114105 種子資料
- `engine.js` — CommonJS 版計算引擎（與前端 `public/engine.js` 邏輯相同）
- `index.html` — 舊版前端（依賴 /api/*）
- `package.json` — 舊版依賴（express、better-sqlite3、cors）

## 若要本機執行（僅供參考）
```bash
npm install
npm start   # http://127.0.0.1:3000
```

> 注意：此版本需要常駐 Node.js 行程並寫入 `gpa.sqlite`，無法部署至 Cloudflare Pages。
> 正式版本請使用專案根目錄的 `public/`（純前端 + localStorage）。
