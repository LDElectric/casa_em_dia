-- Dicionário de estabelecimentos da casa.
-- Quando o usuário classifica uma compra da fatura, o app guarda aqui a regra
-- (chave normalizada do estabelecimento -> categoria) para as próximas faturas.
-- A regra da casa sempre vence a classificação automática embutida no app.
create table if not exists public.card_merchant_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  merchant_key text not null check (char_length(trim(merchant_key)) between 3 and 120),
  merchant_label text check (merchant_label is null or char_length(trim(merchant_label)) between 1 and 160),
  category text not null check (char_length(trim(category)) between 1 and 60),
  subcategory text check (subcategory is null or char_length(trim(subcategory)) between 1 and 60),
  budget_group text check (
    budget_group is null
    or budget_group in ('fixed', 'variable', 'leisure', 'emergency')
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_merchant_rules_unique unique (household_id, merchant_key)
);

create index if not exists card_merchant_rules_household_idx
  on public.card_merchant_rules(household_id);

alter table public.card_merchant_rules enable row level security;

drop policy if exists "Members can read household merchant rules" on public.card_merchant_rules;
create policy "Members can read household merchant rules"
  on public.card_merchant_rules for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Members can add household merchant rules" on public.card_merchant_rules;
create policy "Members can add household merchant rules"
  on public.card_merchant_rules for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and created_by = (select auth.uid())
  );

drop policy if exists "Members can update household merchant rules" on public.card_merchant_rules;
create policy "Members can update household merchant rules"
  on public.card_merchant_rules for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members can delete household merchant rules" on public.card_merchant_rules;
create policy "Members can delete household merchant rules"
  on public.card_merchant_rules for delete to authenticated
  using (public.is_household_member(household_id));

grant select, insert, update, delete on public.card_merchant_rules to authenticated;
