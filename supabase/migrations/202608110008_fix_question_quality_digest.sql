create or replace function public.initialize_question_quality()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.question_quality (
    question_id,
    publication_status,
    review_status,
    verification_status,
    source_kind,
    source_title,
    verification_reference,
    original_payload_hash,
    verified_at
  ) values (
    new.id,
    'published',
    case
      when new.payload ->> 'auditStatus' in ('teacher-key-verified', 'textbook-law-verified', 'authoritative-source-verified')
        and nullif(trim(new.payload ->> 'verificationReference'), '') is not null then 'source_verified'
      when new.payload ->> 'auditStatus' = 'source-backed' then 'structural_checked'
      else 'needs_manual_review'
    end,
    case
      when new.payload ->> 'auditStatus' in ('teacher-key-verified', 'textbook-law-verified', 'authoritative-source-verified', 'source-backed')
        then new.payload ->> 'auditStatus'
      else 'pending'
    end,
    case
      when coalesce(new.payload ->> 'source', '') ~ '教师|老师|课堂' then 'teacher-material'
      when coalesce(new.payload ->> 'source', '') ~ '真题|考试大纲|自学考试' then 'public-exam'
      when coalesce(new.payload ->> 'source', '') ~ '教材|课程|整理' then 'textbook-review'
      else 'question-bank'
    end,
    nullif(trim(new.payload ->> 'source'), ''),
    nullif(trim(new.payload ->> 'verificationReference'), ''),
    encode(extensions.digest(convert_to(new.payload::text, 'UTF8'), 'sha256'::text), 'hex'),
    case
      when new.payload ->> 'auditStatus' in ('teacher-key-verified', 'textbook-law-verified', 'authoritative-source-verified')
        and nullif(trim(new.payload ->> 'verificationReference'), '') is not null then now()
      else null
    end
  ) on conflict (question_id) do nothing;
  return new;
end;
$$;

comment on function public.initialize_question_quality() is
  'Creates immutable payload hashes and initial editorial metadata for newly imported questions.';
