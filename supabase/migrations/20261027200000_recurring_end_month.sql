-- Séries recorrentes com término opcional.
-- `ends_month` nulo = sem prazo (salário efetivo, aluguel). Com data = contrato
-- temporário (ex.: emprego de 11 meses), que deixa de gerar meses sozinho.
alter table public.recurring_items
  add column if not exists ends_month date;

alter table public.recurring_items
  drop constraint if exists recurring_items_ends_after_start;

alter table public.recurring_items
  add constraint recurring_items_ends_after_start
  check (ends_month is null or ends_month >= starts_month);

comment on column public.recurring_items.ends_month is
  'Último mês em que a série gera lançamento; nulo = sem prazo.';

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
    and (recurring.ends_month is null or target_month_start <= recurring.ends_month)
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
