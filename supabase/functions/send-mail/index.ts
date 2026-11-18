// Holofen 发信：经 Brevo 寄电邮。API key 只放在 Supabase 的 secrets（BREVO_KEY、SENDER_EMAIL），网页里没有。
// kind "bulk" / "order"：只有店主和管理员能用（用数据库里的 is_staff() 判断）。
// kind "placed"：顾客下单后调用，只能寄到自己那张订单上填的邮箱，内容由这里生成。
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (t: string) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const okEmail = (e: string) => typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const wrap = (body: string, site: string) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1d2340;line-height:1.6">${body}<hr style="border:none;border-top:1px solid #e5e7ef;margin:24px 0"><p style="font-size:12px;color:#8a93ad">Holofen · <a href="${esc(site)}">${esc(site)}</a></p></div>`;

async function brevo(key: string, sender: string, to: string[], subject: string, html: string) {
  const versions = to.map((e) => ({ to: [{ email: e }] }));
  for (let i = 0; i < versions.length; i += 900) {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { email: sender, name: "Holofen" }, subject, htmlContent: html, messageVersions: versions.slice(i, i + 900) }) });
    if (!r.ok) throw new Error("brevo " + r.status + " " + (await r.text()).slice(0, 300));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("BREVO_KEY"), sender = Deno.env.get("SENDER_EMAIL");
  if (!key || !sender) return J({ error: "not_configured" }, 503);
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return J({ error: "login" }, 401);
  let b: any; try { b = await req.json() } catch { return J({ error: "bad_json" }, 400) }
  const site = typeof b.site === "string" && /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(b.site) ? b.site : "https://holofen-shop.vercel.app/";
  try {
    if (b.kind === "placed") {
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await admin.from("docs").select("data").eq("col", "orders").eq("id", u.user.id).maybeSingle();
      const o = (data?.data?.orders ?? []).find((x: any) => x && x.id === b.orderId);
      if (!o || !okEmail(o.email) || Date.now() - Number(o.at) > 15 * 60e3) return J({ error: "no_order" }, 404);
      await brevo(key, sender, [o.email], `Holofen 已收到你的订单 ${o.id}`, wrap(`<h2>谢谢你的订单！</h2><p>订单编号 <b>${esc(o.id)}</b>。店主确认收到付款后会开始打包，之后每一步都会再寄电邮告诉你。</p><p>We received your order <b>${esc(o.id)}</b>. We'll email you at each step.</p><p><a href="${esc(site)}#orders">查看订单进度 Track your order</a></p>`, site));
      return J({ ok: true });
    }
    const { data: staff } = await user.rpc("is_staff");
    if (staff !== true) return J({ error: "forbidden" }, 403);
    const to = [...new Set((Array.isArray(b.to) ? b.to : []).map((e: string) => String(e).trim().toLowerCase()).filter(okEmail))].slice(0, 2000) as string[];
    const subject = String(b.subject ?? "").slice(0, 150).trim(), text = String(b.text ?? "").slice(0, 5000).trim();
    if (!to.length || !subject || !text) return J({ error: "missing" }, 400);
    const html = wrap(esc(text).replace(/\n/g, "<br>"), site);
    await brevo(key, sender, to, subject, html);
    return J({ ok: true, sent: to.length });
  } catch (e) { return J({ error: String((e as Error).message).slice(0, 300) }, 502) }
});
