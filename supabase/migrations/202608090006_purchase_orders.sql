-- Manual payment orders. Browser roles receive no table or function access;
-- Cloudflare Pages Functions use the service role after validating callers.
create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  access_token_hash text not null,
  email text not null,
  plan text not null default 'monthly' check (plan = 'monthly'),
  amount numeric(10, 2) not null default 9.90 check (amount = 9.90),
  membership_days integer not null default 30 check (membership_days = 30),
  payment_method text check (payment_method in ('alipay', 'wechat')),
  payment_reference text check (payment_reference is null or payment_reference ~ '^[A-Za-z0-9]{6}$'),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'pending_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text,
  updated_at timestamptz not null default now(),
  check (email = lower(btrim(email)))
);

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_email_idx on public.orders (email);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
revoke all on table public.orders from anon, authenticated;
grant all on table public.orders to service_role;

create or replace function public.create_purchase_order(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  existing public.orders%rowtype;
  new_order_no text;
  access_token text;
begin
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 0));
  select * into existing
  from public.orders
  where email = normalized_email
    and status in ('pending_payment', 'pending_review')
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'reused', true,
      'order_no', existing.order_no,
      'status', existing.status
    );
  end if;

  new_order_no := 'SZ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
  access_token := encode(gen_random_bytes(32), 'hex');
  insert into public.orders (order_no, access_token_hash, email)
  values (new_order_no, encode(digest(access_token, 'sha256'), 'hex'), normalized_email);

  return jsonb_build_object(
    'reused', false,
    'order_no', new_order_no,
    'access_token', access_token,
    'status', 'pending_payment'
  );
end;
$$;

create or replace function public.submit_purchase_order(
  p_order_no text,
  p_payment_method text,
  p_payment_reference text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders%rowtype;
  normalized_reference text := btrim(coalesce(p_payment_reference, ''));
begin
  if p_payment_method not in ('alipay', 'wechat') then
    raise exception 'Unsupported payment method.';
  end if;
  if normalized_reference !~ '^[A-Za-z0-9]{6}$' then
    raise exception 'Payment reference must be six letters or numbers.';
  end if;

  select * into current_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'Order not found.'; end if;
  if current_order.status not in ('pending_payment', 'rejected') then
    raise exception 'This order cannot be submitted for review.';
  end if;

  update public.orders
  set payment_method = p_payment_method,
      payment_reference = normalized_reference,
      status = 'pending_review',
      submitted_at = now(),
      reviewed_at = null,
      reviewed_by = null,
      review_note = null
  where id = current_order.id
  returning * into current_order;
  return current_order;
end;
$$;

create or replace function public.approve_purchase_order(
  p_order_no text,
  p_reviewed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_order public.orders%rowtype;
  membership public.memberships%rowtype;
  purchaser_id uuid;
  new_expiry timestamptz;
begin
  select * into current_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'Order not found.'; end if;
  if current_order.status = 'approved' then
    select expires_at into new_expiry from public.memberships where email = current_order.email order by updated_at desc limit 1;
    return jsonb_build_object('already_processed', true, 'expires_at', new_expiry);
  end if;
  if current_order.status <> 'pending_review' then
    raise exception 'Only pending-review orders can be approved.';
  end if;
  if current_order.plan <> 'monthly' or current_order.amount <> 9.90 or current_order.membership_days <> 30 then
    raise exception 'Order plan validation failed.';
  end if;

  select id into purchaser_id from auth.users where lower(email) = current_order.email limit 1;
  if purchaser_id is null then raise exception 'No Auth user exists for this order email.'; end if;

  select * into membership from public.memberships where user_id = purchaser_id for update;
  if found and membership.expires_at > now() then
    new_expiry := membership.expires_at + make_interval(days => current_order.membership_days);
  else
    new_expiry := now() + make_interval(days => current_order.membership_days);
  end if;

  insert into public.memberships (user_id, email, status, expires_at)
  values (purchaser_id, current_order.email, 'active', new_expiry)
  on conflict (user_id) do update
  set email = excluded.email,
      status = 'active',
      expires_at = excluded.expires_at,
      updated_at = now();

  update public.orders
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = lower(btrim(p_reviewed_by)),
      review_note = null
  where id = current_order.id;

  return jsonb_build_object('already_processed', false, 'expires_at', new_expiry);
end;
$$;

create or replace function public.reject_purchase_order(
  p_order_no text,
  p_reviewed_by text,
  p_review_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare current_order public.orders%rowtype;
begin
  select * into current_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'Order not found.'; end if;
  if current_order.status <> 'pending_review' then
    raise exception 'Only pending-review orders can be rejected.';
  end if;
  update public.orders
  set status = 'rejected', reviewed_at = now(), reviewed_by = lower(btrim(p_reviewed_by)), review_note = nullif(left(btrim(coalesce(p_review_note, '')), 500), '')
  where id = current_order.id
  returning * into current_order;
  return current_order;
end;
$$;

revoke all on function public.create_purchase_order(text) from public, anon, authenticated;
revoke all on function public.submit_purchase_order(text, text, text) from public, anon, authenticated;
revoke all on function public.approve_purchase_order(text, text) from public, anon, authenticated;
revoke all on function public.reject_purchase_order(text, text, text) from public, anon, authenticated;
grant execute on function public.create_purchase_order(text) to service_role;
grant execute on function public.submit_purchase_order(text, text, text) to service_role;
grant execute on function public.approve_purchase_order(text, text) to service_role;
grant execute on function public.reject_purchase_order(text, text, text) to service_role;
