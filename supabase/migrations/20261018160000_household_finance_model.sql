create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category text not null check (char_length(trim(category)) between 1 and 60),
  subcategory text not null check (char_length(trim(subcategory)) between 1 and 60),
  budget_group text check (
    budget_group is null
    or budget_group in ('fixed', 'variable', 'leisure', 'emergency')
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint finance_categories_household_name_unique
    unique (household_id, transaction_type, category, subcategory)
);

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  provider text not null check (char_length(trim(provider)) between 1 and 60),
  titular_name text not null check (char_length(trim(titular_name)) between 1 and 80),
  cardholder_name text not null check (char_length(trim(cardholder_name)) between 1 and 80),
  card_role text not null check (card_role in ('titular', 'dependent')),
  last_four char(4) check (last_four is null or last_four ~ '^[0-9]{4}$'),
  credit_limit_cents bigint check (credit_limit_cents is null or credit_limit_cents > 0),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint credit_cards_household_label_unique unique (household_id, label)
);

alter table public.transactions
  add column if not exists subcategory text not null default 'Outros'
    check (char_length(trim(subcategory)) between 1 and 60),
  add column if not exists budget_group text
    check (budget_group is null or budget_group in ('fixed', 'variable', 'leisure', 'emergency')),
  add column if not exists payment_method text not null default 'other'
    check (payment_method in ('cash', 'debit', 'credit', 'transfer', 'other')),
  add column if not exists credit_card_id uuid references public.credit_cards(id) on delete set null;

alter table public.recurring_items
  alter column amount_cents drop not null,
  add column if not exists subcategory text not null default 'Outros'
    check (char_length(trim(subcategory)) between 1 and 60),
  add column if not exists budget_group text
    check (budget_group is null or budget_group in ('fixed', 'variable', 'leisure', 'emergency'));

create table if not exists public.budget_targets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  target_type text not null check (
    target_type in (
      'monthly_limit',
      'daily_limit',
      'leisure_limit',
      'card_limit',
      'monthly_reserve_target',
      'emergency_fund_goal'
    )
  ),
  label text not null check (char_length(trim(label)) between 1 and 100),
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  credit_card_id uuid references public.credit_cards(id) on delete cascade,
  related_card_label text check (
    related_card_label is null
    or char_length(trim(related_card_label)) between 1 and 80
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint card_limit_requires_card check (
    (
      target_type = 'card_limit'
      and (
        (credit_card_id is not null and related_card_label is null)
        or (credit_card_id is null and related_card_label is not null)
      )
    )
    or (target_type <> 'card_limit' and credit_card_id is null and related_card_label is null)
  )
);

create table if not exists public.reserve_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  direction text not null check (direction in ('deposit', 'withdrawal')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (char_length(trim(description)) between 1 and 120),
  movement_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.card_statements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'paid')),
  paid_at timestamptz,
  source_filename text not null check (char_length(trim(source_filename)) between 1 and 160),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  constraint card_statement_paid_timestamp check (
    (status = 'open' and paid_at is null)
    or (status = 'paid' and paid_at is not null)
  ),
  constraint card_statements_card_due_unique unique (credit_card_id, due_date)
);

create table if not exists public.card_statement_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  statement_id uuid not null references public.card_statements(id) on delete cascade,
  source_key text not null check (source_key ~ '^[a-f0-9]{64}$'),
  purchase_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount_cents bigint not null check (amount_cents <> 0),
  installment_number smallint,
  installment_total smallint,
  category text,
  subcategory text,
  budget_group text check (
    budget_group is null
    or budget_group in ('fixed', 'variable', 'leisure', 'emergency')
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint card_item_installment_pair check (
    (installment_number is null and installment_total is null)
    or (
      installment_number between 1 and installment_total
      and installment_total between 2 and 60
    )
  ),
  constraint card_statement_item_source_unique unique (statement_id, source_key)
);

create table if not exists public.household_setup_imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  source_name text not null check (char_length(trim(source_name)) between 1 and 160),
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  category_count integer not null check (category_count >= 0),
  recurring_count integer not null check (recurring_count >= 0),
  target_count integer not null check (target_count >= 0),
  constraint household_setup_imports_source_unique unique (household_id, source_fingerprint)
);

create index if not exists finance_categories_household_idx
  on public.finance_categories(household_id, transaction_type, category);
create index if not exists budget_targets_household_idx
  on public.budget_targets(household_id, target_type);
create index if not exists reserve_movements_household_date_idx
  on public.reserve_movements(household_id, movement_date desc);
create index if not exists credit_cards_household_idx
  on public.credit_cards(household_id, active, label);
create index if not exists card_statements_household_due_idx
  on public.card_statements(household_id, due_date desc);
create index if not exists card_statement_items_statement_idx
  on public.card_statement_items(statement_id, purchase_date);

alter table public.finance_categories enable row level security;
alter table public.budget_targets enable row level security;
alter table public.reserve_movements enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_statements enable row level security;
alter table public.card_statement_items enable row level security;
alter table public.household_setup_imports enable row level security;

create policy "Members can view household setup import history"
  on public.household_setup_imports for select to authenticated
  using (public.is_household_member(household_id));

create policy "Members can view household finance categories"
  on public.finance_categories for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household finance categories"
  on public.finance_categories for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );
create policy "Members can update household finance categories"
  on public.finance_categories for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "Members can delete household finance categories"
  on public.finance_categories for delete to authenticated
  using (public.is_household_member(household_id));

create policy "Members can view household budget targets"
  on public.budget_targets for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household budget targets"
  on public.budget_targets for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );
create policy "Members can update household budget targets"
  on public.budget_targets for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "Members can delete household budget targets"
  on public.budget_targets for delete to authenticated
  using (public.is_household_member(household_id));

create policy "Members can view household reserve movements"
  on public.reserve_movements for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can manage household reserve movements"
  on public.reserve_movements for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );

create policy "Members can view household credit cards"
  on public.credit_cards for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can manage household credit cards"
  on public.credit_cards for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );

create policy "Members can view household card statements"
  on public.card_statements for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household card statements"
  on public.card_statements for insert to authenticated
  with check (
    imported_by = (select auth.uid())
    and public.is_household_member(household_id)
    and exists (
      select 1
      from public.credit_cards cc
      where cc.id = credit_card_id
        and cc.household_id = public.card_statements.household_id
    )
  );
create policy "Members can update household card statements"
  on public.card_statements for update to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and exists (
      select 1
      from public.credit_cards cc
      where cc.id = credit_card_id
        and cc.household_id = public.card_statements.household_id
    )
  );

create policy "Members can view household card statement items"
  on public.card_statement_items for select to authenticated
  using (public.is_household_member(household_id));
create policy "Members can add household card statement items"
  on public.card_statement_items for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
    and exists (
      select 1
      from public.card_statements cs
      where cs.id = statement_id
        and cs.household_id = public.card_statement_items.household_id
    )
  );
create policy "Members can update household card statement items"
  on public.card_statement_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and exists (
      select 1
      from public.card_statements cs
      where cs.id = statement_id
        and cs.household_id = public.card_statement_items.household_id
    )
  );

create or replace function public.replace_card_statement_items(
  target_statement_id uuid,
  statement_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_household_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or jsonb_typeof(statement_items) is distinct from 'array' then
    raise exception 'A sessão e a lista de lançamentos da fatura são obrigatórias.';
  end if;
  if jsonb_array_length(statement_items) > 500 then
    raise exception 'A fatura excede o limite de 500 linhas.';
  end if;
  if (
    select count(*) <> count(distinct item.source_key)
    from jsonb_to_recordset(statement_items) as item(source_key text)
  ) then
    raise exception 'A fatura contém identificadores de linha repetidos.';
  end if;

  select cs.household_id
    into target_household_id
  from public.card_statements cs
  where cs.id = target_statement_id
  for update;

  if target_household_id is null
     or not public.is_household_member(target_household_id) then
    raise exception 'Fatura não encontrada ou sem permissão.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(statement_items) as item(
      source_key text,
      purchase_date date,
      title text,
      amount_cents bigint,
      installment_number smallint,
      installment_total smallint,
      category text,
      subcategory text,
      budget_group text
    )
    where item.source_key is null
      or item.source_key !~ '^[a-f0-9]{64}$'
      or item.purchase_date is null
      or item.title is null
      or char_length(trim(item.title)) not between 1 and 160
      or item.amount_cents is null
      or item.amount_cents = 0
      or (
        (item.installment_number is null) <> (item.installment_total is null)
      )
      or (
        item.installment_number is not null
        and (item.installment_number < 1
          or item.installment_total < item.installment_number
          or item.installment_total > 60)
      )
      or (
        item.budget_group is not null
        and item.budget_group not in ('fixed', 'variable', 'leisure', 'emergency')
      )
  ) then
    raise exception 'A fatura contém uma linha inválida.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(statement_items) as item(
      category text,
      subcategory text
    )
    where (item.category is null) <> (item.subcategory is null)
  ) then
    raise exception 'Categoria e subcategoria devem ser preenchidas juntas.';
  end if;

  insert into public.card_statement_items(
    household_id,
    statement_id,
    source_key,
    purchase_date,
    title,
    amount_cents,
    installment_number,
    installment_total,
    category,
    subcategory,
    budget_group,
    created_by
  )
  select
    target_household_id,
    target_statement_id,
    item.source_key,
    item.purchase_date,
    item.title,
    item.amount_cents,
    item.installment_number,
    item.installment_total,
    item.category,
    item.subcategory,
    item.budget_group,
    current_user_id
  from jsonb_to_recordset(statement_items) as item(
    source_key text,
    purchase_date date,
    title text,
    amount_cents bigint,
    installment_number smallint,
    installment_total smallint,
    category text,
    subcategory text,
    budget_group text
  )
  on conflict (statement_id, source_key) do update
    set purchase_date = excluded.purchase_date,
        title = excluded.title,
        amount_cents = excluded.amount_cents,
        installment_number = excluded.installment_number,
        installment_total = excluded.installment_total,
        category = excluded.category,
        subcategory = excluded.subcategory,
        budget_group = excluded.budget_group;

  delete from public.card_statement_items existing
  where existing.statement_id = target_statement_id
    and not exists (
      select 1
      from jsonb_to_recordset(statement_items) as item(source_key text)
      where item.source_key = existing.source_key
    );
end;
$$;

create or replace function public.apply_household_setup_import(import_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  v_target_household_id uuid;
  v_source_fingerprint text;
  v_source_name text;
  v_category_count integer;
  v_recurring_count integer;
  v_target_count integer;
begin
  v_target_household_id := (import_payload ->> 'household_id')::uuid;
  v_source_fingerprint := import_payload ->> 'source_fingerprint';
  v_source_name := import_payload ->> 'source_name';

  if current_user_id is null
     or v_target_household_id is null
     or not public.is_household_member(v_target_household_id) then
    raise exception 'Sessão inválida ou sem permissão para importar os dados da casa.';
  end if;
  if import_payload ->> 'version' is distinct from '1' then
    raise exception 'Versão do arquivo de importação não reconhecida.';
  end if;
  if v_source_fingerprint is null or v_source_fingerprint !~ '^[a-f0-9]{64}$'
     or v_source_name is null or char_length(trim(v_source_name)) not between 1 and 160 then
    raise exception 'O arquivo de importação não possui identificação válida.';
  end if;
  if jsonb_typeof(import_payload -> 'categories') is distinct from 'array'
     or jsonb_typeof(import_payload -> 'recurring_items') is distinct from 'array'
     or jsonb_typeof(import_payload -> 'budget_targets') is distinct from 'array' then
    raise exception 'O arquivo de importação possui uma estrutura inválida.';
  end if;

  v_category_count := jsonb_array_length(import_payload -> 'categories');
  v_recurring_count := jsonb_array_length(import_payload -> 'recurring_items');
  v_target_count := jsonb_array_length(import_payload -> 'budget_targets');
  if v_category_count > 300 or v_recurring_count > 200 or v_target_count > 100 then
    raise exception 'O arquivo de importação excede o limite de registros.';
  end if;
  if exists (
    select 1
    from public.household_setup_imports existing
    where existing.household_id = v_target_household_id
      and existing.source_fingerprint = v_source_fingerprint
  ) then
    raise exception 'Este arquivo já foi importado para a casa.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(import_payload -> 'categories') as item(
      transaction_type text,
      category text,
      subcategory text,
      budget_group text
    )
    where item.transaction_type is null
      or item.transaction_type not in ('income', 'expense')
      or item.category is null
      or char_length(trim(item.category)) not between 1 and 60
      or item.subcategory is null
      or char_length(trim(item.subcategory)) not between 1 and 60
      or (
        item.budget_group is not null
        and item.budget_group not in ('fixed', 'variable', 'leisure', 'emergency')
      )
      or (item.transaction_type = 'income' and item.budget_group is not null)
  ) then
    raise exception 'O arquivo contém uma categoria inválida.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(import_payload -> 'recurring_items') as item(
      title text,
      transaction_type text,
      category text,
      subcategory text,
      budget_group text,
      amount_cents bigint,
      frequency text,
      day_of_month smallint,
      month_of_year smallint
    )
    where item.title is null
      or char_length(trim(item.title)) not between 1 and 120
      or item.transaction_type is null
      or item.transaction_type not in ('income', 'expense')
      or item.category is null
      or char_length(trim(item.category)) not between 1 and 40
      or item.subcategory is null
      or char_length(trim(item.subcategory)) not between 1 and 60
      or (item.amount_cents is not null and item.amount_cents <= 0)
      or item.frequency is null
      or item.frequency not in ('monthly', 'yearly')
      or item.day_of_month is null
      or item.day_of_month not between 1 and 31
      or (
        (item.frequency = 'monthly' and item.month_of_year is not null)
        or (item.frequency = 'yearly'
          and (item.month_of_year is null or item.month_of_year not between 1 and 12))
      )
      or (
        item.budget_group is not null
        and item.budget_group not in ('fixed', 'variable', 'leisure', 'emergency')
      )
      or (item.transaction_type = 'income' and item.budget_group is not null)
  ) then
    raise exception 'O arquivo contém uma receita ou despesa recorrente inválida.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(import_payload -> 'budget_targets') as item(
      target_type text,
      label text,
      amount_cents bigint,
      related_card_label text
    )
    where item.target_type is null
      or item.target_type not in (
        'monthly_limit', 'daily_limit', 'leisure_limit', 'card_limit',
        'monthly_reserve_target', 'emergency_fund_goal'
      )
      or item.label is null
      or char_length(trim(item.label)) not between 1 and 100
      or (item.amount_cents is not null and item.amount_cents <= 0)
      or (
        item.target_type = 'card_limit'
        and (
          item.related_card_label is null
          or char_length(trim(item.related_card_label)) not between 1 and 80
        )
      )
      or (item.target_type <> 'card_limit' and item.related_card_label is not null)
  ) then
    raise exception 'O arquivo contém um limite ou objetivo inválido.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(import_payload -> 'recurring_items') as item(
      transaction_type text,
      category text,
      subcategory text
    )
    where not exists (
      select 1
      from public.finance_categories category
      where category.household_id = v_target_household_id
        and category.transaction_type = item.transaction_type
        and category.category = item.category
        and category.subcategory = item.subcategory
    )
    and not exists (
      select 1
      from jsonb_to_recordset(import_payload -> 'categories') as new_category(
        transaction_type text,
        category text,
        subcategory text
      )
      where new_category.transaction_type = item.transaction_type
        and new_category.category = item.category
        and new_category.subcategory = item.subcategory
    )
  ) then
    raise exception 'Há um item recorrente sem categoria cadastrada.';
  end if;

  insert into public.household_setup_imports(
    household_id, source_fingerprint, source_name, imported_by,
    category_count, recurring_count, target_count
  )
  values (
    v_target_household_id, v_source_fingerprint, v_source_name, current_user_id,
    v_category_count, v_recurring_count, v_target_count
  );

  insert into public.finance_categories(
    household_id, transaction_type, category, subcategory, budget_group, created_by
  )
  select
    v_target_household_id, item.transaction_type, item.category, item.subcategory,
    item.budget_group, current_user_id
  from jsonb_to_recordset(import_payload -> 'categories') as item(
    transaction_type text,
    category text,
    subcategory text,
    budget_group text
  )
  on conflict (household_id, transaction_type, category, subcategory)
  do update set budget_group = excluded.budget_group;

  insert into public.recurring_items(
    household_id, created_by, title, transaction_type, category, subcategory,
    budget_group, amount_cents, frequency, day_of_month, month_of_year
  )
  select
    v_target_household_id, current_user_id, item.title, item.transaction_type,
    item.category, item.subcategory, item.budget_group, item.amount_cents,
    item.frequency, item.day_of_month, item.month_of_year
  from jsonb_to_recordset(import_payload -> 'recurring_items') as item(
    title text,
    transaction_type text,
    category text,
    subcategory text,
    budget_group text,
    amount_cents bigint,
    frequency text,
    day_of_month smallint,
    month_of_year smallint
  );

  insert into public.budget_targets(
    household_id, target_type, label, amount_cents, related_card_label, created_by
  )
  select
    v_target_household_id, item.target_type, item.label, item.amount_cents,
    item.related_card_label, current_user_id
  from jsonb_to_recordset(import_payload -> 'budget_targets') as item(
    target_type text,
    label text,
    amount_cents bigint,
    related_card_label text
  );

  return jsonb_build_object(
    'categories', v_category_count,
    'recurring_items', v_recurring_count,
    'budget_targets', v_target_count
  );
end;
$$;

revoke all on function public.replace_card_statement_items(uuid, jsonb) from public, anon;
grant execute on function public.replace_card_statement_items(uuid, jsonb) to authenticated;
revoke all on function public.apply_household_setup_import(jsonb) from public, anon;
grant execute on function public.apply_household_setup_import(jsonb) to authenticated;

grant select, insert, update, delete on public.finance_categories to authenticated;
grant select, insert, update, delete on public.budget_targets to authenticated;
grant select, insert, update, delete on public.reserve_movements to authenticated;
grant select, insert, update, delete on public.credit_cards to authenticated;
grant select, insert, update on public.card_statements to authenticated;
grant select, insert, update on public.card_statement_items to authenticated;
grant select on public.household_setup_imports to authenticated;
