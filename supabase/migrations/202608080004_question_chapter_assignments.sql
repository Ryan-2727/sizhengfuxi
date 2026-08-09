alter table public.questions
  add column if not exists chapter_id text,
  add column if not exists chapter_assignment_status text not null default 'unclassified',
  add column if not exists chapter_assignment_reference text;

alter table public.questions
  drop constraint if exists questions_chapter_assignment_status_check;

alter table public.questions
  add constraint questions_chapter_assignment_status_check
  check (chapter_assignment_status in ('unclassified', 'candidate', 'verified'));

alter table public.questions
  drop constraint if exists questions_chapter_assignment_consistency_check;

alter table public.questions
  add constraint questions_chapter_assignment_consistency_check
  check (
    (chapter_assignment_status = 'unclassified' and chapter_id is null)
    or (chapter_assignment_status in ('candidate', 'verified') and chapter_id is not null)
  );

create index if not exists questions_course_chapter_order_idx
  on public.questions (course_id, chapter_id, question_type, question_order);

comment on column public.questions.chapter_id is
  'Course chapter identifier. Only verified assignments are treated as editorially confirmed.';
comment on column public.questions.chapter_assignment_status is
  'unclassified, candidate from deterministic rules, or verified after editorial review.';
comment on column public.questions.chapter_assignment_reference is
  'Assignment evidence or rule revision; never a replacement for question content.';
