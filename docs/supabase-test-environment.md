# 獨立 Supabase 測試環境指引（Batch 1.2 / 2.0）
日期：2026-10-22
原則：只用獨立測試專案；不改正式專案；不要把高權限密鑰貼到聊天。

---

## 0. 安全規則（重要）
- 不要提供 Service Role Key、資料庫密碼、或任何高權限密鑰到聊天。
- 只需要：Project URL 與 anon (publishable) key（本來就會出現在前端，屬公開資訊）。
- 測試用帳號由你在測試專案自行建立。
- 若你不想提供任何金鑰，也可完全自行在 Supabase SQL Editor 執行，我只提供 SQL 與預期結果。

---

## 1. 建立獨立測試專案（你自行在 Dashboard 操作）
1. Supabase Dashboard → New project。
2. 名稱：gpa-tracker-test（與正式分開）。
3. Region 任選；Free plan 即可。
4. 建立完成後，記下：
   - Project URL（Settings → API）
   - anon public key（Settings → API）
5. 關閉「Confirm email」（Settings → Authentication）以便建立測試帳號。
6. 建立兩個測試帳號（A、B）用於 RLS 測試；記下其 user_id（Authentication → Users）。

---

## 2. Migration 執行次序（在 SQL Editor 逐個執行）
> 順序不可顛倒；每個檔案都可重複執行（idempotent）。

1. supabase_schema.sql
   - 建立 semesters / courses / assessments 與基本 RLS。
   - 若測試專案已有表，可跳過或先確認。
2. supabase/migrations/001_batch1_1_data_safety.sql
   - updated_at、uid、gpa_user_state、gpa_read_snapshot、gpa_replace_snapshot、權限。
3. supabase/migrations/002_batch2_rule_profiles.sql（Batch 2，尚未實作）
   - rule_profiles、user_rule_bindings、courses.rule_profile_id、RLS。
4. 每步執行後，用第 3 節的 SQL 驗證。

---

## 3. 驗證 SQL 與預期結果
### 3.1 Batch 1.2
直接執行：supabase/tests/batch1_2_sql_test_plan.sql
涵蓋 T1–T10，預期結果已寫在該檔註解。

### 3.2 關鍵人工檢查（摘要）
    -- uid 非空
    select count(*) from public.semesters   where uid is null;   -- 0
    -- state 回填
    select count(*) from public.gpa_user_state;                  -- >= 有資料的用戶數
    -- 函式存在
    select proname from pg_proc where proname in ('gpa_read_snapshot','gpa_replace_snapshot');
    -- 權限：anon 不可執行
    select has_function_privilege('anon','public.gpa_read_snapshot()','execute');  -- false
    select has_function_privilege('authenticated','public.gpa_read_snapshot()','execute'); -- true
    -- 必填 revision
    select public.gpa_replace_snapshot('[]'::jsonb,'[]'::jsonb,'[]'::jsonb,null);  -- ERROR

### 3.3 Batch 2（當 002 完成後）
    -- 規則表存在且 RLS 啟用
    select relname, relrowsecurity from pg_class where relname in ('rule_profiles','user_rule_bindings');
    -- 普通使用者不可寫規則（以 authenticated 角色 + 測試 JWT 執行）
    -- 預期：new row violates row-level security policy / permission denied

---

## 4. 交易與並發驗證（人工）
1. 開兩個 psql/SQL session（或用兩個應用實例）。
2. 兩個 session 皆以同一測試使用者身分呼叫 gpa_replace_snapshot（同一 expected revision）。
3. 其中一個先 commit；另一個應取得 conflict=true（current_revision 已遞增）。
4. 預期：不會出現部分寫入；後者不覆蓋前者。

---

## 5. 回滾方案
- 測試專案：最簡單是整個專案刪除（不影響正式）。
- 若共用專案（不建議）：
  - 每個 migration 只用 CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS；
  - 回滾以交易包裹：BEGIN; ...ROLLBACK; 先驗證再正式套用；
  - 需要移除時：drop function / drop table / drop column（依 001/002 順序反向）。
- 正式專案：本階段一律不執行任何 migration。

---

## 6. 我需要的回報（讓我能確認 DB 層）
1. T1–T10 的實際輸出（貼文字即可）。
2. has_function_privilege 兩個布林值。
3. null revision 的錯誤訊息。
4. 兩次 RPC 的 JSON 結果（含 conflict）。
5. 並發測試的觀察結果。

在收到上述實際輸出前，本專案不會宣稱「資料庫層已驗證」。
