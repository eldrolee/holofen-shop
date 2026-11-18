-- Holofen 店务：商品、进货、订单。金额是分（1 令吉 = 100），避免小数误差。
-- 库存不靠应用重复加减：进货的 stock_applied 是已经加进库存的数量，
-- 订单明细的 stock_applied 是已经从库存扣掉的数量。改状态或改数量只动差额。

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL CHECK (language IN ('EN', 'JP')),
  type TEXT NOT NULL CHECK (type IN ('pack', 'booster_box', 'etb', 'other')),
  sell_price_cents INTEGER NOT NULL CHECK (sell_price_cents >= 0),
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  image TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  needs_restock INTEGER NOT NULL DEFAULT 0 CHECK (needs_restock IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  legacy_id TEXT,
  example INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX products_legacy_id
  ON products (legacy_id)
  WHERE legacy_id IS NOT NULL AND legacy_id <> '';

CREATE TABLE restocks (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  supplier TEXT NOT NULL DEFAULT '',
  order_date TEXT,
  arrival_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('待下单', '已下单', '已到货')),
  stock_applied INTEGER NOT NULL DEFAULT 0 CHECK (stock_applied >= 0),
  notes TEXT NOT NULL DEFAULT '',
  example INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0, 1)),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX restocks_product ON restocks (product_id, status);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  buyer TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL CHECK (channel IN ('IG', '网站', 'WhatsApp')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('未付款', '已付款')),
  shipping_status TEXT NOT NULL CHECK (shipping_status IN ('未寄出', '已寄出', '已送达')),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  example INTEGER NOT NULL DEFAULT 0 CHECK (example IN (0, 1)),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX orders_open ON orders (cancelled, payment_status, shipping_status);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  stock_applied INTEGER NOT NULL DEFAULT 0 CHECK (stock_applied >= 0)
);

CREATE INDEX order_items_order ON order_items (order_id);
CREATE INDEX order_items_product ON order_items (product_id);
