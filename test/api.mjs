const base = process.env.BASE || "http://127.0.0.1:8788";

function fail(msg) { console.error(msg); process.exitCode = 1; throw new Error(msg); }
async function api(path, opt = {}) {
  const res = await fetch(base + path, {
    method: opt.method || "GET",
    headers: opt.body ? { "content-type": "application/json" } : undefined,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data };
}
const assert = (cond, msg) => { if (!cond) fail(msg); };

const pub = await api("/api/products");
assert(pub.status === 200, "public products " + pub.status);
assert(Array.isArray(pub.data.products) && pub.data.products.length >= 4, "seed missing");
for (const row of pub.data.products) {
  assert(!("cost_cents" in row) && !("notes" in row) && !("created_by" in row), "public row leaked a private field");
}
const etb = pub.data.products.find((p) => p.id === "ex-etb");
assert(etb && etb.stock_qty === 0 && etb.example === true, "example ETB should be sold out");
const box = pub.data.products.find((p) => p.id === "ex-box");
assert(box && box.sell_price_cents === 82000 && box.stock_qty === 3 && box.legacy_id === "p003", "example box stock");

const me = await api("/api/admin/me");
assert(me.status === 200 && me.data.role === "admin" && me.data.local === true, "local admin " + JSON.stringify(me.data));

const dash = await api("/api/admin/dashboard");
assert(dash.status === 200, "dashboard");
assert(dash.data.unpaid_count >= 1 && dash.data.pending_shipment_count >= 1, "dashboard counts");
assert(dash.data.inventory_value_cents > 0, "inventory value");
assert(dash.data.low_stock.some((p) => p.id === "ex-etb" || p.id === "ex-upc"), "low stock");

const created = await api("/api/admin/products", {
  method: "POST",
  body: {
    name: "测试商品", series: "Test", language: "JP", type: "pack",
    sell_price_cents: 2000, cost_cents: 1000, stock_qty: 5, image: "",
    active: true, needs_restock: false, notes: "", legacy_id: "",
  },
});
assert(created.status === 201, "create product " + JSON.stringify(created.data));
const id = created.data.product.id;

async function stock() {
  const list = await api("/api/admin/products");
  return list.data.products.find((p) => p.id === id).stock_qty;
}
assert(await stock() === 5, "opening stock");

const draft = await api("/api/admin/restocks", {
  method: "POST",
  body: { product_id: id, qty: 3, unit_cost_cents: 900, supplier: "测试供应商", status: "待下单", order_date: "2026-11-18", arrival_date: null, notes: "" },
});
assert(draft.status === 201, "draft restock " + JSON.stringify(draft.data));
assert(await stock() === 5, "待下单 must not change stock");
const rid = draft.data.restock.id;
assert(draft.data.restock.created_by === "local-dev@localhost", "created_by");

const arrived = await api("/api/admin/restocks/" + rid, {
  method: "PATCH",
  body: { product_id: id, qty: 3, unit_cost_cents: 900, supplier: "测试供应商", status: "已到货", order_date: "2026-11-18", arrival_date: "2026-11-18", notes: "" },
});
assert(arrived.status === 200, "arrive " + JSON.stringify(arrived.data));
assert(await stock() === 8, "到货 adds 3, got " + await stock());

const again = await api("/api/admin/restocks/" + rid, {
  method: "PATCH",
  body: { product_id: id, qty: 3, unit_cost_cents: 900, supplier: "测试供应商", status: "已到货", order_date: "2026-11-18", arrival_date: "2026-11-18", notes: "再存一次" },
});
assert(again.status === 200 && await stock() === 8, "saving 已到货 again must not add stock, got " + await stock());

const more = await api("/api/admin/restocks/" + rid, {
  method: "PATCH",
  body: { product_id: id, qty: 4, unit_cost_cents: 900, supplier: "测试供应商", status: "已到货", order_date: "2026-11-18", arrival_date: "2026-11-18", notes: "" },
});
assert(more.status === 200 && await stock() === 9, "qty change adds the difference, got " + await stock());

const order = await api("/api/admin/orders", {
  method: "POST",
  body: {
    order_date: "2026-11-18", buyer: "测试买家", channel: "IG", payment_status: "未付款",
    shipping_status: "未寄出", cancelled: false, notes: "",
    items: [{ product_id: id, qty: 2, unit_price_cents: 2000 }],
  },
});
assert(order.status === 201, "order " + JSON.stringify(order.data));
assert(await stock() === 7, "recording an order deducts, got " + await stock());
const oid = order.data.order.id;
assert(order.data.order.created_by === "local-dev@localhost", "order created_by");

const paid = await api("/api/admin/orders/" + oid, {
  method: "PATCH",
  body: {
    order_date: "2026-11-18", buyer: "测试买家", channel: "IG", payment_status: "已付款",
    shipping_status: "未寄出", cancelled: false, notes: "",
    items: [{ product_id: id, qty: 2, unit_price_cents: 2000 }],
  },
});
assert(paid.status === 200 && await stock() === 7, "paying must not deduct again, got " + await stock());

const bigger = await api("/api/admin/orders/" + oid, {
  method: "PATCH",
  body: {
    order_date: "2026-11-18", buyer: "测试买家", channel: "WhatsApp", payment_status: "已付款",
    shipping_status: "已寄出", cancelled: false, notes: "",
    items: [{ product_id: id, qty: 3, unit_price_cents: 2000 }],
  },
});
assert(bigger.status === 200 && await stock() === 6, "qty edit deducts the difference, got " + await stock());

const tooMany = await api("/api/admin/orders/" + oid, {
  method: "PATCH",
  body: {
    order_date: "2026-11-18", buyer: "测试买家", channel: "网站", payment_status: "已付款",
    shipping_status: "已寄出", cancelled: false, notes: "",
    items: [{ product_id: id, qty: 100, unit_price_cents: 2000 }],
  },
});
assert(tooMany.status === 409 && await stock() === 6, "oversell rejected, got " + tooMany.status + " stock " + await stock());

const cancelled = await api("/api/admin/orders/" + oid, {
  method: "PATCH",
  body: {
    order_date: "2026-11-18", buyer: "测试买家", channel: "IG", payment_status: "已付款",
    shipping_status: "未寄出", cancelled: true, notes: "",
    items: [{ product_id: id, qty: 3, unit_price_cents: 2000 }],
  },
});
assert(cancelled.status === 200 && await stock() === 9, "cancel returns stock, got " + await stock());

await api("/api/admin/orders/" + oid, { method: "DELETE" });
assert(await stock() === 9, "deleting a cancelled order does not change stock");

const removed = await api("/api/admin/restocks/" + rid, { method: "DELETE" });
assert(removed.status === 200 && await stock() === 5, "deleting an arrived restock removes its units, got " + await stock());

const flagged = await api("/api/admin/products/" + id + "/restock-flag", { method: "POST", body: { on: true } });
assert(flagged.status === 200 && flagged.data.product.needs_restock === 1, "要进货");
const sheet = await api("/api/admin/restocks");
assert(sheet.data.restocks.some((r) => r.product_id === id && r.status === "待下单"), "tick shows on 进货单");
const unflagged = await api("/api/admin/products/" + id + "/restock-flag", { method: "POST", body: { on: false } });
assert(unflagged.status === 200 && unflagged.data.product.needs_restock === 0, "取消要进货");

const csv = await api("/api/admin/export/products.csv");
assert(csv.status === 200 && csv.data.includes("名称") && csv.data.includes("测试商品"), "products csv");
const ocsv = await api("/api/admin/export/orders.csv");
assert(ocsv.status === 200 && ocsv.data.includes("创建人") && ocsv.data.includes("示例顾客"), "orders csv");

await api("/api/admin/products/" + id, { method: "DELETE" });
const gone = await api("/api/products");
assert(!gone.data.products.some((p) => p.id === id), "deleted test product is not public");

const adminPage = await fetch(base + "/admin");
assert(adminPage.status === 200 && (await adminPage.text()).includes("Holofen 店务"), "admin page");
console.log("api checks passed");
