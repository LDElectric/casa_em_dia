create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'member')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists household_members_household_id_idx
  on public.household_members(household_id);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(trim(title)) between 1 and 120),
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category text not null check (char_length(trim(category)) between 1 and 40),
  amount_cents bigint not null check (amount_cents > 0),
  transaction_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists transactions_household_date_idx
  on public.transactions(household_id, transaction_date desc);

create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(trim(title)) between 1 and 120),
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category text not null check (char_length(trim(category)) between 1 and 40),
  amount_cents bigint not null check (amount_cents > 0),
  frequency text not null check (frequency in ('monthly', 'yearly')),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  month_of_year smallint check (month_of_year between 1 and 12),
  created_at timestamptz not null default now(),
  constraint recurring_month_requirement check (
    (frequency = 'yearly' and month_of_year is not null)
    or (frequency = 'monthly' and month_of_year is null)
  )
);

create index if not exists recurring_items_household_idx
  on public.recurring_items(household_id);

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  current_user_id uuid := (select auth.uid());
  current_email text := (select auth.jwt() ->> 'email');
begin
  if current_user_id is null or current_email is null then
    raise exception 'É necessário entrar na conta para criar uma casa.';
  end if;

  if exists (
    select 1 from public.household_members hm where hm.user_id = current_user_id
  ) then
    raise exception 'Esta conta já pertence a uma casa.';
  end if;

  if household_name is null or char_length(trim(household_name)) not between 1 and 80 then
    raise exception 'O nome da casa deve ter entre 1 e 80 caracteres.';
  end if;

  insert into public.households(name)
  values (trim(household_name))
  returning id into new_household_id;

  insert into public.household_members(user_id, household_id, email, role)
  values (current_user_id, new_household_id, lower(current_email), 'owner');

  return new_household_id;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_items enable row level security;

drop policy if exists "Members can view their household" on public.households;
create policy "Members can view their household"
  on public.households for select to authenticated
  using (public.is_household_member(id));

drop policy if exists "Owners can update their household" on public.households;
create policy "Owners can update their household"
  on public.households for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

drop policy if exists "Members can view household members" on public.household_members;
create policy "Members can view household members"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Owners can remove household members" on public.household_members;
create policy "Owners can remove household members"
  on public.household_members for delete to authenticated
  using (
    role = 'member'
    and public.is_household_owner(household_id)
  );

drop policy if exists "Members can view household transactions" on public.transactions;
create policy "Members can view household transactions"
  on public.transactions for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Members can add household transactions" on public.transactions;
create policy "Members can add household transactions"
  on public.transactions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );

drop policy if exists "Members can update household transactions" on public.transactions;
create policy "Members can update household transactions"
  on public.transactions for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members can delete household transactions" on public.transactions;
create policy "Members can delete household transactions"
  on public.transactions for delete to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Members can view household recurring items" on public.recurring_items;
create policy "Members can view household recurring items"
  on public.recurring_items for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "Members can add household recurring items" on public.recurring_items;
create policy "Members can add household recurring items"
  on public.recurring_items for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_household_member(household_id)
  );

drop policy if exists "Members can update household recurring items" on public.recurring_items;
create policy "Members can update household recurring items"
  on public.recurring_items for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "Members can delete household recurring items" on public.recurring_items;
create policy "Members can delete household recurring items"
  on public.recurring_items for delete to authenticated
  using (public.is_household_member(household_id));

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.is_household_owner(uuid) from public, anon;
revoke all on function public.create_household(text) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant select, update on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.recurring_items to authenticated;
