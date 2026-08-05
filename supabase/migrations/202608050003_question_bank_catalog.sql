create table if not exists public.question_bank_catalog (
  course_id text primary key check (course_id in ('history', 'morality', 'mao', 'xi', 'marx')),
  choice_count integer not null check (choice_count >= 0),
  essay_count integer not null check (essay_count >= 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.question_bank_catalog enable row level security;

drop policy if exists "active members can read question bank catalog" on public.question_bank_catalog;
create policy "active members can read question bank catalog"
on public.question_bank_catalog
for select
to authenticated
using (public.is_active_member());

revoke all on table public.question_bank_catalog from anon, authenticated;
grant select on table public.question_bank_catalog to authenticated;
grant all on table public.question_bank_catalog to service_role;
