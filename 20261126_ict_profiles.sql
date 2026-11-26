-- ICT School Management System: profile table expected by ict-sync-accounts.
-- Review existing public.ict_profiles before applying this migration.
-- Run in Supabase SQL Editor. If the table already exists, ALTER adds missing columns.

create table if not exists public.ict_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'student')),
  username text not null,
  email text,
  name text not null default '',
  isn text,
  level text not null default '',
  class_name text not null default '',
  major text not null default '',
  teaching_levels text[] not null default '{}',
  subject text not null default '',
  class_names text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ict_profiles
  add column if not exists role text,
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists name text not null default '',
  add column if not exists isn text,
  add column if not exists level text not null default '',
  add column if not exists class_name text not null default '',
  add column if not exists major text not null default '',
  add column if not exists teaching_levels text[] not null default '{}',
  add column if not exists subject text not null default '',
  add column if not exists class_names text[] not null default '{}',
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists ict_profiles_role_idx on public.ict_profiles(role);
create index if not exists ict_profiles_username_idx on public.ict_profiles(username);

alter table public.ict_profiles enable row level security;

-- Authenticated users can read only their own profile.
drop policy if exists "Users can read own ICT profile" on public.ict_profiles;
create policy "Users can read own ICT profile"
  on public.ict_profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Do not add browser insert/update/delete policies for this account-management table.
-- The Edge Function uses the service role after validating the Administrator token.
