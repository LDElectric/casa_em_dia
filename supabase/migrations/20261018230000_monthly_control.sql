create table if not exists public.monthly_control_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month_start date not null check (extract(day from month_start) = 1),
  item_name text not null check (char_length(trim(item_name)) between 1 and 120),
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  control_group text not null check (
    control_group in ('income', 'fixed', 'variable', 'additional')
  ),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_control_item_group_type check (
    (transaction_type = 'income' and control_group = 'income')
    or (transaction_type = 'expense' and control_group <> 'income')
  )
);

create index if not exists monthly_control_items_household_month_idx
  on public.monthly_control_items(household_id, month_start desc);

create unique index if not exists monthly_control_items_name_unique
  on public.monthly_control_items(
    household_id,
    month_start,
    transaction_type,
    control_group,
    lower(trim(item_name))
  );

alter table public.monthly_control_items enable row level security;

drop policy if exists "Members can view monthly control items" on public.monthly_control_items;
create policy "Members can view monthly control items"
  on public.monthly_control_items for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Members can add monthly control items" on public.monthly_control_items;
create policy "Members can add monthly control items"
  on public.monthly_control_items for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );

drop policy if exists "Members can update monthly control items" on public.monthly_control_items;
create policy "Members can update monthly control items"
  on public.monthly_control_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members can delete monthly control items" on public.monthly_control_items;
create policy "Members can delete monthly control items"
  on public.monthly_control_items for delete to authenticated
  using (public.is_household_member(household_id));

insert into public.monthly_control_items(
  household_id,
  month_start,
  item_name,
  transaction_type,
  control_group,
  amount_cents,
  created_by
)
select
  t.household_id,
  date_trunc('month', t.transaction_date)::date,
  min(trim(t.title)),
  t.transaction_type,
  case
    when t.transaction_type = 'income' then 'income'
    when t.budget_group = 'fixed' then 'fixed'
    when t.budget_group = 'emergency' then 'additional'
    else 'variable'
  end,
  sum(t.amount_cents),
  min(t.created_by::text)::uuid
from public.transactions t
group by
  t.household_id,
  date_trunc('month', t.transaction_date)::date,
  lower(trim(t.title)),
  t.transaction_type,
  case
    when t.transaction_type = 'income' then 'income'
    when t.budget_group = 'fixed' then 'fixed'
    when t.budget_group = 'emergency' then 'additional'
    else 'variable'
  end
on conflict do nothing;
