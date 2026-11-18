import { onRequest as adminApi } from "../functions/api/admin/[[path]].js";
import { onRequest as products } from "../functions/api/products.js";
import { onRequest as adminPages } from "../functions/admin/[[path]].js";

function parts(pathname, prefix) {
  const rest = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "");
  return rest ? rest.split("/") : [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const context = {
      request,
      env,
      params: {},
      next: () => env.ASSETS.fetch(request),
    };
    if (path === "/api/products" || path === "/api/products/") return products(context);
    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      context.params.path = parts(path, "/api/admin");
      return adminApi(context);
    }
    if (path === "/admin" || path.startsWith("/admin/")) return adminPages(context);
    return env.ASSETS.fetch(request);
  },
};
