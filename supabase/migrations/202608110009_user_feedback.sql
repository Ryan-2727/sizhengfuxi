-- Private user feedback inbox. Browser roles cannot read or write this table;
-- Cloudflare Pages Functions validate submissions and use the service role.
create extension if not exists pgcrypto;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  feedback_no text not null unique default (
    'FB' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') ||
    upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8))
  ),
  type text not null check (type in ('题目错误', '知识点错误', '网站 Bug', '功能建议', '其他')),
  content text not null check (char_length(content) between 5 and 4000),
  contact text check (contact is null or char_length(contact) <= 200),
  context jsonb not null default '{}'::jsonb,
  page_url text check (page_url is null or char_length(page_url) <= 2000),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'ignored')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_status_idx on public.feedback (status);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

drop trigger if exists feedback_set_updated_at on public.feedback;
create trigger feedback_set_updated_at
before update on public.feedback
for each row execute function public.set_updated_at();

alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;
grant all on table public.feedback to service_role;

comment on table public.feedback is
  'Private feedback inbox written and managed only through protected Cloudflare Pages Functions.';
