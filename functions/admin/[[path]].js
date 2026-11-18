import { authorize } from "../_lib/auth.js";

function denied() {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Holofen 店务</title>
<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f6fb;color:#14254a;margin:0;padding:48px 20px}main{max-width:420px;margin:auto;background:#fff;border:1px solid #e3e7f0;border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 8px}p{line-height:1.6;color:#5d6785}</style>
<main><h1>店务后台</h1><p>这里只给店主和合伙人。请用 Cloudflare Access 登录允许的邮箱。</p></main>`, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequest(context) {
  const auth = await authorize(context.request, context.env);
  if (!auth.ok) return denied();
  const url = new URL(context.request.url);
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    url.pathname = "/admin/console";
    url.search = "";
    const asset = await context.env.ASSETS.fetch(new Request(url, context.request));
    return new Response(asset.body, { status: asset.status, headers: asset.headers });
  }
  return context.next();
}
