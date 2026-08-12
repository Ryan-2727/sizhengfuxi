alter table public.question_quality
  add column if not exists curation_status text not null default 'standard',
  add column if not exists curation_rank integer,
  add column if not exists curation_reason text,
  add column if not exists curation_version text,
  add column if not exists curated_at timestamptz;

alter table public.question_quality
  drop constraint if exists question_quality_curation_status_check,
  add constraint question_quality_curation_status_check
    check (curation_status in ('standard', 'chapter_core')),
  drop constraint if exists question_quality_curation_fields_check,
  add constraint question_quality_curation_fields_check
    check (
      (curation_status = 'standard'
        and curation_rank is null
        and curation_reason is null
        and curated_at is null)
      or
      (curation_status = 'chapter_core'
        and curation_rank between 1 and 10
        and nullif(trim(curation_reason), '') is not null
        and nullif(trim(curation_version), '') is not null
        and curated_at is not null)
    );

create index if not exists question_quality_chapter_core_idx
  on public.question_quality (curation_status, curation_rank)
  where curation_status = 'chapter_core' and publication_status = 'published';

revoke all on table public.question_quality from anon, authenticated;
grant select on table public.question_quality to authenticated;
grant all on table public.question_quality to service_role;

comment on column public.question_quality.curation_status is
  'Editorial selection only: standard or chapter_core. It is not a claim that the question is an official textbook exercise.';
comment on column public.question_quality.curation_rank is
  'Stable rank inside the same course, verified chapter and question type curation set.';
comment on column public.question_quality.curation_reason is
  'Short source and quality rationale that does not duplicate question content.';
comment on column public.question_quality.curation_version is
  'Version of the deterministic curation rules used for this selection.';
comment on column public.question_quality.curated_at is
  'Time when the current chapter_core selection was first applied.';
