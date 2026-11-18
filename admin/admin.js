"use strict";
const $ = (s) => document.querySelector(s);
const app = $("#app");
const TYPES = [["pack", "单包"], ["booster_box", "补充包盒"], ["etb", "ETB"], ["other", "其他"]];
const TYPE_NAME = Object.fromEntries(TYPES);
const LANGS = [["EN", "英文"], ["JP", "日文"]];
const VIEWS = new Set(["dash", "products", "restock", "orders"]);
const state = { view: VIEWS.has(location.hash.slice(1)) ? location.hash.slice(1) : "dash", me: null, products: [], restocks: [], orders: [], dash: null, q: "" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rm = (cents) => {
  const n = Math.trunc(Number(cents) || 0);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return "RM" + sign + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
};
function rmToCents(raw) {
  const t = String(raw ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
const who = (email) => !email || email === "local-dev@localhost" ? "本地预览" : email === "示例" ? "示例" : email;
function toast(t) {
  const el = $("#toast");
  el.hidden = false;
  el.textContent = t;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2800);
}
async function api(path, opt = {}) {
  const res = await fetch(path, {
    method: opt.method || "GET",
    headers: opt.body ? { "content-type": "application/json" } : undefined,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  if (type.includes("text/csv") || opt.raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "没有成功");
  return data;
}
function productById(id) { return state.products.find((p) => p.id === id); }

function setView(name) {
  state.view = name;
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  load();
}

async function load() {
  try {
    if (!state.me) state.me = await api("/api/admin/me");
    const whoEl = $("#who");
    whoEl.textContent = state.me.local
      ? "本地预览 · 权限：管理员"
      : `${state.me.email} · 权限：管理员`;
    if (state.view === "dash") state.dash = await api("/api/admin/dashboard");
    if (state.view === "products" || state.view === "orders" || state.view === "restock") {
      state.products = (await api("/api/admin/products")).products;
    }
    if (state.view === "restock") state.restocks = (await api("/api/admin/restocks")).restocks;
    if (state.view === "orders") state.orders = (await api("/api/admin/orders")).orders;
    draw();
  } catch (err) {
    app.innerHTML = `<div class="card"><h1>进不去</h1><p>${esc(err.message)}</p></div>`;
  }
}

function draw() {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  if (state.view === "dash") drawDash();
  if (state.view === "products") drawProducts();
  if (state.view === "restock") drawRestock();
  if (state.view === "orders") drawOrders();
}

function drawDash() {
  const d = state.dash;
  if (!d) { app.innerHTML = "<p>读取中…</p>"; return; }
  const low = d.low_stock.map((p) => `<div class="card"><b>${esc(p.name)}</b><div class="muted">${esc(p.series)} · ${p.language === "JP" ? "日文" : "英文"}</div><div class="${p.stock_qty === 0 ? "down" : ""}">库存 ${p.stock_qty}${p.stock_qty === 0 ? " · 售罄" : ""}</div></div>`).join("") || `<p class="muted">没有低库存。</p>`;
  const ship = d.pending_shipments.map((o) => `<div class="card"><b>${esc(o.buyer)}</b><div class="muted">${esc(o.order_date)} · ${esc(o.channel)} · ${esc(o.payment_status)}</div></div>`).join("") || `<p class="muted">没有待寄出的订单。</p>`;
  const pay = d.unpaid_orders.map((o) => `<div class="card"><b>${esc(o.buyer)}</b><div class="muted">${esc(o.order_date)} · ${esc(o.channel)} · ${esc(o.shipping_status)}</div></div>`).join("") || `<p class="muted">没有未付款的订单。</p>`;
  app.innerHTML = `
    <div class="banner">带「示例」的商品、进货和订单是样例，不是真实库存。确认看过之后可以删掉。</div>
    <div class="tools"><button class="danger" id="wipe" type="button">删除全部示例</button></div>
    <div class="grid">
      <div class="stat"><span>库存成本</span><b>${rm(d.inventory_value_cents)}</b></div>
      <div class="stat"><span>低库存（${d.low_stock_at} 件或以下）</span><b>${d.low_stock.length}</b></div>
      <div class="stat"><span>未寄出</span><b>${d.pending_shipment_count}</b></div>
      <div class="stat"><span>未付款</span><b>${d.unpaid_count}</b></div>
      <div class="stat"><span>进行中的进货</span><b>${d.open_restock_count}</b></div>
    </div>
    <h2>低库存</h2><div class="list">${low}</div>
    <h2>待寄出</h2><div class="list">${ship}</div>
    <h2>未付款</h2><div class="list">${pay}</div>`;
}

function drawProducts() {
  const q = state.q.trim().toLowerCase();
  const list = state.products.filter((p) => !q || (p.name + p.series).toLowerCase().includes(q));
  app.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h1>商品</h1>
      <div class="tools">
        <button class="ghost" id="csv-p" type="button">导出 CSV</button>
        <button class="pri" id="add-p" type="button">新增商品</button>
      </div>
    </div>
    <label class="f"><input id="q" placeholder="搜索名称或系列" value="${esc(state.q)}"></label>
    <div class="list" style="margin-top:12px">${list.map(productCard).join("") || `<p class="muted">没有商品。</p>`}</div>`;
}
function productCard(p) {
  const profit = p.sell_price_cents - p.cost_cents;
  return `<article class="card">
    <div class="row" style="justify-content:space-between">
      <b>${esc(p.name)}</b>
      <span>${p.example ? `<span class="tag ex">示例</span>` : ""}${p.active ? "" : `<span class="tag">已下架</span>`}</span>
    </div>
    <div class="muted">${esc(p.series) || "未填系列"} · ${p.language === "JP" ? "日文" : "英文"} · ${TYPE_NAME[p.type] || ""}</div>
    <div class="row" style="margin-top:8px">
      <span>库存 <b class="${p.stock_qty === 0 ? "down" : ""}">${p.stock_qty}</b>${p.stock_qty === 0 ? " 售罄" : ""}</span>
      <span>售价 <b class="money">${rm(p.sell_price_cents)}</b></span>
      <span>成本 <b class="money">${rm(p.cost_cents)}</b></span>
      <span>单件利润 <b class="money ${profit < 0 ? "down" : ""}">${rm(profit)}</b></span>
    </div>
    <div class="row" style="margin-top:8px">
      <label class="check"><input type="checkbox" data-flag="${esc(p.id)}" ${p.needs_restock ? "checked" : ""}>要进货</label>
      <button class="ghost" type="button" data-edit="${esc(p.id)}">编辑</button>
    </div>
  </article>`;
}

function drawRestock() {
  const open = state.restocks.filter((r) => r.status !== "已到货");
  const done = state.restocks.filter((r) => r.status === "已到货");
  app.innerHTML = `
    <h1>进货单</h1>
    <p class="muted">在商品页勾「要进货」，商品会出现在这里。状态改成「已到货」才会加库存；再保存一次不会重复加。改回「待下单」或「已下单」会把这次加过的数量扣回。</p>
    <h2>进行中</h2>
    <div class="list">${open.map(restockCard).join("") || `<p class="muted">没有待处理的进货。到商品页勾选要进货。</p>`}</div>
    <h2>已到货</h2>
    <div class="list">${done.map(restockCard).join("") || `<p class="muted">还没有到货记录。</p>`}</div>`;
}
function restockCard(r) {
  return `<form class="card" data-restock="${esc(r.id)}">
    <div class="row" style="justify-content:space-between"><b>${esc(r.product_name)}</b>${r.example ? `<span class="tag ex">示例</span>` : ""}</div>
    <div class="muted">创建 ${esc(who(r.created_by))} · 最后修改 ${esc(who(r.updated_by))}</div>
    <div class="form" style="margin-top:8px">
      <label class="f">数量<input name="qty" inputmode="numeric" value="${r.qty}" required></label>
      <label class="f">单价成本 RM<input name="cost" inputmode="decimal" value="${(r.unit_cost_cents / 100).toFixed(2)}" required></label>
      <label class="f">供应商<input name="supplier" value="${esc(r.supplier)}" maxlength="120"></label>
      <label class="f">下单日<input name="order_date" type="date" value="${esc(r.order_date || "")}"></label>
      <label class="f">到货日<input name="arrival_date" type="date" value="${esc(r.arrival_date || "")}"></label>
      <label class="f">状态<select name="status">
        ${["待下单", "已下单", "已到货"].map((s) => `<option ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select></label>
    </div>
    <p>合计 <b class="money">${rm(r.total_cents)}</b></p>
    <label class="f">备注<textarea name="notes" maxlength="2000">${esc(r.notes || "")}</textarea></label>
    <div class="tools">
      <button class="pri" type="submit">保存</button>
      ${r.status === "已下单" ? "" : `<button class="danger" type="button" data-del-rs="${esc(r.id)}">删除</button>`}
    </div>
  </form>`;
}

function drawOrders() {
  app.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h1>订单</h1>
      <div class="tools">
        <button class="ghost" id="csv-o" type="button">导出 CSV</button>
        <button class="pri" id="add-o" type="button">记一笔订单</button>
      </div>
    </div>
    <p class="muted">保存订单就会扣库存。之后只把付款改成「已付款」不会再扣。取消订单会把库存加回。改数量只调整差额。</p>
    <div class="list">${state.orders.map(orderCard).join("") || `<p class="muted">还没有订单。</p>`}</div>`;
}
function orderCard(o) {
  const lines = (o.items || []).map((line) => `${esc(line.product_name)} × ${line.qty} · ${rm(line.unit_price_cents)}`).join("<br>");
  return `<article class="card">
    <div class="row" style="justify-content:space-between">
      <b>${esc(o.buyer)}</b>
      <span>${o.example ? `<span class="tag ex">示例</span>` : ""}${o.cancelled ? `<span class="tag bad">已取消</span>` : `<span class="tag">${esc(o.payment_status)}</span> <span class="tag">${esc(o.shipping_status)}</span>`}</span>
    </div>
    <div class="muted">${esc(o.order_date)} · ${esc(o.channel)} · 合计 ${rm(o.total_cents)}</div>
    <div style="margin:8px 0">${lines}</div>
    ${o.notes ? `<div class="muted">${esc(o.notes)}</div>` : ""}
    <div class="muted">创建 ${esc(who(o.created_by))} · 最后修改 ${esc(who(o.updated_by))}</div>
    <div class="tools">
      <button class="ghost" type="button" data-edit-o="${esc(o.id)}">编辑</button>
      <button class="danger" type="button" data-del-o="${esc(o.id)}">删除并退回库存</button>
    </div>
  </article>`;
}

function openDialog(html) {
  const dlg = $("#dlg");
  dlg.innerHTML = `<form class="sheet" method="dialog">${html}<div class="tools"><button class="ghost" type="button" id="close">关闭</button><button class="pri" value="save">保存</button></div></form>`;
  dlg.showModal();
  $("#close").onclick = () => dlg.close();
  return dlg.querySelector("form");
}
function productFields(p = {}) {
  return `<h2>${p.id ? "编辑商品" : "新增商品"}</h2>
    <div class="form">
      <label class="f">名称<input name="name" required maxlength="120" value="${esc(p.name || "")}"></label>
      <label class="f">系列<input name="series" maxlength="80" value="${esc(p.series || "")}"></label>
      <label class="f">语言<select name="language">${LANGS.map(([k, v]) => `<option value="${k}" ${(p.language || "EN") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">类型<select name="type">${TYPES.map(([k, v]) => `<option value="${k}" ${(p.type || "pack") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">售价 RM<input name="sell" inputmode="decimal" required value="${p.sell_price_cents != null ? (p.sell_price_cents / 100).toFixed(2) : ""}"></label>
      <label class="f">成本 RM<input name="cost" inputmode="decimal" required value="${p.cost_cents != null ? (p.cost_cents / 100).toFixed(2) : "0.00"}"></label>
      <label class="f">库存<input name="stock" inputmode="numeric" required value="${p.stock_qty ?? 0}"></label>
      <label class="f">图片路径<input name="image" placeholder="img/xxxx.jpg" value="${esc(p.image || "")}"></label>
      <label class="f">前台编号<input name="legacy_id" placeholder="对应商店里的商品，可留空" value="${esc(p.legacy_id || "")}"></label>
    </div>
    <label class="check"><input name="active" type="checkbox" ${p.active !== 0 ? "checked" : ""}>上架（顾客看得到）</label>
    <label class="check"><input name="needs_restock" type="checkbox" ${p.needs_restock ? "checked" : ""}>要进货</label>
    <label class="f">备注<textarea name="notes" maxlength="2000">${esc(p.notes || "")}</textarea></label>`;
}
function readProductForm(form, id) {
  const sell = rmToCents(form.sell.value);
  const cost = rmToCents(form.cost.value);
  const stock = Number(form.stock.value);
  if (sell == null || cost == null || !Number.isInteger(stock) || stock < 0) return { error: "价钱和库存请填数字。" };
  return {
    value: {
      id,
      name: form.name.value.trim(),
      series: form.series.value.trim(),
      language: form.language.value,
      type: form.type.value,
      sell_price_cents: sell,
      cost_cents: cost,
      stock_qty: stock,
      image: form.image.value.trim(),
      legacy_id: form.legacy_id.value.trim(),
      active: form.active.checked,
      needs_restock: form.needs_restock.checked,
      notes: form.notes.value.trim(),
    },
  };
}

function orderFields(o) {
  const items = (o && o.items && o.items.length) ? o.items : [{ product_id: "", qty: 1, unit_price_cents: 0 }];
  const options = state.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  return `<h2>${o ? "编辑订单" : "记一笔订单"}</h2>
    <div class="form">
      <label class="f">日期<input name="order_date" type="date" required value="${esc((o && o.order_date) || new Date().toISOString().slice(0, 10))}"></label>
      <label class="f">买家<input name="buyer" required maxlength="120" value="${esc((o && o.buyer) || "")}"></label>
      <label class="f">渠道<select name="channel">${["IG", "网站", "WhatsApp"].map((c) => `<option ${o && o.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="f">付款<select name="payment_status">${["未付款", "已付款"].map((c) => `<option ${o && o.payment_status === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label class="f">寄送<select name="shipping_status">${["未寄出", "已寄出", "已送达"].map((c) => `<option ${o && o.shipping_status === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div>
    <label class="check"><input name="cancelled" type="checkbox" ${o && o.cancelled ? "checked" : ""}>取消订单（库存加回）</label>
    <div id="lines">${items.map((line) => lineFields(line, options)).join("")}</div>
    <button class="ghost" type="button" id="add-line">加一行</button>
    <label class="f">备注<textarea name="notes" maxlength="2000">${esc((o && o.notes) || "")}</textarea></label>`;
}
function lineFields(line, options) {
  const price = line.unit_price_cents ? (line.unit_price_cents / 100).toFixed(2) : "";
  return `<div class="form line">
    <label class="f">商品<select name="product_id"><option value="">请选择</option>${options}</select></label>
    <label class="f">数量<input name="qty" inputmode="numeric" value="${line.qty || 1}"></label>
    <label class="f">成交价 RM<input name="unit_price" inputmode="decimal" value="${price}"></label>
  </div>`;
}
function hookLines(form) {
  form.querySelectorAll("select[name=product_id]").forEach((sel) => {
    const saved = sel.closest(".line").dataset.pid;
    if (saved) sel.value = saved;
    sel.onchange = () => {
      const p = productById(sel.value);
      const price = sel.closest(".line").querySelector("[name=unit_price]");
      if (p && price && !price.value) price.value = (p.sell_price_cents / 100).toFixed(2);
    };
  });
}

function readOrderForm(form) {
  const items = [...form.querySelectorAll(".line")].map((line) => {
    const price = rmToCents(line.querySelector("[name=unit_price]").value);
    return {
      product_id: line.querySelector("[name=product_id]").value,
      qty: Number(line.querySelector("[name=qty]").value),
      unit_price_cents: price,
    };
  }).filter((line) => line.product_id);
  if (!items.length || items.some((line) => line.unit_price_cents == null || !Number.isInteger(line.qty) || line.qty < 1)) {
    return { error: "每一行都要有商品、数量和价钱。" };
  }
  return {
    value: {
      order_date: form.order_date.value,
      buyer: form.buyer.value.trim(),
      channel: form.channel.value,
      payment_status: form.payment_status.value,
      shipping_status: form.shipping_status.value,
      cancelled: form.cancelled.checked,
      notes: form.notes.value.trim(),
      items,
    },
  };
}

async function download(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "导出失败");
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
app.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.id === "wipe") {
      if (!confirm("删除全部带「示例」的商品、进货和订单？你后来自己加的资料会留下。")) return;
      await api("/api/admin/examples/delete", { method: "POST", body: {} });
      toast("示例已删除");
      await load();
    }
    if (t.id === "csv-p") { await download("/api/admin/export/products.csv", "holofen-products.csv"); toast("已导出商品"); }
    if (t.id === "csv-o") { await download("/api/admin/export/orders.csv", "holofen-orders.csv"); toast("已导出订单"); }
    if (t.id === "add-p") {
      const form = openDialog(productFields());
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const read = readProductForm(form);
        if (read.error) return toast(read.error);
        await api("/api/admin/products", { method: "POST", body: read.value });
        $("#dlg").close();
        toast("已新增");
        await load();
      };
    }
    const edit = t.closest("[data-edit]");
    if (edit) {
      const p = productById(edit.dataset.edit);
      const form = openDialog(productFields(p));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const read = readProductForm(form, p.id);
        if (read.error) return toast(read.error);
        await api("/api/admin/products/" + p.id, { method: "PATCH", body: read.value });
        $("#dlg").close();
        toast("已保存");
        await load();
      };
    }
    if (t.id === "add-o") openOrder();
    const editO = t.closest("[data-edit-o]");
    if (editO) openOrder(state.orders.find((o) => o.id === editO.dataset.editO));
    const delO = t.closest("[data-del-o]");
    if (delO) {
      if (!confirm("删除这张订单，并把扣掉的库存加回去？")) return;
      await api("/api/admin/orders/" + delO.dataset.delO, { method: "DELETE" });
      toast("已删除，库存已退回");
      await load();
    }
    const delR = t.closest("[data-del-rs]");
    if (delR) {
      if (!confirm("删除这张进货？如果已经到货，加过的库存会扣回。")) return;
      await api("/api/admin/restocks/" + delR.dataset.delRs, { method: "DELETE" });
      toast("已删除");
      await load();
    }
  } catch (err) { toast(err.message); }
});
app.addEventListener("change", async (e) => {
  const flag = e.target.dataset && e.target.dataset.flag;
  if (!flag) return;
  try {
    await api("/api/admin/products/" + flag + "/restock-flag", { method: "POST", body: { on: e.target.checked } });
    toast(e.target.checked ? "已放进进货单" : "已从待下单里拿掉");
    state.products = (await api("/api/admin/products")).products;
    draw();
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast(err.message);
  }
});
app.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-restock]");
  if (!form) return;
  e.preventDefault();
  const current = state.restocks.find((r) => r.id === form.dataset.restock);
  const cost = rmToCents(form.cost.value);
  const qty = Number(form.qty.value);
  if (cost == null || !Number.isInteger(qty) || qty < 1) return toast("数量和成本请填数字。");
  try {
    await api("/api/admin/restocks/" + current.id, {
      method: "PATCH",
      body: {
        product_id: current.product_id,
        qty,
        unit_cost_cents: cost,
        supplier: form.supplier.value.trim(),
        order_date: form.order_date.value || null,
        arrival_date: form.arrival_date.value || null,
        status: form.status.value,
        notes: form.notes.value.trim(),
      },
    });
    toast(form.status.value === "已到货" ? "已到货，库存已加上" : "进货已保存");
    await load();
  } catch (err) { toast(err.message); }
});
app.addEventListener("input", (e) => {
  if (e.target.id === "q") { state.q = e.target.value; const keep = e.target.selectionStart; drawProducts(); const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(keep, keep); } }
});

function openOrder(existing) {
  const form = openDialog(orderFields(existing));
  form.querySelectorAll(".line").forEach((line, i) => {
    const item = existing && existing.items && existing.items[i];
    if (item) line.dataset.pid = item.product_id;
  });
  hookLines(form);
  form.querySelectorAll("select[name=product_id]").forEach((sel) => { if (sel.closest(".line").dataset.pid) sel.value = sel.closest(".line").dataset.pid; });
  $("#add-line").onclick = () => {
    const options = state.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    $("#lines").insertAdjacentHTML("beforeend", lineFields({}, options));
    hookLines(form);
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const read = readOrderForm(form);
    if (read.error) return toast(read.error);
    try {
      if (existing) await api("/api/admin/orders/" + existing.id, { method: "PATCH", body: read.value });
      else await api("/api/admin/orders", { method: "POST", body: read.value });
      $("#dlg").close();
      toast("订单已保存");
      await load();
    } catch (err) { toast(err.message); }
  };
}

load();
