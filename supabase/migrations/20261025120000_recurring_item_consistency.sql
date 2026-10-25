-- Garante um único modelo ativo por nome, tipo e grupo do orçamento e evita
-- que um lançamento avulso com o mesmo nome seja absorvido por um modelo fixo.

-- Modelos duplicados (criados por tentativas antigas de cadastro) são pausados,
-- mantendo o mais antigo ativo.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        household_id,
        transaction_type,
        frequency,
        lower(btrim(title)),
        case
          when transaction_type = 'income' then 'income'
          when budget_group = 'fixed' then 'fixed'
          when budget_group = 'emergency' then 'additional'
          else 'variable'
        end
      order by starts_month, created_at, id
    ) as position
  from public.recurring_items
  where active
)
update public.recurring_items item
set active = false
from ranked
where item.id = ranked.id
  and ranked.position > 1;

create unique index if not exists recurring_items_active_name_unique
  on public.recurring_items (
    household_id,
    transaction_type,
    frequency,
    lower(btrim(title)),
    (case
      when transaction_type = 'income' then 'income'
      when budget_group = 'fixed' then 'fixed'
      when budget_group = 'emergency' then 'additional'
      else 'variable'
    end)
  )
  where active;

-- O vínculo entre um item do mês e o modelo fixo passa a ser explícito no app.
-- Assim, um lançamento avulso com o mesmo nome de um modelo ativo continua
-- avulso ao recarregar a página, em vez de ser vinculado automaticamente.
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
