import { listPublic } from "../_lib/queries.js";
import { json } from "../_lib/http.js";

export async function onRequest(context) {
  if (context.request.method !== "GET") return json({ error: "只开放读取。" }, 405);
  try {
    const data = await listPublic(context.env.DB);
    return json(data, 200, { "cache-control": "public, max-age=15" });
  } catch (err) {
    console.log(JSON.stringify({ level: "error", route: "products", message: String(err && err.message || err).slice(0, 300) }));
    return json({ error: "商品暂时读不到。" }, 500);
  }
}
