// 2026-11-25 店主要求：不让别人爬取网站。先挡掉 AI 爬虫、抓数据工具和无头浏览器，其余请求照常交给静态文件。
// 搜索引擎（Google、Bing 等）和社交分享预览（WhatsApp、Facebook、Telegram 等）照常放行，不然顾客搜不到、分享不出预览。
const BAD = /(GPTBot|ChatGPT-User|OAI-SearchBot|CCBot|ClaudeBot|Claude-Web|anthropic-ai|Google-Extended|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|Applebot-Extended|meta-externalagent|meta-externalfetcher|FacebookBot|cohere-ai|cohere-training|Diffbot|ImagesiftBot|omgili|Timpibot|YouBot|AI2Bot|Ai2Bot-Dolma|PanguBot|Kangaroo Bot|Scrapy|python-requests|python-urllib|aiohttp|httpx|Go-http-client|curl\/|Wget|libwww-perl|okhttp|node-fetch|axios|HeadlessChrome|PhantomJS|AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|PetalBot|BLEXBot|serpstatbot|SeekportBot|Barkrowler|magpie-crawler|webzio|img2dataset|Screaming Frog|HTTrack|SiteSucker|WebCopier|Offline Explorer|Teleport)/i;
// 2026-11-28 店主：自己和勾了「AI 爬取和截图」权限的员工，用后台给的专用链接（?hfai=…）打开后，AI 工具和无头浏览器也能爬取、截图。
// 通行码存在数据库 ai_pass，只能用 ai_pass_ok() 核对；员工被取消权限或被移除，通行码马上失效。核对结果缓存 5 分钟。
const SB_URL = "https://hojqzzkhjsqceoepgeub.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvanF6emtoanNxY2VvZXBnZXViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NDQyMzAsImV4cCI6MjExMDQyMDIzMH0.XCpIGiZ387C-UOcBUpteFOwrlOUt55PigoSPerOJrck"; // 公开的 anon key（网页本身也带着），只能调用公开的函数
async function passOK(t) {
  if (!/^[0-9a-f]{32,64}$/.test(t || "")) return false;
  const cache = caches.default, key = new Request("https://aipass.holofen/" + t);
  const hit = await cache.match(key);
  if (hit) return (await hit.text()) === "1";
  let ok = false;
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/ai_pass_ok", { method: "POST", headers: { apikey: SB_KEY, authorization: "Bearer " + SB_KEY, "content-type": "application/json" }, body: JSON.stringify({ t }) });
    ok = r.ok && (await r.json()) === true;
  } catch (_) { ok = false; }
  await cache.put(key, new Response(ok ? "1" : "0", { headers: { "cache-control": "max-age=300" } }));
  return ok;
}
function cookieTok(req) { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)hfai=([0-9a-f]{32,64})/); return m ? m[1] : ""; }
export default {
  async fetch(request, env) {
    const ua = request.headers.get("user-agent") || "";
    const url = new URL(request.url), qTok = url.searchParams.get("hfai") || "", tok = qTok || cookieTok(request);
    const pass = tok ? await passOK(tok) : false;
    if (pass && url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (!pass && (!ua || BAD.test(ua))) {
      return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, noai, noimageai" } });
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    if (!pass) h.set("X-Robots-Tag", "noai, noimageai");
    if (pass && qTok) h.append("Set-Cookie", "hfai=" + qTok + "; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax");
    if (tok && !pass && cookieTok(request)) h.append("Set-Cookie", "hfai=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax");
    // 2026-11-25 店主要求「不要给骇客有入侵的机会」：加上常见的安全标头。
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    h.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};
