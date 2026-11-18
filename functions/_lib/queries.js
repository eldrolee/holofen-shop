import { LOW_STOCK_AT, orderTarget } from "./inventory.js";
import { centsToRm, csvTable, newId, nowIso } from "./http.js";
import { publicImage } from "./validate.js";

function targetFor(status, qty) {
  return status === "已到货" ? qty : 0;
}

async function run(db, stmts) {
  if (stmts.length === 1) {
    await stmts[0].run();
    return;
  }
  await db.batch(stmts);
}

function touchStock(db, productId, delta, now) {
  return db.prepare(
    "UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?",
  ).bind(delta, now, productId);
}

export async function listPublic(db) {
  const { results } = await db.prepare(
    `SELECT id, name, series, language, type, sell_price_cents, stock_qty, image, legacy_id, example
     FROM products WHERE active = 1 ORDER BY series, name`,
  ).all();
  const hidden = await db.prepare(
    `SELECT legacy_id FROM products
     WHERE active = 0 AND legacy_id IS NOT NULL AND legacy_id <> ''`,
  ).all();
  return {
    products: (results || []).map((row) => ({
      id: row.id,
      name: row.name,
      series: row.series,
      language: row.language,
      type: row.type,
      sell_price_cents: row.sell_price_cents,
      stock_qty: row.stock_qty,
      image: publicImage(row.image),
      legacy_id: row.legacy_id,
      example: row.example === 1,
    })),
    hidden_legacy_ids: (hidden.results || []).map((row) => row.legacy_id),
  };
}

export async function dashboard(db) {
  const low = await db.prepare(
    `SELECT id, name, series, language, type, stock_qty, sell_price_cents, cost_cents
     FROM products WHERE active = 1 AND stock_qty <= ? ORDER BY stock_qty, name`,
  ).bind(LOW_STOCK_AT).all();
  const unpaid = await db.prepare(
    `SELECT id, order_date, buyer, channel, shipping_status, created_by
     FROM orders WHERE cancelled = 0 AND payment_status = '未付款'
     ORDER BY order_date DESC, created_at DESC LIMIT 20`,
  ).all();
  const unshipped = await db.prepare(
    `SELECT id, order_date, buyer, channel, payment_status, created_by
     FROM orders WHERE cancelled = 0 AND shipping_status = '未寄出'
     ORDER BY order_date DESC, created_at DESC LIMIT 20`,
  ).all();
  const value = await db.prepare(
    "SELECT COALESCE(SUM(stock_qty * cost_cents), 0) AS cents FROM products",
  ).first();
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE cancelled = 0 AND payment_status = '未付款') AS unpaid,
       (SELECT COUNT(*) FROM orders WHERE cancelled = 0 AND shipping_status = '未寄出') AS unshipped,
       (SELECT COUNT(*) FROM restocks WHERE status IN ('待下单', '已下单')) AS open_restocks`,
  ).first();
  return {
    low_stock_at: LOW_STOCK_AT,
    low_stock: low.results || [],
    unpaid_orders: unpaid.results || [],
    pending_shipments: unshipped.results || [],
    unpaid_count: counts.unpaid,
    pending_shipment_count: counts.unshipped,
    open_restock_count: counts.open_restocks,
    inventory_value_cents: value.cents,
  };
}

export async function listProducts(db) {
  const { results } = await db.prepare(
    "SELECT * FROM products ORDER BY needs_restock DESC, series, name",
  ).all();
  return results || [];
}

export async function createProduct(db, input, actor) {
  const now = nowIso();
  const id = newId();
  await db.prepare(
    `INSERT INTO products (
      id, name, series, language, type, sell_price_cents, cost_cents, stock_qty, image,
      active, needs_restock, notes, legacy_id, example, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`,
  ).bind(
    id, input.name, input.series, input.language, input.type, input.sell_price_cents,
    input.cost_cents, input.stock_qty, input.image, input.active, input.notes, input.legacy_id, now, now,
  ).run();
  if (input.needs_restock) await ensureDraft(db, id, actor, input.cost_cents);
  return getProduct(db, id);
}

async function getProduct(db, id) {
  return db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
}

export async function updateProduct(db, id, input, actor) {
  const current = await getProduct(db, id);
  if (!current) return { error: "找不到这件商品。", status: 404 };
  if (input.needs_restock === 0 && current.needs_restock === 1) {
    const ordered = await db.prepare(
      "SELECT id FROM restocks WHERE product_id = ? AND status = '已下单' LIMIT 1",
    ).bind(id).first();
    if (ordered) return { error: "这件已经下单了，请先在进货单里改状态，再取消要进货。", status: 409 };
  }
  const now = nowIso();
  const next = { ...current, ...input };
  await db.prepare(
    `UPDATE products SET
      name = ?, series = ?, language = ?, type = ?, sell_price_cents = ?, cost_cents = ?,
      stock_qty = ?, image = ?, active = ?, needs_restock = ?, notes = ?, legacy_id = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    next.name, next.series, next.language, next.type, next.sell_price_cents, next.cost_cents,
    next.stock_qty, next.image, next.active, next.needs_restock, next.notes, next.legacy_id, now, id,
  ).run();
  if (input.needs_restock === 1) await ensureDraft(db, id, actor, next.cost_cents);
  if (input.needs_restock === 0) {
    await db.prepare("DELETE FROM restocks WHERE product_id = ? AND status = '待下单' AND stock_applied = 0").bind(id).run();
  }
  return { product: await getProduct(db, id) };
}

export async function setNeedsRestock(db, id, on, actor) {
  const product = await getProduct(db, id);
  if (!product) return { error: "找不到这件商品。", status: 404 };
  const now = nowIso();
  if (on) {
    await db.prepare("UPDATE products SET needs_restock = 1, updated_at = ? WHERE id = ?").bind(now, id).run();
    await ensureDraft(db, id, actor, product.cost_cents);
    return { product: await getProduct(db, id) };
  }
  const ordered = await db.prepare(
    "SELECT id FROM restocks WHERE product_id = ? AND status = '已下单' LIMIT 1",
  ).bind(id).first();
  if (ordered) return { error: "这件已经下单了，请先在进货单里改状态，再取消要进货。", status: 409 };
  await run(db, [
    db.prepare("DELETE FROM restocks WHERE product_id = ? AND status = '待下单' AND stock_applied = 0").bind(id),
    db.prepare("UPDATE products SET needs_restock = 0, updated_at = ? WHERE id = ?").bind(now, id),
  ]);
  return { product: await getProduct(db, id) };
}

async function ensureDraft(db, productId, actor, costCents) {
  const open = await db.prepare(
    "SELECT id FROM restocks WHERE product_id = ? AND status IN ('待下单', '已下单') LIMIT 1",
  ).bind(productId).first();
  if (open) return;
  const now = nowIso();
  await db.prepare(
    `INSERT INTO restocks (
      id, product_id, qty, unit_cost_cents, supplier, order_date, arrival_date, status,
      stock_applied, notes, example, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, 1, ?, '', ?, NULL, '待下单', 0, '', 0, ?, ?, ?, ?)`,
  ).bind(newId(), productId, costCents, now.slice(0, 10), actor, actor, now, now).run();
}

export async function deleteProduct(db, id) {
  const used = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM restocks WHERE product_id = ?) AS restocks,
       (SELECT COUNT(*) FROM order_items WHERE product_id = ?) AS items`,
  ).bind(id, id).first();
  if (!used) return { error: "找不到这件商品。", status: 404 };
  if (used.restocks || used.items) return { error: "这件还有进货或订单记录，请下架，不要删除。", status: 409 };
  const result = await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return { error: "找不到这件商品。", status: 404 };
  return { ok: true };
}

export async function listRestocks(db) {
  const { results } = await db.prepare(
    `SELECT r.*, p.name AS product_name, p.language, p.type, p.series,
            r.qty * r.unit_cost_cents AS total_cents
     FROM restocks r JOIN products p ON p.id = r.product_id
     ORDER BY CASE r.status WHEN '待下单' THEN 0 WHEN '已下单' THEN 1 ELSE 2 END,
              r.updated_at DESC`,
  ).all();
  return results || [];
}

export async function createRestock(db, input, actor) {
  const product = await getProduct(db, input.product_id);
  if (!product) return { error: "找不到这件商品。", status: 404 };
  const now = nowIso();
  const id = newId();
  const applied = targetFor(input.status, input.qty);
  const stmts = [
    db.prepare(
      `INSERT INTO restocks (
        id, product_id, qty, unit_cost_cents, supplier, order_date, arrival_date, status,
        stock_applied, notes, example, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
    ).bind(
      id, input.product_id, input.qty, input.unit_cost_cents, input.supplier,
      input.order_date, input.arrival_date, input.status, input.notes, actor, actor, now, now,
    ),
  ];
  if (applied) stmts.push(touchStock(db, input.product_id, applied, now));
  stmts.push(db.prepare("UPDATE restocks SET stock_applied = ? WHERE id = ?").bind(applied, id));
  stmts.push(syncFlag(db, input.product_id, now));
  await run(db, stmts);
  return { restock: await getRestock(db, id) };
}

function syncFlag(db, productId, now) {
  return db.prepare(
    `UPDATE products SET needs_restock = (
       SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM restocks
       WHERE product_id = ? AND status IN ('待下单', '已下单')
     ), updated_at = ? WHERE id = ?`,
  ).bind(productId, now, productId);
}

async function getRestock(db, id) {
  return db.prepare(
    `SELECT r.*, p.name AS product_name, r.qty * r.unit_cost_cents AS total_cents
     FROM restocks r JOIN products p ON p.id = r.product_id WHERE r.id = ?`,
  ).bind(id).first();
}

export async function updateRestock(db, id, input, actor) {
  const current = await db.prepare("SELECT * FROM restocks WHERE id = ?").bind(id).first();
  if (!current) return { error: "找不到这张进货。", status: 404 };
  const product = await getProduct(db, input.product_id);
  if (!product) return { error: "找不到这件商品。", status: 404 };
  const now = nowIso();
  const applied = targetFor(input.status, input.qty);
  const stmts = [
    db.prepare(
      `UPDATE products SET stock_qty = stock_qty - (SELECT stock_applied FROM restocks WHERE id = ?), updated_at = ?
       WHERE id = (SELECT product_id FROM restocks WHERE id = ?)`,
    ).bind(id, now, id),
    touchStock(db, input.product_id, applied, now),
    db.prepare(
      `UPDATE restocks SET
        product_id = ?, qty = ?, unit_cost_cents = ?, supplier = ?, order_date = ?, arrival_date = ?,
        status = ?, stock_applied = ?, notes = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      input.product_id, input.qty, input.unit_cost_cents, input.supplier, input.order_date,
      input.arrival_date, input.status, applied, input.notes, actor, now, id,
    ),
    syncFlag(db, current.product_id, now),
  ];
  if (current.product_id !== input.product_id) stmts.push(syncFlag(db, input.product_id, now));
  await run(db, stmts);
  return { restock: await getRestock(db, id) };
}

export async function deleteRestock(db, id) {
  const current = await db.prepare("SELECT * FROM restocks WHERE id = ?").bind(id).first();
  if (!current) return { error: "找不到这张进货。", status: 404 };
  if (current.status === "已下单") return { error: "已经下单的进货请改状态，不要直接删除。", status: 409 };
  const now = nowIso();
  await run(db, [
    db.prepare(
      `UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?`,
    ).bind(current.stock_applied, now, current.product_id),
    db.prepare("DELETE FROM restocks WHERE id = ?").bind(id),
    syncFlag(db, current.product_id, now),
  ]);
  return { ok: true };
}

async function orderItems(db, orderId) {
  const { results } = await db.prepare(
    `SELECT oi.*, p.name AS product_name FROM order_items oi
     JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY p.name`,
  ).bind(orderId).all();
  return results || [];
}

function shapeOrder(order, items) {
  const total = items.reduce((sum, line) => sum + line.qty * line.unit_price_cents, 0);
  return { ...order, items, total_cents: total };
}

export async function listOrders(db) {
  const orders = await db.prepare(
    "SELECT * FROM orders ORDER BY order_date DESC, created_at DESC LIMIT 1000",
  ).all();
  const items = await db.prepare(
    `SELECT oi.*, p.name AS product_name FROM order_items oi
     JOIN products p ON p.id = oi.product_id`,
  ).all();
  const byOrder = new Map();
  for (const line of items.results || []) {
    const list = byOrder.get(line.order_id) || [];
    list.push(line);
    byOrder.set(line.order_id, list);
  }
  return (orders.results || []).map((order) => shapeOrder(order, byOrder.get(order.id) || []));
}

function grouped(items, cancelled) {
  const map = new Map();
  if (cancelled) return map;
  for (const line of items) map.set(line.product_id, (map.get(line.product_id) || 0) + line.qty);
  return map;
}

export async function createOrder(db, input, actor) {
  const missing = await missingProducts(db, input.items);
  if (missing) return { error: "有商品不存在，订单没有保存。", status: 400 };
  const now = nowIso();
  const id = newId();
  const stmts = [
    db.prepare(
      `INSERT INTO orders (
        id, order_date, buyer, channel, payment_status, shipping_status, cancelled, notes,
        example, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(
      id, input.order_date, input.buyer, input.channel, input.payment_status,
      input.shipping_status, input.cancelled, input.notes, actor, actor, now, now,
    ),
  ];
  const want = grouped(input.items, input.cancelled);
  for (const line of input.items) {
    const applied = orderTarget(input.cancelled, line.qty);
    stmts.push(db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, qty, unit_price_cents, stock_applied)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), id, line.product_id, line.qty, line.unit_price_cents, applied));
  }
  for (const [productId, q] of want) stmts.push(touchStock(db, productId, -q, now));
  await run(db, stmts);
  return { order: shapeOrder(await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first(), await orderItems(db, id)) };
}

async function missingProducts(db, items) {
  const ids = [...new Set(items.map((line) => line.product_id))];
  const { results } = await db.prepare(
    `SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all();
  return (results || []).length !== ids.length;
}

export async function updateOrder(db, id, input, actor) {
  const current = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!current) return { error: "找不到这张订单。", status: 404 };
  const missing = await missingProducts(db, input.items);
  if (missing) return { error: "有商品不存在，订单没有保存。", status: 400 };
  const now = nowIso();
  const previous = await orderItems(db, id);
  const stmts = [];
  const back = new Map();
  for (const line of previous) back.set(line.product_id, (back.get(line.product_id) || 0) + line.stock_applied);
  for (const [productId, q] of back) stmts.push(touchStock(db, productId, q, now));
  stmts.push(db.prepare("DELETE FROM order_items WHERE order_id = ?").bind(id));
  stmts.push(db.prepare(
    `UPDATE orders SET
      order_date = ?, buyer = ?, channel = ?, payment_status = ?, shipping_status = ?,
      cancelled = ?, notes = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    input.order_date, input.buyer, input.channel, input.payment_status, input.shipping_status,
    input.cancelled, input.notes, actor, now, id,
  ));
  for (const line of input.items) {
    const applied = orderTarget(input.cancelled, line.qty);
    stmts.push(db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, qty, unit_price_cents, stock_applied)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), id, line.product_id, line.qty, line.unit_price_cents, applied));
  }
  for (const [productId, q] of grouped(input.items, input.cancelled)) stmts.push(touchStock(db, productId, -q, now));
  await run(db, stmts);
  return { order: shapeOrder(await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first(), await orderItems(db, id)) };
}

export async function deleteOrder(db, id) {
  const current = await db.prepare("SELECT id FROM orders WHERE id = ?").bind(id).first();
  if (!current) return { error: "找不到这张订单。", status: 404 };
  const previous = await orderItems(db, id);
  const now = nowIso();
  const stmts = [];
  const back = new Map();
  for (const line of previous) back.set(line.product_id, (back.get(line.product_id) || 0) + line.stock_applied);
  for (const [productId, q] of back) stmts.push(touchStock(db, productId, q, now));
  stmts.push(db.prepare("DELETE FROM order_items WHERE order_id = ?").bind(id));
  stmts.push(db.prepare("DELETE FROM orders WHERE id = ?").bind(id));
  await run(db, stmts);
  return { ok: true };
}

export async function deleteExamples(db) {
  const blocked = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id WHERE p.example = 1 AND o.example = 0) AS orders,
       (SELECT COUNT(*) FROM restocks r JOIN products p ON p.id = r.product_id
         WHERE p.example = 1 AND r.example = 0) AS restocks`,
  ).first();
  if (blocked.orders || blocked.restocks) {
    return { error: "有真实进货或订单用到示例商品，请先改掉再删除示例。", status: 409 };
  }
  const now = nowIso();
  await run(db, [
    db.prepare(
      `UPDATE products SET stock_qty = stock_qty + (
         SELECT COALESCE(SUM(oi.stock_applied), 0) FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.example = 1 AND oi.product_id = products.id
       ), updated_at = ? WHERE example = 0`,
    ).bind(now),
    db.prepare(
      `UPDATE products SET stock_qty = stock_qty - (
         SELECT COALESCE(SUM(r.stock_applied), 0) FROM restocks r
         WHERE r.example = 1 AND r.product_id = products.id
       ), updated_at = ? WHERE example = 0`,
    ).bind(now),
    db.prepare(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE example = 1)
       OR product_id IN (SELECT id FROM products WHERE example = 1)`,
    ),
    db.prepare("DELETE FROM orders WHERE example = 1"),
    db.prepare(
      "DELETE FROM restocks WHERE example = 1 OR product_id IN (SELECT id FROM products WHERE example = 1)",
    ),
    db.prepare("DELETE FROM products WHERE example = 1"),
  ]);
  return { ok: true };
}

const TYPE_LABEL = { pack: "单包", booster_box: "补充包盒", etb: "ETB", other: "其他" };

export async function productsCsv(db) {
  const rows = await listProducts(db);
  return csvTable(
    ["名称", "系列", "语言", "类型", "售价 RM", "成本 RM", "单件利润 RM", "库存", "要进货", "上架", "前台编号", "备注", "示例"],
    rows.map((p) => [
      p.name, p.series, p.language, TYPE_LABEL[p.type] || p.type,
      centsToRm(p.sell_price_cents), centsToRm(p.cost_cents), centsToRm(p.sell_price_cents - p.cost_cents),
      p.stock_qty, p.needs_restock ? "是" : "否", p.active ? "上架" : "下架",
      p.legacy_id || "", p.notes, p.example ? "示例" : "",
    ]),
  );
}

export async function ordersCsv(db) {
  const orders = await listOrders(db);
  const rows = [];
  for (const order of orders) {
    const lines = order.items.length ? order.items : [null];
    for (const line of lines) {
      rows.push([
        order.order_date, order.buyer, order.channel, order.payment_status, order.shipping_status,
        order.cancelled ? "已取消" : "",
        line ? line.product_name : "", line ? line.qty : "",
        line ? centsToRm(line.unit_price_cents) : "",
        line ? centsToRm(line.qty * line.unit_price_cents) : "",
        order.notes, order.created_by, order.updated_by, order.example ? "示例" : "",
      ]);
    }
  }
  return csvTable(
    ["日期", "买家", "渠道", "付款", "寄送", "取消", "商品", "数量", "单价 RM", "小计 RM", "备注", "创建人", "最后修改", "示例"],
    rows,
  );
}
