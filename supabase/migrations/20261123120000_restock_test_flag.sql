-- 2026-11-23 店主要：进货也能勾选「测试」，用来测试每个功能。
-- 测试进货：不加库存、不改成本、不算要进货；正式记录改成测试时，已加进库存的数量会扣回。旧的 6 参数函数保留不动。
alter table public.restocks add column if not exists is_test boolean not null default false;

create or replace function public.save_restock(
  p_id uuid,
  p_product_id text,
  p_qty integer,
  p_cost integer,
  p_supplier text,
  p_status text,
  p_test boolean
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
    insert into public.restocks (product_id, qty, unit_cost_cents, supplier, status, stock_applied, is_test)
    values (p_product_id, p_qty, p_cost, p_supplier, '待进货', 0, coalesce(p_test, false))
    returning * into r;
  else
    select * into r from public.restocks where id = p_id for update;
    if not found then
      raise exception 'missing';
    end if;
    p_product_id := r.product_id;
  end if;

  -- 测试进货永远不动库存；正式改成测试时，已计入的库存会扣回
  applied := case when p_status = '已到货' and not coalesce(p_test, false) then p_qty else 0 end;
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
        stock_applied = applied,
        is_test = coalesce(p_test, false)
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

  if not coalesce(p_test, false) then
  insert into public.product_stock (product_id, cost_cents, needs_restock, updated_by, updated_at)
  values (
    p_product_id,
    p_cost,
    exists (select 1 from public.restocks where product_id = p_product_id and status in ('待进货', '已下单') and not is_test),
    coalesce(auth.jwt() ->> 'email', ''),
    now()
  )
  on conflict (product_id) do update
    set cost_cents = excluded.cost_cents,
        needs_restock = excluded.needs_restock,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  end if;

  return jsonb_build_object(
    'id', r.id,
    'product_id', r.product_id,
    'status', r.status,
    'stock_applied', r.stock_applied,
    'changed', delta <> 0,
    'stock', case when delta <> 0 then new_stock else null end,
    'is_test', r.is_test
  );
end;
$$;

grant execute on function public.save_restock(uuid, text, integer, integer, text, text, boolean) to authenticated;
