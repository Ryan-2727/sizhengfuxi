alter table public.orders
  add column if not exists membership_expires_at timestamptz;

comment on column public.orders.membership_expires_at is
  'Exact membership expiry produced when this order is approved.';

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
    new_expiry := current_order.membership_expires_at;
    if new_expiry is null then
      select expires_at into new_expiry from public.memberships where email = current_order.email order by updated_at desc limit 1;
    end if;
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
      review_note = null,
      membership_expires_at = new_expiry
  where id = current_order.id;

  return jsonb_build_object('already_processed', false, 'expires_at', new_expiry);
end;
$$;

revoke all on function public.approve_purchase_order(text, text) from public, anon, authenticated;
grant execute on function public.approve_purchase_order(text, text) to service_role;
