-- Public write protection, administrator counters and feedback correction metadata.
-- Browser roles cannot access request fingerprints or change feedback resolution data.

create table if not exists public.request_rate_limits (
  action text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (action, request_fingerprint, window_started_at)
);

create index if not exists request_rate_limits_updated_at_idx
  on public.request_rate_limits (updated_at);

alter table public.request_rate_limits enable row level security;
revoke all on table public.request_rate_limits from public, anon, authenticated;
grant all on table public.request_rate_limits to service_role;

create or replace function public.consume_request_limit(
  p_action text,
  p_request_fingerprint text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  current_count integer;
begin
  if p_action not in ('feedback', 'create_order') then
    raise exception 'Unsupported rate-limit action.';
  end if;
  if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid request fingerprint.';
  end if;
  if p_window_seconds < 60 or p_window_seconds > 86400 or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid rate-limit configuration.';
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.request_rate_limits (
    action,
    request_fingerprint,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_action,
    p_request_fingerprint,
    bucket,
    1,
    now()
  )
  on conflict (action, request_fingerprint, window_started_at)
  do update set
    request_count = public.request_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into current_count;

  delete from public.request_rate_limits
  where updated_at < now() - interval '2 days';

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_request_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_request_limit(text, text, integer, integer)
  to service_role;

alter table public.feedback
  add column if not exists resolution_kind text,
  add column if not exists question_ref text,
  add column if not exists question_database_id uuid,
  add column if not exists resolved_revision_id uuid,
  add column if not exists resolved_catalog_hash text;

alter table public.feedback
  drop constraint if exists feedback_resolution_kind_check;
alter table public.feedback
  add constraint feedback_resolution_kind_check
  check (resolution_kind is null or resolution_kind in ('fixed', 'no_change', 'needs_review'));

alter table public.feedback
  drop constraint if exists feedback_catalog_hash_check;
alter table public.feedback
  add constraint feedback_catalog_hash_check
  check (resolved_catalog_hash is null or resolved_catalog_hash ~ '^[a-f0-9]{64}$');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_question_database_id_fkey') then
    alter table public.feedback
      add constraint feedback_question_database_id_fkey
      foreign key (question_database_id) references public.questions(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_resolved_revision_id_fkey') then
    alter table public.feedback
      add constraint feedback_resolved_revision_id_fkey
      foreign key (resolved_revision_id) references public.question_revisions(id) on delete set null;
  end if;
end;
$$;

create index if not exists feedback_question_database_id_idx
  on public.feedback (question_database_id)
  where question_database_id is not null;

comment on table public.request_rate_limits is
  'Atomic server-only limits for public Pages Function writes; fingerprints are one-way hashes.';
comment on column public.feedback.resolution_kind is
  'Correction outcome: fixed, no_change or needs_review.';
