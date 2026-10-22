-- =====================================================================
-- GPA Tracker 2.0 — Batch 1.1 資料安全 migration
-- 檔案：supabase/migrations/001_batch1_1_data_safety.sql
--
-- 目的：在「不重跑整份 schema」的前提下，為既有資料庫加上：
--   1) updated_at 欄位 + 自動更新 trigger
--   2) uid（跨裝置穩定識別）
--   3) gpa_user_state（樂觀並發控制用的 revision）
--   4) gpa_replace_snapshot() RPC：在單一資料庫交易內完成快照替換
--
-- 特性：可安全重複執行（idempotent）。不會刪除任何既有資料。
-- 使用：Supabase SQL Editor 或 psql 執行本檔。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) updated_at
-- ---------------------------------------------------------------------
alter table public.semesters   add column if not exists updated_at timestamptz not null default now();
alter table public.courses     add column if not exists updated_at timestamptz not null default now();
alter table public.assessments add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- 2) uid（跨裝置穩定識別；既有列回填、之後預設自動產生）
-- ---------------------------------------------------------------------
alter table public.semesters   add column if not exists uid uuid;
alter table public.courses     add column if not exists uid uuid;
alter table public.assessments add column if not exists uid uuid;

update public.semesters   set uid = gen_random_uuid() where uid is null;
update public.courses     set uid = gen_random_uuid() where uid is null;
update public.assessments set uid = gen_random_uuid() where uid is null;

alter table public.semesters   alter column uid set default gen_random_uuid();
alter table public.courses     alter column uid set default gen_random_uuid();
alter table public.assessments alter column uid set default gen_random_uuid();

alter table public.semesters   alter column uid set not null;
alter table public.courses     alter column uid set not null;
alter table public.assessments alter column uid set not null;

create unique index if not exists semesters_user_uid_idx   on public.semesters (user_id, uid);
create unique index if not exists courses_user_uid_idx     on public.courses (user_id, uid);
create unique index if not exists assessments_user_uid_idx on public.assessments (user_id, uid);

-- ---------------------------------------------------------------------
-- 3) updated_at 自動更新 trigger
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_semesters_updated_at on public.semesters;
create trigger trg_semesters_updated_at
  before insert or update on public.semesters
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_courses_updated_at on public.courses;
create trigger trg_courses_updated_at
  before insert or update on public.courses
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_assessments_updated_at on public.assessments;
create trigger trg_assessments_updated_at
  before insert or update on public.assessments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4) 每人一列 revision（樂觀並發控制）
-- ---------------------------------------------------------------------
create table if not exists public.gpa_user_state (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.gpa_user_state enable row level security;

drop policy if exists "gpa_user_state_select_own" on public.gpa_user_state;
create policy "gpa_user_state_select_own" on public.gpa_user_state
  for select using (auth.uid() = user_id);

drop policy if exists "gpa_user_state_insert_own" on public.gpa_user_state;
create policy "gpa_user_state_insert_own" on public.gpa_user_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "gpa_user_state_update_own" on public.gpa_user_state;
create policy "gpa_user_state_update_own" on public.gpa_user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "gpa_user_state_delete_own" on public.gpa_user_state;
create policy "gpa_user_state_delete_own" on public.gpa_user_state
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 5) 原子快照替換 RPC（單一交易）
--    回傳：{ ok:true, revision:N } 或 { ok:false, conflict:true, current_revision:N }
-- ---------------------------------------------------------------------
create or replace function public.gpa_replace_snapshot(
  p_semesters jsonb,
  p_courses jsonb,
  p_assessments jsonb,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.gpa_user_state(user_id, revision)
    values (v_uid, 0)
    on conflict (user_id) do nothing;

  select revision into v_rev
    from public.gpa_user_state
    where user_id = v_uid
    for update;

  if p_expected_revision is null then
    raise exception 'p_expected_revision is required';
  end if;
  if p_expected_revision <> v_rev then
    return jsonb_build_object('ok', false, 'conflict', true, 'current_revision', v_rev);
  end if;

  delete from public.assessments where user_id = v_uid;
  delete from public.courses     where user_id = v_uid;
  delete from public.semesters   where user_id = v_uid;

  insert into public.semesters(user_id, local_id, uid, name, sort_order, updated_at)
  select v_uid,
         (e->>'local_id')::int,
         coalesce(nullif(e->>'uid', '')::uuid, gen_random_uuid()),
         e->>'name',
         coalesce((e->>'sort_order')::int, 0),
         v_now
  from jsonb_array_elements(coalesce(p_semesters, '[]'::jsonb)) e;

  insert into public.courses(user_id, local_id, uid, semester_local_id, code, title, credits,
                            gpa_inclusion, official_mark, official_gp, cross_semester_policy, target_grade, updated_at)
  select v_uid,
         (e->>'local_id')::int,
         coalesce(nullif(e->>'uid', '')::uuid, gen_random_uuid()),
         (e->>'semester_local_id')::int,
         e->>'code',
         e->>'title',
         coalesce((e->>'credits')::real, 0),
         coalesce(e->>'gpa_inclusion', 'include'),
         (e->>'official_mark')::real,
         (e->>'official_gp')::real,
         coalesce(e->>'cross_semester_policy', 'single'),
         coalesce(e->>'target_grade', 'A'),
         v_now
  from jsonb_array_elements(coalesce(p_courses, '[]'::jsonb)) e;

  insert into public.assessments(user_id, local_id, uid, course_local_id, name,
                                 assessment_group, weight_percent, max_points, earned_points, updated_at)
  select v_uid,
         (e->>'local_id')::int,
         coalesce(nullif(e->>'uid', '')::uuid, gen_random_uuid()),
         (e->>'course_local_id')::int,
         e->>'name',
         coalesce(e->>'assessment_group', 'CA'),
         coalesce((e->>'weight_percent')::real, 0),
         (e->>'max_points')::real,
         (e->>'earned_points')::real,
         v_now
  from jsonb_array_elements(coalesce(p_assessments, '[]'::jsonb)) e;

  update public.gpa_user_state
     set revision = revision + 1, updated_at = v_now
   where user_id = v_uid
   returning revision into v_rev;

  return jsonb_build_object('ok', true, 'revision', v_rev);
end;
$$;


-- =====================================================================
-- Batch 1.2 追加：原子讀取快照 + state 回填 + 權限
-- =====================================================================

-- 原子讀取：單一 SQL 語句，回傳一致快照與 revision（避免讀取期間被其他裝置更新）
create or replace function public.gpa_read_snapshot()
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select jsonb_build_object(
    'has_state', exists(select 1 from public.gpa_user_state where user_id = v_uid),
    'revision', coalesce((select revision from public.gpa_user_state where user_id = v_uid), 0),
    'semesters', coalesce((select jsonb_agg(to_jsonb(s)) from public.semesters s where s.user_id = v_uid), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(to_jsonb(c)) from public.courses c where c.user_id = v_uid), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(to_jsonb(a)) from public.assessments a where a.user_id = v_uid), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- 為「已有資料但尚無 state 列」的舊帳號回填 revision（避免被視為未知版本）
insert into public.gpa_user_state (user_id, revision)
select t.u, 1
from (
  select distinct user_id as u from public.semesters  where user_id is not null
  union
  select distinct user_id      from public.courses    where user_id is not null
  union
  select distinct user_id      from public.assessments where user_id is not null
) t
on conflict (user_id) do nothing;

-- 權限：只允許已登入使用者呼叫，撤銷 anon / PUBLIC
revoke execute on function public.gpa_read_snapshot() from public;
revoke execute on function public.gpa_replace_snapshot(jsonb, jsonb, jsonb, bigint) from public;
grant execute on function public.gpa_read_snapshot() to authenticated;
grant execute on function public.gpa_replace_snapshot(jsonb, jsonb, jsonb, bigint) to authenticated;

