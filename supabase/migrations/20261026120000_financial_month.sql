-- Mês financeiro da casa: virada opcional do mês e competência manual por lançamento.
-- Virada 1 mantém o mês do calendário (comportamento anterior).

alter table public.households
  add column if not exists finance_month_cutoff_day smallint not null default 1
  constraint households_finance_cutoff_range
  check (finance_month_cutoff_day between 1 and 15);

comment on column public.households.finance_month_cutoff_day is
  'Dia da virada do mês financeiro. Lançamentos do extrato até este dia do mês seguinte contam no mês anterior. 1 desliga a regra.';

alter table public.transactions
  add column if not exists competence_month date
  constraint transactions_competence_month_first_day
  check (competence_month is null or extract(day from competence_month) = 1);

comment on column public.transactions.competence_month is
  'Mês de competência escolhido manualmente, para despesas pagas antecipadamente ou atrasadas. Vence a virada do mês.';
