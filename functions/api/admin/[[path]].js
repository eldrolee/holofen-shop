import { authorize, can } from "../../_lib/auth.js";
import { constraintMessage, csvResponse, json } from "../../_lib/http.js";
import {
  createOrder, createProduct, createRestock, dashboard, deleteExamples, deleteOrder, deleteProduct,
  deleteRestock, listOrders, listProducts, listRestocks, ordersCsv, productsCsv, setNeedsRestock,
  updateOrder, updateProduct, updateRestock,
} from "../../_lib/queries.js";
import { readOrder, readProduct, readRestock } from "../../_lib/validate.js";

function partsOf(context) {
  const raw = context.params.path;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

async function bodyOf(request) {
  const text = await request.text();
  if (text.length > 100000) return { error: "内容太长。", status: 413 };
  if (!text) return { value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "资料格式不对。", status: 400 };
    return { value };
  } catch {
    return { error: "资料格式不对。", status: 400 };
  }
}

function denied(auth) {
  return json({ error: auth.error }, auth.status);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const auth = await authorize(request, env);
  if (!auth.ok) return denied(auth);
  const parts = partsOf(context);
  const [a, b] = parts;
  try {
    if (request.method === "GET" && a === "me" && !b) {
      return json({ email: auth.email, role: auth.role, local: auth.local });
    }
    if (!can(auth.role, "read")) return json({ error: "没有权限。" }, 403);

    if (request.method === "GET" && a === "dashboard" && !b) return json(await dashboard(env.DB));
    if (request.method === "GET" && a === "products" && !b) return json({ products: await listProducts(env.DB) });
    if (request.method === "GET" && a === "restocks" && !b) return json({ restocks: await listRestocks(env.DB) });
    if (request.method === "GET" && a === "orders" && !b) return json({ orders: await listOrders(env.DB) });
    if (request.method === "GET" && a === "export" && b === "products.csv") {
      if (!can(auth.role, "export")) return json({ error: "没有权限。" }, 403);
      return csvResponse("holofen-products.csv", await productsCsv(env.DB));
    }
    if (request.method === "GET" && a === "export" && b === "orders.csv") {
      if (!can(auth.role, "export")) return json({ error: "没有权限。" }, 403);
      return csvResponse("holofen-orders.csv", await ordersCsv(env.DB));
    }

    const parsed = request.method === "GET" || request.method === "DELETE" ? { value: {} } : await bodyOf(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status || 400);

    if (request.method === "POST" && a === "products" && !b) {
      if (!can(auth.role, "products:write")) return json({ error: "没有权限。" }, 403);
      const input = readProduct(parsed.value);
      if (input.error) return json({ error: input.error }, 400);
      return json({ product: await createProduct(env.DB, input.value, auth.email) }, 201);
    }
    if (request.method === "PATCH" && a === "products" && b) {
      if (!can(auth.role, "products:write")) return json({ error: "没有权限。" }, 403);
      const input = readProduct(parsed.value, { partial: true });
      if (input.error) return json({ error: input.error }, 400);
      const result = await updateProduct(env.DB, b, input.value, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }
    if (request.method === "POST" && a === "products" && parts[2] === "restock-flag") {
      if (!can(auth.role, "products:write")) return json({ error: "没有权限。" }, 403);
      if (typeof parsed.value.on !== "boolean") return json({ error: "请说明要不要进货。" }, 400);
      const result = await setNeedsRestock(env.DB, b, parsed.value.on, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }
    if (request.method === "DELETE" && a === "products" && b && !parts[2]) {
      if (!can(auth.role, "products:write")) return json({ error: "没有权限。" }, 403);
      const result = await deleteProduct(env.DB, b);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    if (request.method === "POST" && a === "restocks" && !b) {
      if (!can(auth.role, "restocks:write")) return json({ error: "没有权限。" }, 403);
      const input = readRestock(parsed.value);
      if (input.error) return json({ error: input.error }, 400);
      const result = await createRestock(env.DB, input.value, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result, 201);
    }
    if (request.method === "PATCH" && a === "restocks" && b) {
      if (!can(auth.role, "restocks:write")) return json({ error: "没有权限。" }, 403);
      const input = readRestock(parsed.value);
      if (input.error) return json({ error: input.error }, 400);
      const result = await updateRestock(env.DB, b, input.value, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }
    if (request.method === "DELETE" && a === "restocks" && b) {
      if (!can(auth.role, "restocks:write")) return json({ error: "没有权限。" }, 403);
      const result = await deleteRestock(env.DB, b);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    if (request.method === "POST" && a === "orders" && !b) {
      if (!can(auth.role, "orders:write")) return json({ error: "没有权限。" }, 403);
      const input = readOrder(parsed.value);
      if (input.error) return json({ error: input.error }, 400);
      const result = await createOrder(env.DB, input.value, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result, 201);
    }
    if (request.method === "PATCH" && a === "orders" && b) {
      if (!can(auth.role, "orders:write")) return json({ error: "没有权限。" }, 403);
      const input = readOrder(parsed.value);
      if (input.error) return json({ error: input.error }, 400);
      const result = await updateOrder(env.DB, b, input.value, auth.email);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }
    if (request.method === "DELETE" && a === "orders" && b) {
      if (!can(auth.role, "orders:write")) return json({ error: "没有权限。" }, 403);
      const result = await deleteOrder(env.DB, b);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    if (request.method === "POST" && a === "examples" && b === "delete") {
      if (!can(auth.role, "products:write")) return json({ error: "没有权限。" }, 403);
      const result = await deleteExamples(env.DB);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    return json({ error: "没有这个功能。" }, 404);
  } catch (err) {
    const known = constraintMessage(err);
    if (known) return json({ error: known }, 409);
    console.log(JSON.stringify({ level: "error", route: parts.join("/"), message: String(err && err.message || err).slice(0, 300) }));
    return json({ error: "没有保存成功，请再试一次。" }, 500);
  }
}
