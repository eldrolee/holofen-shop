// Holofen 发信：经 Brevo 寄电邮。API key 只放在 Supabase 的 secrets（BREVO_KEY、SENDER_EMAIL），网页里没有。
// kind "bulk" / "order"：只有店主和管理员能用（用数据库里的 is_staff() 判断）。
// kind "placed"：顾客下单后调用，只能寄到自己那张订单上填的邮箱，内容由这里生成；同时提醒店主有新订单。
// kind "cancel"：顾客取消还没付款的订单。由这里删掉订单（确认是本人、还没付款），再提醒店主。
// 店主提醒寄到 books/notify 里设的邮箱（后台「设置 › 订单通知」），每张订单每种提醒只寄一次。
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

const OWNER_DEFAULT = "holofenn@gmail.com";
// 店主提醒：读 books/notify（只有员工读得到），按开关寄出；sent 记已寄过的，避免重复按造成洗版
async function ownerAlert(admin: any, key: string | undefined, sender: string | undefined, kind: "new" | "cancel", o: any, lines: string, site: string) {
  if (!key || !sender) return;
  const { data } = await admin.from("docs").select("data").eq("col", "books").eq("id", "notify").maybeSingle();
  const n = data?.data ?? {};
  if (kind === "new" ? n.onNew === false : n.onCancel === false) return;
  const to = (Array.isArray(n.to) && n.to.length ? n.to : [OWNER_DEFAULT]).map((e: string) => String(e).trim().toLowerCase()).filter(okEmail).slice(0, 5);
  if (!to.length) return;
  const tag = kind + ":" + o.id, sent: string[] = Array.isArray(n.sent) ? n.sent : [];
  if (sent.includes(tag)) return;
  await admin.from("docs").upsert({ col: "books", id: "notify", data: { ...n, sent: [tag, ...sent].slice(0, 400) } }, { onConflict: "col,id" });
  const rm = (v: number) => "RM" + Number(v || 0).toFixed(2);
  const who = `${esc(o.name || "")}${o.phone ? " · " + esc(o.phone) : ""}${o.email ? " · " + esc(o.email) : ""}`;
  const head = kind === "new" ? `<h2>有新订单 ${esc(o.id)}</h2><p>顾客：${who}<br>合计：<b>${rm(o.total)}</b>${o.pay ? "<br>付款方式：" + esc(o.pay) : ""}${o.note ? "<br>备注：" + esc(String(o.note).slice(0, 300)) : ""}</p>`
    : `<h2>顾客取消了订单 ${esc(o.id)}</h2><p>顾客：${who}<br>原本合计：<b>${rm(o.total)}</b><br>这张订单还没付款，已从订单列表移除，不用处理库存。</p>`;
  await brevo(key, sender, to, kind === "new" ? `【新订单】${o.id} ${rm(o.total)}` : `【订单取消】${o.id}`, wrap(head + lines + `<p><a href="${esc(site)}#admin">打开后台订单页</a></p>`, site));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("BREVO_KEY"), sender = Deno.env.get("SENDER_EMAIL");
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return J({ error: "login" }, 401);
  let b: any; try { b = await req.json() } catch { return J({ error: "bad_json" }, 400) }
  const site = typeof b.site === "string" && /^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(b.site) ? b.site : "https://holofen-shop.eldrolee.workers.dev/";
  try {
    const rm = (v: number) => "RM" + Number(v).toFixed(2);
    if (b.kind === "placed" || b.kind === "cancel") {
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await admin.from("docs").select("data").eq("col", "orders").eq("id", u.user.id).maybeSingle();
      const all = Array.isArray(data?.data?.orders) ? data!.data.orders : [];
      const o = all.find((x: any) => x && x.id === b.orderId);
      if (!o) return J({ error: "no_order" }, 404);
      // 商品明细由网页传来，但数量必须和数据库里的订单一致，名字只当纯文字显示
      const its = Array.isArray(o.items) ? o.items : [], ln = Array.isArray(b.lines) ? b.lines.slice(0, 50) : [];
      const okLines = ln.length === its.length && ln.every((l: any, i: number) => l && Number(l.q) === Number(its[i].qty) && Number.isFinite(Number(l.p)));
      const rows = okLines ? ln.map((l: any) => [String(l.n).slice(0, 100), Number(l.q), Number(l.p) * Number(l.q)]) : its.map((c: any) => [String(c.id).slice(0, 60), Number(c.qty), null]);
      const table = `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rows.map((r: any) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(r[0])} × ${r[1]}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${r[2] == null ? "" : rm(r[2])}</td></tr>`).join("")}
        ${okLines ? [["小计 Subtotal", b.sub], ["运费 Shipping", b.fee], ["折扣 Discount", b.off ? -Number(b.off) : null]].filter((x) => x[1] != null && Number.isFinite(Number(x[1]))).map((x) => `<tr><td style="padding:4px 0;color:#55606f">${x[0]}</td><td style="text-align:right;color:#55606f">${rm(Number(x[1]))}</td></tr>`).join("") : ""}
        <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1d2340">合计 Total</td><td style="text-align:right;font-weight:bold;border-top:2px solid #1d2340">${rm(Number(o.total))}</td></tr></table>`;
      if (b.kind === "cancel") {
        // 只有还没付款、店主还没处理的订单能自己取消
        const { data: st } = await admin.from("docs").select("data").eq("col", "status").eq("id", u.user.id).maybeSingle();
        const a = st?.data?.o?.[o.id] ?? {};
        if (o.ref || a.status) return J({ error: "paid" }, 409);
        const { error } = await admin.from("docs").update({ data: { ...data!.data, orders: all.filter((x: any) => !(x && x.id === o.id)) } }).eq("col", "orders").eq("id", u.user.id);
        if (error) return J({ error: "save" }, 500);
        try { await ownerAlert(admin, key, sender, "cancel", o, table, site) } catch (e) { console.error("owner alert failed:", String((e as Error).message).slice(0, 200)) }
        return J({ ok: true });
      }
      if (Date.now() - Number(o.at) > 15 * 60e3) return J({ error: "no_order" }, 404);
      if (!key || !sender) return J({ error: "not_configured" }, 503);
      try { await ownerAlert(admin, key, sender, "new", o, table, site) } catch (e) { console.error("owner alert failed:", String((e as Error).message).slice(0, 200)) }
      if (okEmail(o.email)) await brevo(key, sender, [o.email], `Holofen 已收到你的订单 ${o.id}`, wrap(`<h2>谢谢你的订单！</h2><p>订单编号 <b>${esc(o.id)}</b>。店主确认收到付款后会开始打包，并寄电子收据给你，之后每一步都会再寄电邮告诉你。</p><p>We received your order <b>${esc(o.id)}</b>. We'll email your receipt once payment is confirmed.</p>${table}<p><a href="${esc(site)}#orders">查看订单进度 Track your order</a></p>`, site));
      return J({ ok: true });
    }
    if (!key || !sender) return J({ error: "not_configured" }, 503);
    const { data: staff } = await user.rpc("is_staff");
    if (staff !== true) return J({ error: "forbidden" }, 403);
    const to = [...new Set((Array.isArray(b.to) ? b.to : []).map((e: string) => String(e).trim().toLowerCase()).filter(okEmail))].slice(0, 2000) as string[];
    const subject = String(b.subject ?? "").slice(0, 150).trim(), text = String(b.text ?? "").slice(0, 5000).trim();
    if (!to.length || !subject || (!text && !b.html)) return J({ error: "missing" }, 400);
    // 店主和管理员可以直接送 HTML（例如电子收据）；其他情况只当纯文字
    const html = typeof b.html === "string" && b.html.length < 100000 ? b.html : wrap(esc(text).replace(/\n/g, "<br>"), site);
    await brevo(key, sender, to, subject, html);
    return J({ ok: true, sent: to.length });
  } catch (e) { const m = String((e as Error).message).slice(0, 300); console.error("send-mail failed:", m); return J({ error: m }, 502) }
});
