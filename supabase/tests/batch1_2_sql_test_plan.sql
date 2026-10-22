-- =====================================================================
-- GPA Tracker 2.0 — Batch 1.2 SQL 測試方案（獨立、可重複、預期結果）
--
-- 重要：
--   * 只可在「測試 Supabase 專案」執行，絕不可在正式資料庫執行。
--   * 執行前請先跑 migration：001_batch1_1_data_safety.sql
--   * 需準備兩個測試帳號 A / B（各自取得 JWT / user_id）。
--   * 本檔只做「檢查與示範」；涉及寫入的步驟都包在 BEGIN ... ROLLBACK。
-- =====================================================================

-- ---------------------------------------------------------------------
-- T1. 結構檢查：uid 欄位存在、非 null、唯一
-- 預期：四項結果皆為 0 / 無列
-- ---------------------------------------------------------------------
select count(*) as semesters_null_uid from public.semesters   where uid is null;   -- 預期 0
select count(*) as courses_null_uid   from public.courses     where uid is null;   -- 預期 0
select count(*) as assessments_null_uid from public.assessments where uid is null; -- 預期 0

select indexname from pg_indexes
where schemaname = 'public'
  and indexname in ('semesters_user_uid_idx','courses_user_uid_idx','assessments_user_uid_idx');
-- 預期：3 列

-- ---------------------------------------------------------------------
-- T2. 唯一約束：同一 user 不可有重複 uid
-- 預期：ERROR duplicate key（若無重複資料則不報錯）
-- ---------------------------------------------------------------------
-- begin;
-- insert into public.semesters(user_id, local_id, uid, name, sort_order)
--   values ('<USER_A_ID>', 1, gen_random_uuid(), 'x', 1);
-- insert into public.semesters(user_id, local_id, uid, name, sort_order)
--   values ('<USER_A_ID>', 2, (select uid from public.semesters where user_id='<USER_A_ID>' limit 1), 'y', 2);
-- -- 預期：ERROR: duplicate key value violates unique constraint "semesters_user_uid_idx"
-- rollback;

-- ---------------------------------------------------------------------
-- T3. gpa_user_state 回填：有資料的帳號應有 revision 列
-- 預期：has_data_users 與 users_with_state 相符（或後者 >= 前者）
-- ---------------------------------------------------------------------
select count(distinct user_id) as users_with_data from (
  select user_id from public.semesters
  union select user_id from public.courses
  union select user_id from public.assessments
) t;

select count(*) as users_with_state from public.gpa_user_state;  -- 預期 >= 上一結果

-- ---------------------------------------------------------------------
-- T4. 權限：anon 不可呼叫 RPC（只允許 authenticated）
-- 預期：兩者皆為 false
-- ---------------------------------------------------------------------
select has_function_privilege('anon', 'public.gpa_read_snapshot()', 'execute') as anon_read;      -- 預期 false
select has_function_privilege('anon',
  'public.gpa_replace_snapshot(jsonb,jsonb,jsonb,bigint)', 'execute') as anon_write;               -- 預期 false
select has_function_privilege('authenticated', 'public.gpa_read_snapshot()', 'execute') as auth_read; -- 預期 true

-- ---------------------------------------------------------------------
-- T5. RLS：使用者 A 不可讀取使用者 B 的資料
-- 以 A 的 JWT 連線（或 set role authenticated + 設定 claims）後執行：
-- 預期：只會看到自己 user_id 的列（B 的列數為 0）
-- ---------------------------------------------------------------------
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<USER_A_ID>"}';
-- select count(*) from public.semesters where user_id = '<USER_B_ID>';  -- 預期 0

-- ---------------------------------------------------------------------
-- T6. Trigger：updated_at 會在 update 時自動更新
-- 預期：updated_at 改變
-- ---------------------------------------------------------------------
-- begin;
-- insert into public.semesters(user_id, local_id, uid, name, sort_order)
--   values ('<USER_A_ID>', 900, gen_random_uuid(), 'trigger-test', 1);
-- select updated_at as before from public.semesters where user_id='<USER_A_ID>' and local_id=900;
-- update public.semesters set name='trigger-test-2' where user_id='<USER_A_ID>' and local_id=900;
-- select updated_at as after from public.semesters where user_id='<USER_A_ID>' and local_id=900;
-- -- 預期：after > before
-- rollback;

-- ---------------------------------------------------------------------
-- T7. 原子讀取：gpa_read_snapshot 回傳 has_state / revision / 三陣列
-- 以 A 的 JWT 執行：
-- 預期：jsonb 含 has_state、revision、semesters、courses、assessments 四個鍵
-- ---------------------------------------------------------------------
-- select public.gpa_read_snapshot();
-- -- 預期範例：{"has_state":true,"revision":3,"semesters":[...],"courses":[...],"assessments":[...]}

-- ---------------------------------------------------------------------
-- T8. p_expected_revision 必填：傳 null 必須報錯
-- 預期：ERROR: p_expected_revision is required
-- ---------------------------------------------------------------------
-- select public.gpa_replace_snapshot('[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null);
-- -- 預期：ERROR: p_expected_revision is required

-- ---------------------------------------------------------------------
-- T9. 版本衝突：用舊 revision 寫入必須回 conflict
-- 以 A 的 JWT 執行：
-- 預期：第一次 ok=true、revision=N+1；第二次帶舊 N 回 conflict=true
-- ---------------------------------------------------------------------
-- select public.gpa_replace_snapshot('[{"local_id":1,"uid":"<UUID>","name":"S1","sort_order":1}]'::jsonb,
--   '[]'::jsonb, '[]'::jsonb, 0);
-- -- 預期：{"ok":true,"revision":1}
-- select public.gpa_replace_snapshot('[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0);
-- -- 預期：{"ok":false,"conflict":true,"current_revision":1}

-- ---------------------------------------------------------------------
-- T10. 原子性（手動併發）
-- 準備兩個 SQL session（A、B），皆以同一使用者 JWT：
--   Session A: begin; select public.gpa_replace_snapshot(..., 0); -- 鎖住 gpa_user_state
--   Session B: select public.gpa_replace_snapshot(..., 0);       -- 應阻塞等待
--   Session A: commit;
--   Session B: 取得鎖後 rev 已變 → 回 {"ok":false,"conflict":true,"current_revision":1}
-- 預期：B 不會覆蓋 A 的資料；不會出現部分寫入。
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 執行後回報格式
-- ---------------------------------------------------------------------
-- 請把 T1~T10 的實際輸出貼回，特別是：
--   * T1/T3 的 count
--   * T4 的權限布林值
--   * T8 的錯誤訊息
--   * T9 兩次 RPC 的完整 JSON
--   * T10 的阻塞/衝突行為
-- 在收到實際輸出前，本專案不會宣稱「資料庫層已驗證」。
