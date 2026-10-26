-- Caixinhas: guardar todo mês para uma conta anual (IPVA, IPTU, CREA, CRT…).
-- A caixinha é uma série mensal como as receitas: tem início, fim opcional e
-- encerramento. O aporte sai da receita (reduz o livre), mas não é despesa;
-- quando a conta vence, "pagar" registra a despesa e retira o valor da caixinha.
create table if not exists public.savings_pots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  monthly_cents bigint not null check (monthly_cents > 0),
  target_cents bigint check (target_cents is null or target_cents > 0),
  due_month smallint check (due_month is null or due_month between 1 and 12),
  category text check (category is null or char_length(trim(category)) between 1 and 60),
  subcategory text check (subcategory is null or char_length(trim(subcategory)) between 1 and 60),
  budget_group text check (
    budget_group is null
    or budget_group in ('fixed', 'variable', 'leisure', 'emergency')
  ),
  starts_month date not null default date_trunc('month', current_date)::date,
  ends_month date,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_pots_ends_after_start
    check (ends_month is null or ends_month >= starts_month)
);

create index if not exists savings_pots_household_idx
  on public.savings_pots(household_id, created_at);

create table if not exists public.savings_pot_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  pot_id uuid not null references public.savings_pots(id) on delete cascade,
  direction text not null check (direction in ('deposit', 'withdrawal')),
  source text not null default 'manual' check (source in ('auto', 'manual')),
  amount_cents bigint not null check (amount_cents > 0),
  movement_date date not null default current_date,
  month_start date,
  description text check (description is null or char_length(trim(description)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists savings_pot_movements_pot_idx
  on public.savings_pot_movements(pot_id, movement_date desc);

-- Um aporte automático por caixinha e por mês: reabrir o mês não duplica.
-- Aportes manuais ("guardar extra") não entram nessa restrição.
create unique index if not exists savings_pot_movement_month_unique
  on public.savings_pot_movements(pot_id, month_start)
  where direction = 'deposit' and source = 'auto' and month_start is not null;

alter table public.savings_pots enable row level security;
alter table public.savings_pot_movements enable row level security;

drop policy if exists "Members can manage household savings pots" on public.savings_pots;
create policy "Members can manage household savings pots"
  on public.savings_pots for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

drop policy if exists "Members can manage household savings movements" on public.savings_pot_movements;
create policy "Members can manage household savings movements"
  on public.savings_pot_movements for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

grant select, insert, update, delete on public.savings_pots to authenticated;
grant select, insert, update, delete on public.savings_pot_movements to authenticated;

-- Registra o aporte do mês para cada caixinha ativa (idempotente).
create or replace function public.ensure_savings_pot_movements(target_month_start date)
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

  insert into public.savings_pot_movements(
    household_id,
    pot_id,
    direction,
    source,
    amount_cents,
    movement_date,
    month_start,
    description,
    created_by
  )
  select
    pot.household_id,
    pot.id,
    'deposit',
    'auto',
    pot.monthly_cents,
    target_month_start,
    target_month_start,
    'Aporte mensal',
    pot.created_by
  from public.savings_pots pot
  where pot.household_id = target_household_id
    and pot.active
    and pot.starts_month <= target_month_start
    and (pot.ends_month is null or target_month_start <= pot.ends_month)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ensure_savings_pot_movements(date) from public, anon;
grant execute on function public.ensure_savings_pot_movements(date) to authenticated;
