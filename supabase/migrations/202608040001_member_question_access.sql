create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  course_id text not null check (course_id in ('history', 'morality', 'mao', 'xi', 'marx')),
  question_type text not null check (question_type in ('choice', 'essay')),
  question_order integer not null check (question_order > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, question_type, question_order)
);

create index if not exists memberships_active_expiry_idx
  on public.memberships (user_id, status, expires_at);
create index if not exists questions_course_order_idx
  on public.questions (course_id, question_type, question_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

alter table public.memberships enable row level security;
alter table public.questions enable row level security;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and status = 'active'
      and expires_at > now()
  );
$$;

revoke all on function public.is_active_member() from public;
grant execute on function public.is_active_member() to authenticated;

drop policy if exists "members can read own membership" on public.memberships;
create policy "members can read own membership"
on public.memberships
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "active members can read questions" on public.questions;
create policy "active members can read questions"
on public.questions
for select
to authenticated
using (public.is_active_member());

revoke all on table public.memberships from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
grant select on table public.memberships to authenticated;
grant select on table public.questions to authenticated;
grant all on table public.memberships to service_role;
grant all on table public.questions to service_role;
