-- Holofen 进货。请在 Supabase → SQL Editor 里整段执行一次。不要在没核对前对线上库重复跑。
-- 库存数字仍在 public.docs（col='site', id='catalog'）的 data.items.<商品id>.stock。
-- 订单审核通过时，网页扣的就是这个数字；这张表只负责「已到货」时加上差额，避免加两次。
-- 成本和不进货名单只给 staff 表里的邮箱看，顾客读不到。

create table if not exists public.product_stock (
  product_id text primary key,
  cost_cents integer not null default 0 check (cost_cents >= 0),
  needs_restock boolean not null default false,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.restocks (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  qty integer not null check (qty > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  supplier text not null default '',
  status text not null check (status in ('待进货', '已下单', '已到货')),
  stock_applied integer not null default 0 check (stock_applied >= 0),
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restocks_open on public.restocks (product_id, status);

alter table public.product_stock enable row level security;
alter table public.restocks enable row level security;

drop policy if exists product_stock_staff on public.product_stock;
create policy product_stock_staff on public.product_stock
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists restocks_staff on public.restocks;
create policy restocks_staff on public.restocks
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

grant select, insert, update, delete on public.product_stock to authenticated;
grant select, insert, update, delete on public.restocks to authenticated;

create or replace function public.restocks_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.jwt() ->> 'email', '');
    new.created_at := now();
  end if;
  if tg_op <> 'DELETE' then
    new.updated_by := coalesce(auth.jwt() ->> 'email', '');
    new.updated_at := now();
  end if;
  if current_setting('holofen.restock_apply', true) is distinct from '1' then
    if tg_op = 'INSERT' and (new.status = '已到货' or new.stock_applied <> 0) then
      raise exception 'stock_locked';
    end if;
    if tg_op = 'UPDATE' and (old.status = '已到货' or new.status = '已到货' or new.stock_applied is distinct from old.stock_applied) then
      raise exception 'stock_locked';
    end if;
    if tg_op = 'DELETE' and old.stock_applied <> 0 then
      raise exception 'stock_locked';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists restocks_guard on public.restocks;
create trigger restocks_guard
  before insert or update or delete on public.restocks
  for each row execute function public.restocks_guard();

-- 改状态或数量时，只把「这次应计入」和「已经计入」的差额加进目录库存。
create or replace function public.save_restock(
  p_id uuid,
  p_product_id text,
  p_qty integer,
  p_cost integer,
  p_supplier text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.restocks%rowtype;
  applied integer;
  delta integer;
  cur integer;
  new_stock integer;
  n integer;
begin
  if public.is_staff() is distinct from true then
    raise exception 'forbidden';
  end if;
  if p_product_id is null or p_product_id !~ '^[A-Za-z0-9-]{1,40}$' then
    raise exception 'bad_product';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'bad_qty';
  end if;
  if p_cost is null or p_cost < 0 or p_cost > 100000000 then
    raise exception 'bad_cost';
  end if;
  if p_status not in ('待进货', '已下单', '已到货') then
    raise exception 'bad_status';
  end if;
  p_supplier := left(coalesce(p_supplier, ''), 120);

  if p_id is null then
    insert into public.restocks (product_id, qty, unit_cost_cents, supplier, status, stock_applied)
    values (p_product_id, p_qty, p_cost, p_supplier, '待进货', 0)
    returning * into r;
  else
    select * into r from public.restocks where id = p_id for update;
    if not found then
      raise exception 'missing';
    end if;
    p_product_id := r.product_id;
  end if;

  applied := case when p_status = '已到货' then p_qty else 0 end;
  delta := applied - r.stock_applied;
  cur := 0;
  select coalesce((data #>> array['items', p_product_id, 'stock'])::integer, 0)
    into cur
    from public.docs
    where col = 'site' and id = 'catalog';
  new_stock := coalesce(cur, 0) + delta;
  if new_stock < 0 then
    raise exception 'stock_short';
  end if;

  perform set_config('holofen.restock_apply', '1', true);
  update public.restocks
    set product_id = p_product_id,
        qty = p_qty,
        unit_cost_cents = p_cost,
        supplier = p_supplier,
        status = p_status,
        stock_applied = applied
    where id = r.id
    returning * into r;

  if delta <> 0 then
    update public.docs
      set data = jsonb_set(
        coalesce(data, '{"items":{}}'::jsonb),
        '{items}',
        coalesce(data -> 'items', '{}'::jsonb) || jsonb_build_object(
          p_product_id,
          coalesce(data -> 'items' -> r.product_id, '{}'::jsonb) || jsonb_build_object('stock', new_stock)
        ),
        true
      )
      where col = 'site' and id = 'catalog';
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'no_catalog';
    end if;
  end if;

  insert into public.product_stock (product_id, cost_cents, needs_restock, updated_by, updated_at)
  values (
    p_product_id,
    p_cost,
    exists (select 1 from public.restocks where product_id = p_product_id and status in ('待进货', '已下单')),
    coalesce(auth.jwt() ->> 'email', ''),
    now()
  )
  on conflict (product_id) do update
    set cost_cents = excluded.cost_cents,
        needs_restock = excluded.needs_restock,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'id', r.id,
    'product_id', r.product_id,
    'status', r.status,
    'stock_applied', r.stock_applied,
    'changed', delta <> 0,
    'stock', case when delta <> 0 then new_stock else null end
  );
end;
$$;

grant execute on function public.save_restock(uuid, text, integer, integer, text, text) to authenticated;
