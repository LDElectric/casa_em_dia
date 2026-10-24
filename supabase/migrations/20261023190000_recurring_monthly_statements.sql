alter table public.recurring_items
  add column if not exists amount_behavior text not null default 'fixed'
    check (amount_behavior in ('fixed', 'variable')),
  add column if not exists starts_month date,
  add column if not exists active boolean not null default true;

update public.recurring_items
set starts_month = date_trunc('month', created_at)::date
where starts_month is null;

alter table public.recurring_items
  alter column starts_month set default date_trunc('month', current_date)::date,
  alter column starts_month set not null;

alter table public.monthly_control_items
  add column if not exists recurring_item_id uuid
    references public.recurring_items(id) on delete set null,
  add column if not exists is_skipped boolean not null default false;

create unique index if not exists monthly_control_recurring_item_month_unique
  on public.monthly_control_items(recurring_item_id, month_start)
  where recurring_item_id is not null;

alter table public.card_statements
  add column if not exists statement_total_cents bigint
    check (statement_total_cents is null or statement_total_cents >= 0);

create or replace function public.ensure_monthly_control_items(target_month_start date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household_id uuid;
  inserted_count integer;
begin
  if target_month_start is null or extract(day from target_month_start) <> 1 then
    raise exception 'target_month_start must be the first day of a month';
  end if;

  select hm.household_id
  into target_household_id
  from public.household_members hm
  where hm.user_id = (select auth.uid());

  if target_household_id is null then
    raise exception 'household membership required';
  end if;

  update public.monthly_control_items existing
  set recurring_item_id = recurring.id
  from public.recurring_items recurring
  where recurring.household_id = target_household_id
    and recurring.active
    and recurring.starts_month <= target_month_start
    and (
      recurring.frequency = 'monthly'
      or (
        recurring.frequency = 'yearly'
        and recurring.month_of_year = extract(month from target_month_start)::integer
      )
    )
    and existing.household_id = target_household_id
    and existing.month_start = target_month_start
    and existing.recurring_item_id is null
    and existing.transaction_type = recurring.transaction_type
    and existing.control_group = case
      when recurring.transaction_type = 'income' then 'income'
      when recurring.budget_group = 'fixed' then 'fixed'
      when recurring.budget_group = 'emergency' then 'additional'
      else 'variable'
    end
    and lower(trim(existing.item_name)) = lower(trim(recurring.title));

  insert into public.monthly_control_items(
    household_id,
    month_start,
    item_name,
    transaction_type,
    control_group,
    amount_cents,
    created_by,
    recurring_item_id
  )
  select
    recurring.household_id,
    target_month_start,
    recurring.title,
    recurring.transaction_type,
    case
      when recurring.transaction_type = 'income' then 'income'
      when recurring.budget_group = 'fixed' then 'fixed'
      when recurring.budget_group = 'emergency' then 'additional'
      else 'variable'
    end,
    case when recurring.amount_behavior = 'variable' then null else recurring.amount_cents end,
    recurring.created_by,
    recurring.id
  from public.recurring_items recurring
  where recurring.household_id = target_household_id
    and recurring.active
    and recurring.starts_month <= target_month_start
    and (
      recurring.frequency = 'monthly'
      or (
        recurring.frequency = 'yearly'
        and recurring.month_of_year = extract(month from target_month_start)::integer
      )
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ensure_monthly_control_items(date) from public, anon;
grant execute on function public.ensure_monthly_control_items(date) to authenticated;
