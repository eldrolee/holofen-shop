const LANG = new Set(["EN", "JP"]);
const TYPES = new Set(["pack", "booster_box", "etb", "other"]);
const RESTOCK = new Set(["待下单", "已下单", "已到货"]);
const CHANNEL = new Set(["IG", "网站", "WhatsApp"]);
const PAY = new Set(["未付款", "已付款"]);
const SHIP = new Set(["未寄出", "已寄出", "已送达"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY = /^[A-Za-z0-9_-]{1,40}$/;

function text(value, max, { empty = true } = {}) {
  if (value == null) return empty ? "" : null;
  const s = String(value).trim();
  if (!s && !empty) return null;
  if (s.length > max) return null;
  return s;
}

function cents(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000_000) return null;
  return value;
}

function qty(value, { zero = false } = {}) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < (zero ? 0 : 1) || value > 100000) return null;
  return value;
}

function flag(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  return null;
}

function day(value, { empty = true } = {}) {
  if (value == null || value === "") return empty ? null : undefined;
  const s = String(value).trim();
  if (!DATE.test(s)) return undefined;
  return s;
}

export function publicImage(image) {
  const s = String(image || "");
  if (/^https:\/\/[^\s]+$/.test(s) && s.length <= 300) return s;
  if (/^(img|big|hd|sprite|prod)\/[A-Za-z0-9._-]+$/.test(s)) return s;
  return "";
}

export function readProduct(body, { partial = false } = {}) {
  const out = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 120, { empty: false });
    if (!name) return { error: "请填写商品名称。" };
    out.name = name;
  }
  if (!partial || "series" in body) {
    const series = text(body.series, 80);
    if (series == null) return { error: "系列名称太长。" };
    out.series = series;
  }
  if (!partial || "language" in body) {
    if (!LANG.has(body.language)) return { error: "语言请选英文或日文。" };
    out.language = body.language;
  }
  if (!partial || "type" in body) {
    if (!TYPES.has(body.type)) return { error: "类型请选单包、补充包盒、ETB 或其他。" };
    out.type = body.type;
  }
  if (!partial || "sell_price_cents" in body) {
    const sell = cents(body.sell_price_cents);
    if (sell == null) return { error: "售价要填 0 或以上的金额。" };
    out.sell_price_cents = sell;
  }
  if (!partial || "cost_cents" in body) {
    const cost = cents(body.cost_cents);
    if (cost == null) return { error: "成本要填 0 或以上的金额。" };
    out.cost_cents = cost;
  }
  if (!partial || "stock_qty" in body) {
    const stock = qty(body.stock_qty, { zero: true });
    if (stock == null) return { error: "库存要填 0 或以上的整数。" };
    out.stock_qty = stock;
  }
  if (!partial || "image" in body) {
    const image = text(body.image, 300);
    if (image == null) return { error: "图片地址太长。" };
    if (image && !publicImage(image)) return { error: "图片请填本站路径（例如 img/xxx.jpg）或 https 链接。" };
    out.image = image;
  }
  if (!partial || "active" in body) {
    const active = flag(body.active);
    if (active == null) return { error: "请选择上架或下架。" };
    out.active = active;
  }
  if (!partial || "needs_restock" in body) {
    const needs = flag(body.needs_restock);
    if (needs == null) return { error: "要进货请选是或否。" };
    out.needs_restock = needs;
  }
  if (!partial || "notes" in body) {
    const notes = text(body.notes, 2000);
    if (notes == null) return { error: "备注太长。" };
    out.notes = notes;
  }
  if (!partial || "legacy_id" in body) {
    const legacy = text(body.legacy_id, 40);
    if (legacy == null) return { error: "前台编号太长。" };
    if (legacy && !LEGACY.test(legacy)) return { error: "前台编号只能用字母、数字、横线。" };
    out.legacy_id = legacy || null;
  }
  return { value: out };
}

export function readRestock(body) {
  if (!body || typeof body.product_id !== "string" || !body.product_id) return { error: "请选择商品。" };
  const q = qty(body.qty);
  if (q == null) return { error: "进货数量要填 1 或以上的整数。" };
  const cost = cents(body.unit_cost_cents);
  if (cost == null) return { error: "进货单价要填 0 或以上的金额。" };
  const supplier = text(body.supplier, 120);
  if (supplier == null) return { error: "供应商名称太长。" };
  if (!RESTOCK.has(body.status)) return { error: "状态请选待下单、已下单或已到货。" };
  const orderDate = day(body.order_date);
  if (orderDate === undefined) return { error: "下单日期格式要用 YYYY-MM-DD。" };
  const arrival = day(body.arrival_date);
  if (arrival === undefined) return { error: "到货日期格式要用 YYYY-MM-DD。" };
  const notes = text(body.notes, 2000);
  if (notes == null) return { error: "备注太长。" };
  return {
    value: {
      product_id: body.product_id,
      qty: q,
      unit_cost_cents: cost,
      supplier,
      status: body.status,
      order_date: orderDate,
      arrival_date: arrival,
      notes,
    },
  };
}

export function readOrder(body) {
  const orderDate = day(body && body.order_date, { empty: false });
  if (!orderDate) return { error: "请填写订单日期（YYYY-MM-DD）。" };
  const buyer = text(body.buyer, 120, { empty: false });
  if (!buyer) return { error: "请填写买家。" };
  if (!CHANNEL.has(body.channel)) return { error: "渠道请选 IG、网站或 WhatsApp。" };
  if (!PAY.has(body.payment_status)) return { error: "付款状态请选未付款或已付款。" };
  if (!SHIP.has(body.shipping_status)) return { error: "寄送状态请选未寄出、已寄出或已送达。" };
  const cancelled = flag(body.cancelled);
  if (cancelled == null) return { error: "请说明订单是否取消。" };
  const notes = text(body.notes, 2000);
  if (notes == null) return { error: "备注太长。" };
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return { error: "一张订单要有 1 到 30 行商品。" };
  const items = [];
  for (const line of body.items) {
    if (!line || typeof line.product_id !== "string" || !line.product_id) return { error: "每一行都要选择商品。" };
    const q = qty(line.qty);
    if (q == null) return { error: "购买数量要填 1 或以上的整数。" };
    const price = cents(line.unit_price_cents);
    if (price == null) return { error: "成交价要填 0 或以上的金额。" };
    items.push({ product_id: line.product_id, qty: q, unit_price_cents: price });
  }
  return {
    value: {
      order_date: orderDate,
      buyer,
      channel: body.channel,
      payment_status: body.payment_status,
      shipping_status: body.shipping_status,
      cancelled,
      notes,
      items,
    },
  };
}
