-- 示例数据，不是真实库存。名字和备注都标了「示例」。
-- 已到货 / 已记账的数量已经反映在 stock_qty 里（stock_applied 记着加过或扣过多少）。
-- 再改一次状态只会调整差额，不会把这批示例库存再加一遍或再扣一遍。
-- 后台总览可以「删除全部示例」。

INSERT INTO products (
  id, name, series, language, type, sell_price_cents, cost_cents, stock_qty, image,
  active, needs_restock, notes, legacy_id, example, created_at, updated_at
) VALUES
  (
    'ex-box', '【示例】Delta Reign 补充包盒', 'Delta Reign', 'EN', 'booster_box',
    82000, 64000, 3, 'img/oplc7mk5khgdcn3b.jpg',
    1, 0, '示例数据，不是真实库存。', 'p003', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'
  ),
  (
    'ex-etb', '【示例】Delta Reign 精英训练家盒', 'Delta Reign', 'EN', 'etb',
    39900, 28000, 0, 'img/o4xko3yigqpmw2m4.jpg',
    1, 0, '示例数据，不是真实库存。库存 0，前台应显示售罄。', 'p006', 1, '2026-11-01T00:00:00.000Z', '2026-11-16T00:00:00.000Z'
  ),
  (
    'ex-pack-jp', '【示例】日文 超级进化 补充包', 'Mega Evolution', 'JP', 'pack',
    2500, 1500, 12, 'img/dcwz2z64da2mfqnf.jpg',
    1, 1, '示例数据，不是真实库存。勾了要进货，所以进货单里有一行待下单。', NULL, 1, '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z'
  ),
  (
    'ex-upc', '【示例】30th Celebration 大礼盒', '30th Celebration', 'EN', 'other',
    135000, 98000, 1, 'img/sgejgxtwdmnjd5mt.jpg',
    1, 0, '示例数据，不是真实库存。只剩 1 件，总览里算低库存。', 'p024', 1, '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z'
  );

INSERT INTO restocks (
  id, product_id, qty, unit_cost_cents, supplier, order_date, arrival_date, status,
  stock_applied, notes, example, created_by, updated_by, created_at, updated_at
) VALUES
  (
    'ex-rs-box', 'ex-box', 2, 64000, '示例供应商', '2026-10-20', '2026-10-28', '已到货',
    2, '示例进货。这 2 件已经加进库存。', 1, '示例', '示例', '2026-10-20T00:00:00.000Z', '2026-10-28T00:00:00.000Z'
  ),
  (
    'ex-rs-pack', 'ex-pack-jp', 24, 1500, '示例：大阪批发', '2026-11-18', NULL, '待下单',
    0, '示例进货单，还没下单，库存不变。', 1, '示例', '示例', '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'
  );

INSERT INTO orders (
  id, order_date, buyer, channel, payment_status, shipping_status, cancelled, notes,
  example, created_by, updated_by, created_at, updated_at
) VALUES
  (
    'ex-ord-paid', '2026-11-02', '示例顾客（阿明）', 'IG', '已付款', '已寄出', 0,
    '示例订单，不是真实客人。保存时已扣库存；之后标已付款不会再扣。',
    1, '示例', '示例', '2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z'
  ),
  (
    'ex-ord-open', '2026-11-16', '示例顾客（小美）', 'WhatsApp', '未付款', '未寄出', 0,
    '示例订单，不是真实客人。未付款、未寄出，总览里两边都会出现。',
    1, '示例', '示例', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z'
  );

INSERT INTO order_items (id, order_id, product_id, qty, unit_price_cents, stock_applied) VALUES
  ('ex-oi-box', 'ex-ord-paid', 'ex-box', 1, 82000, 1),
  ('ex-oi-etb', 'ex-ord-open', 'ex-etb', 1, 39900, 1);
