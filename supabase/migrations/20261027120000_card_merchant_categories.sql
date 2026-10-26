-- Categorias de contexto da fatura do cartão (mercado, açougue, oficina).
-- A classificação automática já grava esses nomes em card_statement_items, mas
-- as casas existentes também precisam das linhas em finance_categories para
-- escolher a categoria manualmente e manter o orçamento consistente.
with default_categories(transaction_type, category, subcategory, budget_group) as (
  values
    ('expense', 'Alimentação', 'Mercado', 'variable'),
    ('expense', 'Alimentação', 'Açougue', 'variable'),
    ('expense', 'Transporte', 'Oficina', 'variable')
)
insert into public.finance_categories(
  household_id, transaction_type, category, subcategory, budget_group, created_by
)
select
  household.id,
  defaults.transaction_type,
  defaults.category,
  defaults.subcategory,
  defaults.budget_group,
  owner.user_id
from public.households household
join lateral (
  select member.user_id
  from public.household_members member
  where member.household_id = household.id
  order by case when member.role = 'owner' then 0 else 1 end, member.created_at
  limit 1
) owner on true
cross join default_categories defaults
on conflict (household_id, transaction_type, category, subcategory) do nothing;
