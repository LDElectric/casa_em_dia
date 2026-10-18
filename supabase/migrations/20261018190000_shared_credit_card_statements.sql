alter table public.credit_cards
  add column if not exists statement_scope text not null default 'individual'
    check (statement_scope in ('individual', 'shared'));

alter table public.card_statement_items
  add column if not exists cardholder_label text
    check (cardholder_label is null or char_length(trim(cardholder_label)) between 1 and 80);

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
      cardholder_label text,
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
      or item.cardholder_label is not null
        and char_length(trim(item.cardholder_label)) not between 1 and 80
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
    cardholder_label,
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
    item.cardholder_label,
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
    cardholder_label text,
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
        cardholder_label = excluded.cardholder_label,
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
