-- Koptilnya production schema baseline.
-- Source-only until a dedicated Supabase project is provisioned and reviewed.
-- Do not apply this migration to max-song-app, Technopark, or an unidentified project.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'operator', 'reader')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  phone text,
  email text,
  client_type text not null default 'customer',
  note text,
  is_archived boolean not null default false,
  archived_at timestamptz,
  legacy_source_name text,
  legacy_source_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((is_archived and archived_at is not null) or (not is_archived and archived_at is null))
);
create index clients_org_active_name_idx on public.clients (organization_id, lower(name)) where not is_archived;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  product_type text not null check (product_type in ('raw_material', 'semi_finished', 'finished', 'service')),
  category text,
  unit text not null default 'кг' check (length(btrim(unit)) between 1 and 32),
  tracks_inventory boolean not null default true,
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0),
  average_cost numeric(14,4) not null default 0 check (average_cost >= 0),
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  photo_path text,
  is_archived boolean not null default false,
  archived_at timestamptz,
  legacy_source_name text,
  legacy_source_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((product_type = 'service' and not tracks_inventory) or product_type <> 'service'),
  check ((is_archived and archived_at is not null) or (not is_archived and archived_at is null))
);
create index products_org_active_name_idx on public.products (organization_id, lower(name)) where not is_archived;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_number text,
  kind text not null check (kind in ('receipt', 'sale', 'service')),
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
  document_date date not null default current_date,
  counterparty_id uuid,
  counterparty_name_snapshot text not null default '',
  supplier_name_snapshot text,
  note text,
  total_amount numeric(16,2) not null default 0 check (total_amount >= 0),
  total_cost numeric(16,2) not null default 0 check (total_cost >= 0),
  request_idempotency_key text,
  post_idempotency_key text,
  posted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_number),
  foreign key (organization_id, counterparty_id)
    references public.clients (organization_id, id) on delete restrict,
  unique (organization_id, request_idempotency_key)
);
create unique index documents_post_key_unique on public.documents (organization_id, post_idempotency_key) where post_idempotency_key is not null;
create index documents_org_date_idx on public.documents (organization_id, document_date desc);
create index documents_org_kind_status_idx on public.documents (organization_id, kind, status, document_date);

create table public.document_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  unit_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  line_total numeric(16,2) generated always as (round(quantity * unit_price, 2)) stored,
  line_cost_total numeric(16,2) generated always as (round(quantity * unit_cost, 2)) stored,
  note text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, document_id)
    references public.documents (organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete restrict
);
create index document_items_document_idx on public.document_items (organization_id, document_id);
create index document_items_product_idx on public.document_items (organization_id, product_id);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_number text,
  output_product_id uuid not null,
  output_product_name_snapshot text not null,
  output_unit_snapshot text not null,
  output_quantity numeric(14,3) not null check (output_quantity > 0),
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
  total_cost numeric(16,2) not null default 0 check (total_cost >= 0),
  batch_date date not null default current_date,
  note text,
  request_idempotency_key text,
  post_idempotency_key text,
  posted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, batch_number),
  unique (organization_id, request_idempotency_key),
  foreign key (organization_id, output_product_id)
    references public.products (organization_id, id) on delete restrict
);
create unique index production_batches_post_key_unique on public.production_batches (organization_id, post_idempotency_key) where post_idempotency_key is not null;
create index production_batches_org_date_idx on public.production_batches (organization_id, batch_date desc);

create table public.production_batch_inputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  unit_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  note text,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, batch_id)
    references public.production_batches (organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete restrict
);
create index production_batch_inputs_batch_idx on public.production_batch_inputs (organization_id, batch_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  movement_type text not null check (movement_type in ('receipt', 'sale', 'production_input', 'production_output', 'adjustment', 'opening_balance')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  movement_date timestamptz not null default now(),
  source_document_id uuid,
  source_document_item_id uuid,
  source_production_batch_id uuid,
  source_production_input_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id)
    references public.documents (organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_item_id)
    references public.document_items (organization_id, id) on delete restrict,
  foreign key (organization_id, source_production_batch_id)
    references public.production_batches (organization_id, id) on delete restrict,
  foreign key (organization_id, source_production_input_id)
    references public.production_batch_inputs (organization_id, id) on delete restrict,
  check ((source_document_id is null and source_document_item_id is null) or
         (source_document_id is not null and source_document_item_id is not null)),
  check ((source_production_batch_id is null and source_production_input_id is null) or
         (source_production_batch_id is not null))
);
create unique index stock_movement_doc_line_unique on public.stock_movements (organization_id, source_document_item_id) where source_document_item_id is not null;
create unique index stock_movement_batch_input_unique on public.stock_movements (organization_id, source_production_input_id) where source_production_input_id is not null;
create unique index stock_movement_batch_output_unique on public.stock_movements (organization_id, source_production_batch_id) where source_production_batch_id is not null and movement_type = 'production_output';
create index stock_movements_product_date_idx on public.stock_movements (organization_id, product_id, movement_date desc);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index expense_categories_name_unique on public.expense_categories (organization_id, lower(name)) where not is_archived;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expense_date date not null default current_date,
  category_id uuid,
  category_name_snapshot text not null,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  included_in_product_cost boolean not null default false,
  is_voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  request_idempotency_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, request_idempotency_key),
  foreign key (organization_id, category_id)
    references public.expense_categories (organization_id, id) on delete restrict,
  check ((not is_voided and voided_at is null) or (is_voided and voided_at is not null))
);
create index expenses_org_date_idx on public.expenses (organization_id, expense_date desc) where not is_voided;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'transfer', 'bank')),
  payment_date timestamptz not null default now(),
  idempotency_key text not null,
  request_fingerprint text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete restrict
);
create index payments_org_date_idx on public.payments (organization_id, payment_date desc);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null,
  document_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, payment_id, document_id),
  foreign key (organization_id, payment_id)
    references public.payments (organization_id, id) on delete restrict,
  foreign key (organization_id, document_id)
    references public.documents (organization_id, id) on delete restrict
);
create index payment_allocations_document_idx on public.payment_allocations (organization_id, document_id);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  price_minor_units bigint not null check (price_minor_units >= 0),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, billing_interval)
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  provider text not null default 'unconfigured',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  last_payment_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create table public.subscription_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  event_type text not null,
  verified boolean not null default false,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.backup_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  storage_path text not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version > 0),
  row_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, checksum_sha256)
);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  source_file_name text not null,
  source_format text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('uploaded', 'analysed', 'awaiting_approval', 'approved', 'importing', 'completed', 'failed', 'cancelled')),
  source_counts jsonb not null default '{}'::jsonb,
  imported_counts jsonb not null default '{}'::jsonb,
  control_totals jsonb not null default '{}'::jsonb,
  error_report_path text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, source_sha256)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity_name text not null,
  entity_id uuid,
  changed_columns text[] not null default '{}'::text[],
  occurred_at timestamptz not null default now()
);
create index audit_events_org_time_idx on public.audit_events (organization_id, occurred_at desc);

-- Security helper functions live in an unexposed schema, not in public.
create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;
revoke all on function private.is_org_member(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
  );
$$;
revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;

create or replace function private.can_write_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_subscriptions s
    join public.subscription_plans p on p.id = s.plan_id and p.is_active
    where s.organization_id = p_organization_id
      and (
        (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()))
        or (s.status = 'canceled' and s.cancel_at_period_end and s.current_period_end > now())
        or (s.status = 'trialing' and s.trial_ends_at > now())
      )
  );
$$;
revoke all on function private.can_write_org(uuid) from public, anon;
grant execute on function private.can_write_org(uuid) to authenticated;

create or replace function private.can_edit_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_org_member(p_organization_id)
     and private.can_write_org(p_organization_id)
     and private.has_org_role(p_organization_id, array['owner', 'admin', 'manager', 'operator']);
$$;
revoke all on function private.can_edit_org(uuid) from public, anon;
grant execute on function private.can_edit_org(uuid) to authenticated;

create or replace function private.prevent_tenant_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id is distinct from new.organization_id then
    raise exception 'organization_id cannot be reassigned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_tenant_reassignment() from public, anon, authenticated;

create or replace function private.guard_product_inventory_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.stock_quantity <> 0 and (
       old.tracks_inventory is distinct from new.tracks_inventory
       or old.unit is distinct from new.unit
       or (new.product_type = 'service')
     ) then
    raise exception 'Inventory tracking and unit cannot change while stock is nonzero'
      using errcode = '23514';
  end if;
  if not new.tracks_inventory and new.stock_quantity <> 0 then
    raise exception 'A non-tracked product cannot keep a stock balance' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_product_inventory_settings() from public, anon, authenticated;
drop trigger if exists guard_product_inventory_settings on public.products;
create trigger guard_product_inventory_settings
before update on public.products
for each row execute function private.guard_product_inventory_settings();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists koptilnya_auth_user_created on auth.users;
create trigger koptilnya_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_org uuid;
  v_entity_id uuid;
  v_changed text[] := '{}'::text[];
  v_key text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  v_org := coalesce((v_after ->> 'organization_id')::uuid, (v_before ->> 'organization_id')::uuid);
  v_entity_id := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);

  if tg_op = 'UPDATE' then
    for v_key in
      select key from jsonb_each(v_before)
      union
      select key from jsonb_each(v_after)
    loop
      if (v_before -> v_key) is distinct from (v_after -> v_key) then
        v_changed := array_append(v_changed, v_key);
      end if;
    end loop;
  elsif tg_op = 'INSERT' then
    v_changed := array(select key from jsonb_each(v_after) where key not in ('created_at', 'updated_at'));
  else
    v_changed := array(select key from jsonb_each(v_before) where key not in ('created_at', 'updated_at'));
  end if;

  if v_org is not null then
    insert into public.audit_events (organization_id, actor_id, action, entity_name, entity_id, changed_columns)
    values (v_org, (select auth.uid()), tg_op, tg_table_name, v_entity_id, coalesce(v_changed, '{}'::text[]));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_row_change() from public, anon, authenticated;

create or replace function public.create_organization(p_name text, p_timezone text default 'UTC')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 120 then
    raise exception 'Organization name must contain 2 to 120 characters' using errcode = '22023';
  end if;
  if p_timezone is null or length(btrim(p_timezone)) not between 1 and 100 then
    raise exception 'Invalid time zone' using errcode = '22023';
  end if;

  insert into public.organizations (name, owner_user_id, timezone)
  values (btrim(p_name), v_user_id, btrim(p_timezone))
  returning id into v_org_id;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org_id, v_user_id, 'owner', 'active');

  return v_org_id;
end;
$$;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.quantity_delta > 0 then
    update public.products p
    set average_cost = case
          when p.stock_quantity + new.quantity_delta > 0
            then round(((p.stock_quantity * p.average_cost) + (new.quantity_delta * new.unit_cost)) / (p.stock_quantity + new.quantity_delta), 4)
          else p.average_cost
        end,
        stock_quantity = p.stock_quantity + new.quantity_delta
    where p.id = new.product_id
      and p.organization_id = new.organization_id
      and p.tracks_inventory
      and p.stock_quantity + new.quantity_delta >= 0;
  else
    update public.products p
    set stock_quantity = p.stock_quantity + new.quantity_delta
    where p.id = new.product_id
      and p.organization_id = new.organization_id
      and p.tracks_inventory
      and p.stock_quantity + new.quantity_delta >= 0;
  end if;

  if not found then
    raise exception 'Stock movement rejected: product missing, not stock-tracked, or insufficient stock'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.apply_stock_movement() from public, anon, authenticated;
create trigger stock_movement_apply_balance
before insert on public.stock_movements
for each row execute function private.apply_stock_movement();

create or replace function public.post_document(p_document_id uuid, p_idempotency_key text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc public.documents%rowtype;
  v_line record;
  v_unit_cost numeric(14,4);
  v_total numeric(16,2);
  v_cost_total numeric(16,2);
  v_line_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 160 then
    raise exception 'A stable idempotency key of 8-160 characters is required' using errcode = '22023';
  end if;

  select * into v_doc
  from public.documents d
  where d.id = p_document_id
  for update;

  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not private.can_edit_org(v_doc.organization_id) then raise exception 'Organization access denied or write subscription is inactive' using errcode = '42501'; end if;

  if v_doc.status = 'posted' then
    if v_doc.post_idempotency_key = p_idempotency_key then return v_doc.id; end if;
    raise exception 'Document is already posted with another key' using errcode = '23505';
  end if;
  if v_doc.status <> 'draft' then raise exception 'Only draft documents can be posted' using errcode = '23514'; end if;

  select count(*) into v_line_count
  from public.document_items i
  where i.organization_id = v_doc.organization_id and i.document_id = v_doc.id;
  if v_line_count = 0 then raise exception 'Cannot post an empty document' using errcode = '23514'; end if;

  for v_line in
    select i.id, i.product_id, i.quantity, i.unit_price,
           p.tracks_inventory, p.average_cost, p.is_archived, p.name, p.unit
    from public.document_items i
    join public.products p
      on p.organization_id = i.organization_id and p.id = i.product_id
    where i.organization_id = v_doc.organization_id and i.document_id = v_doc.id
    order by p.id, i.id
    for update of p
  loop
    if v_line.is_archived then raise exception 'Archived products cannot be used in new posted documents' using errcode = '23514'; end if;

    if v_doc.kind = 'receipt' then
      v_unit_cost := v_line.unit_price;
    else
      v_unit_cost := v_line.average_cost;
    end if;

    update public.document_items
    set unit_cost = v_unit_cost
    where organization_id = v_doc.organization_id and id = v_line.id;

    if v_line.tracks_inventory and v_doc.kind in ('receipt', 'sale') then
      insert into public.stock_movements (
        organization_id, product_id, movement_type, quantity_delta, unit_cost,
        source_document_id, source_document_item_id, created_by
      ) values (
        v_doc.organization_id,
        v_line.product_id,
        case when v_doc.kind = 'receipt' then 'receipt' else 'sale' end,
        case when v_doc.kind = 'receipt' then v_line.quantity else -v_line.quantity end,
        v_unit_cost,
        v_doc.id,
        v_line.id,
        (select auth.uid())
      );
    end if;
  end loop;

  select coalesce(sum(i.line_total), 0), coalesce(sum(i.line_cost_total), 0)
  into v_total, v_cost_total
  from public.document_items i
  where i.organization_id = v_doc.organization_id and i.document_id = v_doc.id;

  update public.documents
  set status = 'posted',
      posted_at = now(),
      post_idempotency_key = p_idempotency_key,
      total_amount = v_total,
      total_cost = v_cost_total
  where id = v_doc.id and organization_id = v_doc.organization_id;

  return v_doc.id;
end;
$$;
revoke all on function public.post_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid, text) to authenticated;

create or replace function public.post_production_batch(p_batch_id uuid, p_idempotency_key text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.production_batches%rowtype;
  v_input record;
  v_output record;
  v_total_cost numeric(16,2) := 0;
  v_unit_cost numeric(14,4);
  v_input_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 160 then
    raise exception 'A stable idempotency key of 8-160 characters is required' using errcode = '22023';
  end if;

  select * into v_batch
  from public.production_batches b
  where b.id = p_batch_id
  for update;

  if not found then raise exception 'Production batch not found' using errcode = 'P0002'; end if;
  if not private.can_edit_org(v_batch.organization_id) then raise exception 'Organization access denied or write subscription is inactive' using errcode = '42501'; end if;

  if v_batch.status = 'posted' then
    if v_batch.post_idempotency_key = p_idempotency_key then return v_batch.id; end if;
    raise exception 'Production batch is already posted with another key' using errcode = '23505';
  end if;
  if v_batch.status <> 'draft' then raise exception 'Only draft batches can be posted' using errcode = '23514'; end if;

  select count(*) into v_input_count
  from public.production_batch_inputs i
  where i.organization_id = v_batch.organization_id and i.batch_id = v_batch.id;
  if v_input_count = 0 then raise exception 'Production batch requires at least one input' using errcode = '23514'; end if;

  if exists (
    select 1 from public.production_batch_inputs i
    where i.organization_id = v_batch.organization_id
      and i.batch_id = v_batch.id
      and i.product_id = v_batch.output_product_id
  ) then
    raise exception 'Output product cannot also be an input in the same batch' using errcode = '23514';
  end if;

  for v_input in
    select i.id, i.product_id, i.quantity, p.average_cost, p.tracks_inventory, p.is_archived
    from public.production_batch_inputs i
    join public.products p
      on p.organization_id = i.organization_id and p.id = i.product_id
    where i.organization_id = v_batch.organization_id and i.batch_id = v_batch.id
    order by p.id, i.id
    for update of p
  loop
    if not v_input.tracks_inventory or v_input.is_archived then
      raise exception 'Production inputs must be active stock-tracked products' using errcode = '23514';
    end if;

    v_unit_cost := v_input.average_cost;
    v_total_cost := v_total_cost + round(v_input.quantity * v_unit_cost, 2);

    update public.production_batch_inputs
    set unit_cost = v_unit_cost
    where organization_id = v_batch.organization_id and id = v_input.id;

    insert into public.stock_movements (
      organization_id, product_id, movement_type, quantity_delta, unit_cost,
      source_production_batch_id, source_production_input_id, created_by
    ) values (
      v_batch.organization_id, v_input.product_id, 'production_input',
      -v_input.quantity, v_unit_cost, v_batch.id, v_input.id, (select auth.uid())
    );
  end loop;

  select p.id, p.tracks_inventory, p.is_archived
  into v_output
  from public.products p
  where p.organization_id = v_batch.organization_id and p.id = v_batch.output_product_id
  for update;

  if not found or not v_output.tracks_inventory or v_output.is_archived then
    raise exception 'Production output must be an active stock-tracked product' using errcode = '23514';
  end if;

  v_total_cost := round(v_total_cost, 2);
  v_unit_cost := round(v_total_cost / v_batch.output_quantity, 4);

  update public.production_batches
  set status = 'posted',
      total_cost = v_total_cost,
      posted_at = now(),
      post_idempotency_key = p_idempotency_key
  where organization_id = v_batch.organization_id and id = v_batch.id;

  insert into public.stock_movements (
    organization_id, product_id, movement_type, quantity_delta, unit_cost,
    source_production_batch_id, created_by
  ) values (
    v_batch.organization_id, v_batch.output_product_id, 'production_output',
    v_batch.output_quantity, v_unit_cost, v_batch.id, (select auth.uid())
  );

  return v_batch.id;
end;
$$;
revoke all on function public.post_production_batch(uuid, text) from public, anon;
grant execute on function public.post_production_batch(uuid, text) to authenticated;

create or replace function public.record_payment_with_allocations(
  p_organization_id uuid,
  p_client_id uuid,
  p_amount numeric,
  p_method text,
  p_allocations jsonb,
  p_idempotency_key text,
  p_note text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_alloc record;
  v_doc public.documents%rowtype;
  v_due numeric(14,2);
  v_allocation_total numeric(14,2);
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not private.can_edit_org(p_organization_id) then raise exception 'Organization access denied or write subscription is inactive' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be positive' using errcode = '22023'; end if;
  if p_method not in ('cash', 'transfer', 'bank') then raise exception 'Unsupported payment method' using errcode = '22023'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 160 then
    raise exception 'A stable idempotency key of 8-160 characters is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'At least one document allocation is required' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients c
    where c.organization_id = p_organization_id and c.id = p_client_id and not c.is_archived
  ) then
    raise exception 'Client not found or archived' using errcode = '23503';
  end if;

  select round(sum(x.amount), 2) into v_allocation_total
  from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric);
  if v_allocation_total is distinct from round(p_amount, 2) then
    raise exception 'Payment amount must equal the sum of allocations' using errcode = '23514';
  end if;

  if (select count(*) from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric))
     <> (select count(distinct x.document_id) from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric)) then
    raise exception 'Do not repeat the same document in allocation list' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric) where x.amount is null or x.amount <= 0) then
    raise exception 'Every allocation amount must be positive' using errcode = '23514';
  end if;

  v_fingerprint := md5(
    p_organization_id::text || '|' || coalesce(p_client_id::text, '') || '|' ||
    round(p_amount, 2)::text || '|' || p_method || '|' || p_allocations::text || '|' || coalesce(p_note, '')
  );
  select p.id, p.request_fingerprint into v_payment_id, v_existing_fingerprint
  from public.payments p
  where p.organization_id = p_organization_id and p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used for a different payment request' using errcode = '23505';
    end if;
    return v_payment_id;
  end if;

  -- Lock documents in a deterministic order to avoid racing partial payments.
  for v_alloc in
    select x.document_id, round(x.amount, 2)::numeric(14,2) as amount
    from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric)
    order by x.document_id
  loop
    select * into v_doc
    from public.documents d
    where d.organization_id = p_organization_id and d.id = v_alloc.document_id
    for update;

    if not found then raise exception 'Allocated document not found in this organization' using errcode = '23503'; end if;
    if v_doc.status <> 'posted' or v_doc.kind not in ('sale', 'service') then
      raise exception 'Payments can be allocated only to posted sales and services' using errcode = '23514';
    end if;
    if v_doc.counterparty_id is distinct from p_client_id then
      raise exception 'Payment client does not match every allocated document' using errcode = '23514';
    end if;

    select round(v_doc.total_amount - coalesce(sum(a.amount), 0), 2)
    into v_due
    from public.payment_allocations a
    where a.organization_id = p_organization_id and a.document_id = v_doc.id;

    if v_alloc.amount > v_due then
      raise exception 'Allocation exceeds the document balance' using errcode = '23514';
    end if;
  end loop;

  insert into public.payments (
    organization_id, client_id, amount, payment_method, idempotency_key,
    request_fingerprint, note, created_by
  ) values (
    p_organization_id, p_client_id, round(p_amount, 2), p_method, p_idempotency_key,
    v_fingerprint, nullif(btrim(p_note), ''), (select auth.uid())
  ) returning id into v_payment_id;

  for v_alloc in
    select x.document_id, round(x.amount, 2)::numeric(14,2) as amount
    from jsonb_to_recordset(p_allocations) as x(document_id uuid, amount numeric)
    order by x.document_id
  loop
    insert into public.payment_allocations (organization_id, payment_id, document_id, amount)
    values (p_organization_id, v_payment_id, v_alloc.document_id, v_alloc.amount);
  end loop;

  return v_payment_id;
end;
$$;
revoke all on function public.record_payment_with_allocations(uuid, uuid, numeric, text, jsonb, text, text) from public, anon;
grant execute on function public.record_payment_with_allocations(uuid, uuid, numeric, text, jsonb, text, text) to authenticated;

-- Payment totals are derived from allocations, not counted again as revenue.
create or replace view public.document_balances
with (security_invoker = true)
as
select d.id,
       d.organization_id,
       d.document_number,
       d.kind,
       d.status,
       d.document_date,
       d.counterparty_id,
       d.counterparty_name_snapshot,
       d.total_amount,
       d.total_cost,
       coalesce(a.amount_paid, 0)::numeric(14,2) as amount_paid,
       greatest(d.total_amount - coalesce(a.amount_paid, 0), 0)::numeric(14,2) as balance_due
from public.documents d
left join (
  select organization_id, document_id, sum(amount)::numeric(14,2) as amount_paid
  from public.payment_allocations
  group by organization_id, document_id
) a on a.organization_id = d.organization_id and a.document_id = d.id;
grant select on public.document_balances to authenticated;

-- Enable RLS on every public table created by this migration.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'organizations', 'organization_members', 'clients', 'products',
    'documents', 'document_items', 'production_batches', 'production_batch_inputs',
    'stock_movements', 'expense_categories', 'expenses', 'payments',
    'payment_allocations', 'subscription_plans', 'organization_subscriptions',
    'subscription_payment_events', 'backup_exports', 'import_runs', 'audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- Revoke client access by default, then grant only table operations needed by the app.
revoke all on public.profiles, public.organizations, public.organization_members, public.clients,
  public.products, public.documents, public.document_items, public.production_batches,
  public.production_batch_inputs, public.stock_movements, public.expense_categories,
  public.expenses, public.payments, public.payment_allocations, public.subscription_plans,
  public.organization_subscriptions, public.subscription_payment_events, public.backup_exports,
  public.import_runs, public.audit_events from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant update (name, timezone) on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, insert, update on public.clients, public.expense_categories to authenticated;
grant select on public.products to authenticated;
grant insert (organization_id, name, product_type, category, unit, tracks_inventory,
              purchase_price, sale_price, photo_path, is_archived, archived_at,
              legacy_source_name, legacy_source_id, created_by)
  on public.products to authenticated;
grant update (name, product_type, category, unit, tracks_inventory, purchase_price,
              sale_price, photo_path, is_archived, archived_at,
              legacy_source_name, legacy_source_id)
  on public.products to authenticated;
grant select, insert, update, delete on public.documents, public.document_items,
  public.production_batches, public.production_batch_inputs to authenticated;
grant select on public.stock_movements, public.payments, public.payment_allocations,
  public.organization_subscriptions, public.backup_exports, public.import_runs, public.audit_events to authenticated;
grant select on public.subscription_plans to authenticated;
grant select, insert, update on public.expenses to authenticated;

-- Per-user profile access.
create policy profiles_select_self on public.profiles
for select to authenticated
using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- An organization is visible only to its active members.
create policy organizations_select_member on public.organizations
for select to authenticated
using (private.is_org_member(id));
create policy organizations_update_admin on public.organizations
for update to authenticated
using (private.has_org_role(id, array['owner', 'admin']))
with check (private.has_org_role(id, array['owner', 'admin']));

create policy organization_members_select_related on public.organization_members
for select to authenticated
using (user_id = (select auth.uid()) or private.is_org_member(organization_id));

-- Client and product CRUD is tenant-scoped and subscription-gated; archival is an update, not deletion.
create policy clients_select_member on public.clients
for select to authenticated using (private.is_org_member(organization_id));
create policy clients_insert_entitled on public.clients
for insert to authenticated with check (private.can_edit_org(organization_id));
create policy clients_update_entitled on public.clients
for update to authenticated
using (private.can_edit_org(organization_id))
with check (private.can_edit_org(organization_id));

create policy products_select_member on public.products
for select to authenticated using (private.is_org_member(organization_id));
create policy products_insert_entitled on public.products
for insert to authenticated with check (private.can_edit_org(organization_id));
create policy products_update_entitled on public.products
for update to authenticated
using (private.can_edit_org(organization_id))
with check (private.can_edit_org(organization_id));

-- Documents remain editable only while draft; posting must go through the atomic RPC.
create policy documents_select_member on public.documents
for select to authenticated using (private.is_org_member(organization_id));
create policy documents_insert_draft on public.documents
for insert to authenticated
with check (status = 'draft' and private.can_edit_org(organization_id));
create policy documents_update_draft on public.documents
for update to authenticated
using (status = 'draft' and private.can_edit_org(organization_id))
with check (status = 'draft' and private.can_edit_org(organization_id));
create policy documents_delete_draft on public.documents
for delete to authenticated
using (status = 'draft' and private.can_edit_org(organization_id));

create policy document_items_select_member on public.document_items
for select to authenticated using (private.is_org_member(organization_id));
create policy document_items_insert_draft on public.document_items
for insert to authenticated
with check (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.documents d where d.id = document_id
              and d.organization_id = document_items.organization_id and d.status = 'draft')
);
create policy document_items_update_draft on public.document_items
for update to authenticated
using (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.documents d where d.id = document_id
              and d.organization_id = document_items.organization_id and d.status = 'draft')
)
with check (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.documents d where d.id = document_id
              and d.organization_id = document_items.organization_id and d.status = 'draft')
);
create policy document_items_delete_draft on public.document_items
for delete to authenticated
using (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.documents d where d.id = document_id
              and d.organization_id = document_items.organization_id and d.status = 'draft')
);

create policy production_batches_select_member on public.production_batches
for select to authenticated using (private.is_org_member(organization_id));
create policy production_batches_insert_draft on public.production_batches
for insert to authenticated
with check (status = 'draft' and private.can_edit_org(organization_id));
create policy production_batches_update_draft on public.production_batches
for update to authenticated
using (status = 'draft' and private.can_edit_org(organization_id))
with check (status = 'draft' and private.can_edit_org(organization_id));
create policy production_batches_delete_draft on public.production_batches
for delete to authenticated
using (status = 'draft' and private.can_edit_org(organization_id));

create policy production_batch_inputs_select_member on public.production_batch_inputs
for select to authenticated using (private.is_org_member(organization_id));
create policy production_batch_inputs_insert_draft on public.production_batch_inputs
for insert to authenticated
with check (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.production_batches b where b.id = batch_id
              and b.organization_id = production_batch_inputs.organization_id and b.status = 'draft')
);
create policy production_batch_inputs_update_draft on public.production_batch_inputs
for update to authenticated
using (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.production_batches b where b.id = batch_id
              and b.organization_id = production_batch_inputs.organization_id and b.status = 'draft')
)
with check (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.production_batches b where b.id = batch_id
              and b.organization_id = production_batch_inputs.organization_id and b.status = 'draft')
);
create policy production_batch_inputs_delete_draft on public.production_batch_inputs
for delete to authenticated
using (
  private.can_edit_org(organization_id)
  and exists (select 1 from public.production_batches b where b.id = batch_id
              and b.organization_id = production_batch_inputs.organization_id and b.status = 'draft')
);

create policy stock_movements_select_member on public.stock_movements
for select to authenticated using (private.is_org_member(organization_id));

create policy expense_categories_select_member on public.expense_categories
for select to authenticated using (private.is_org_member(organization_id));
create policy expense_categories_insert_entitled on public.expense_categories
for insert to authenticated with check (private.can_edit_org(organization_id));
create policy expense_categories_update_entitled on public.expense_categories
for update to authenticated
using (private.can_edit_org(organization_id))
with check (private.can_edit_org(organization_id));

create policy expenses_select_member on public.expenses
for select to authenticated using (private.is_org_member(organization_id));
create policy expenses_insert_entitled on public.expenses
for insert to authenticated with check (private.can_edit_org(organization_id));
create policy expenses_update_entitled on public.expenses
for update to authenticated
using (not is_voided and private.can_edit_org(organization_id))
with check (private.can_edit_org(organization_id));

create policy payments_select_member on public.payments
for select to authenticated using (private.is_org_member(organization_id));
create policy payment_allocations_select_member on public.payment_allocations
for select to authenticated using (private.is_org_member(organization_id));

create policy subscription_plans_select_active on public.subscription_plans
for select to authenticated using (is_active);
create policy organization_subscriptions_select_admin on public.organization_subscriptions
for select to authenticated using (private.has_org_role(organization_id, array['owner', 'admin']));

create policy backup_exports_select_member on public.backup_exports
for select to authenticated using (private.is_org_member(organization_id));
create policy import_runs_select_member on public.import_runs
for select to authenticated using (private.is_org_member(organization_id));
create policy audit_events_select_admin on public.audit_events
for select to authenticated using (private.has_org_role(organization_id, array['owner', 'admin']));

-- The storage bucket is private. Objects live at <organization-uuid>/products/... or /documents/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'koptilnya-private',
  'koptilnya-private',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy koptilnya_storage_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'koptilnya-private'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.is_org_member(((storage.foldername(name))[1])::uuid)
    else false
  end
);
create policy koptilnya_storage_insert_entitled on storage.objects
for insert to authenticated
with check (
  bucket_id = 'koptilnya-private'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.is_org_member(((storage.foldername(name))[1])::uuid)
         and private.can_edit_org(((storage.foldername(name))[1])::uuid)
    else false
  end
);
create policy koptilnya_storage_update_entitled on storage.objects
for update to authenticated
using (
  bucket_id = 'koptilnya-private'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.is_org_member(((storage.foldername(name))[1])::uuid)
         and private.can_edit_org(((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'koptilnya-private'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.is_org_member(((storage.foldername(name))[1])::uuid)
         and private.can_edit_org(((storage.foldername(name))[1])::uuid)
    else false
  end
);
create policy koptilnya_storage_delete_entitled on storage.objects
for delete to authenticated
using (
  bucket_id = 'koptilnya-private'
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.is_org_member(((storage.foldername(name))[1])::uuid)
         and private.can_edit_org(((storage.foldername(name))[1])::uuid)
    else false
  end
);

-- Keep audit metadata limited to changed column names (not complete rows containing phones/notes).
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'products', 'documents', 'document_items',
                            'production_batches', 'production_batch_inputs', 'expenses',
                            'payments', 'payment_allocations']
  loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t);
  end loop;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'products', 'documents', 'document_items',
                            'production_batches', 'production_batch_inputs',
                            'expense_categories', 'expenses']
  loop
    execute format('drop trigger if exists prevent_tenant_reassignment on public.%I', t);
    execute format('create trigger prevent_tenant_reassignment before update on public.%I for each row execute function private.prevent_tenant_reassignment()', t);
  end loop;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'organizations', 'clients', 'products', 'documents',
                            'production_batches', 'expense_categories', 'expenses',
                            'subscription_plans', 'organization_subscriptions']
  loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
  end loop;
end
$$;

-- Intentionally no recipe/technology table or write RPC in this baseline.
-- The UI must show a non-interactive "Скоро" stub until that module is explicitly implemented.
