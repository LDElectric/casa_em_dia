alter table public.monthly_control_items
  add column if not exists income_behavior text
    check (income_behavior is null or income_behavior in ('fixed', 'variable'));

update public.monthly_control_items item
set income_behavior = case
  when recurring.amount_behavior = 'variable' then 'variable'
  else 'fixed'
end
from public.recurring_items recurring
where item.recurring_item_id = recurring.id
  and item.transaction_type = 'income'
  and item.income_behavior is null;

update public.monthly_control_items
set income_behavior = 'variable'
where transaction_type = 'income'
  and income_behavior is null;

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
  set recurring_item_id = recurring.id,
      income_behavior = case
        when recurring.transaction_type = 'income' then recurring.amount_behavior
        else existing.income_behavior
      end
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
    income_behavior,
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
    case when recurring.transaction_type = 'income' then recurring.amount_behavior else null end,
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
