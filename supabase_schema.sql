-- =====================================================================
-- GPA Tracker — Supabase 資料庫結構與 Row Level Security（RLS）腳本
-- 在 Supabase 的 SQL Editor 執行本檔，即可建立多租戶隔離的成績資料表。
--
-- 三張資料表對應前端的三個實體：
--   semesters   ← 學期（前端 terms）
--   courses     ← 課程
--   assessments ← 評核
-- 每個實體都帶 user_id 並啟用 RLS，確保每位使用者只能讀寫自己的資料。
-- =====================================================================

-- 擴充套件：gen_random_uuid()（Supabase 預設已啟用，保險起見）
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 學期表 semesters
-- ---------------------------------------------------------------------
create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id integer not null,          -- 前端內部 id（term.id）
  name text not null,                 -- 學期名稱
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);

-- ---------------------------------------------------------------------
-- 2. 課程表 courses
-- ---------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id integer not null,          -- 前端內部 id（course.id）
  semester_local_id integer not null, -- 對應 semesters.local_id
  code text,                          -- 科目代碼（可為 null）
  title text not null,                -- 科目名稱
  credits real not null default 0,    -- 學分
  gpa_inclusion text not null default 'include',   -- include / exclude / needs-review
  official_mark real,                 -- 校方公布最終分數（可為 null）
  official_gp real,                   -- 最終積點（可為 null）
  cross_semester_policy text not null default 'single', -- single / needs-review
  target_grade text not null default 'A',
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);

-- ---------------------------------------------------------------------
-- 3. 評核表 assessments
-- ---------------------------------------------------------------------
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_id integer not null,          -- 前端內部 id（assessment.id）
  course_local_id integer not null,   -- 對應 courses.local_id
  name text not null,                 -- 評核名稱
  assessment_group text not null default 'CA', -- CA / EA / 作業 / 專題 / 考試 / 其他
  weight_percent real not null default 0,      -- 佔比權重 (%)
  max_points real,                    -- 滿分（可為 null）
  earned_points real,                 -- 得分（可為 null）
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);

-- =====================================================================
-- Row Level Security（RLS）：每張表 4 條策略，限制 auth.uid() = user_id
-- =====================================================================

alter table public.semesters enable row level security;
create policy "semesters_select_own" on public.semesters
  for select using (auth.uid() = user_id);
create policy "semesters_insert_own" on public.semesters
  for insert with check (auth.uid() = user_id);
create policy "semesters_update_own" on public.semesters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "semesters_delete_own" on public.semesters
  for delete using (auth.uid() = user_id);

alter table public.courses enable row level security;
create policy "courses_select_own" on public.courses
  for select using (auth.uid() = user_id);
create policy "courses_insert_own" on public.courses
  for insert with check (auth.uid() = user_id);
create policy "courses_update_own" on public.courses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "courses_delete_own" on public.courses
  for delete using (auth.uid() = user_id);

alter table public.assessments enable row level security;
create policy "assessments_select_own" on public.assessments
  for select using (auth.uid() = user_id);
create policy "assessments_insert_own" on public.assessments
  for insert with check (auth.uid() = user_id);
create policy "assessments_update_own" on public.assessments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "assessments_delete_own" on public.assessments
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 索引（unique 約束已建立 (user_id, local_id) 索引，這裡補 user_id 單欄索引）
-- ---------------------------------------------------------------------
create index if not exists courses_user_id_idx on public.courses (user_id);
create index if not exists assessments_user_id_idx on public.assessments (user_id);


-- =====================================================================
-- 2.0 追加：updated_at 欄位與自動更新觸發器（供衝突偵測 / 審計使用）
--    可安全重複執行（add column if not exists / drop trigger if exists）
-- =====================================================================
alter table public.semesters  add column if not exists updated_at timestamptz not null default now();
alter table public.courses    add column if not exists updated_at timestamptz not null default now();
alter table public.assessments add column if not exists updated_at timestamptz not null default now();

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

