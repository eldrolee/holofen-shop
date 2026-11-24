// 2026-11-25 店主要求：不让别人爬取网站。先挡掉 AI 爬虫、抓数据工具和无头浏览器，其余请求照常交给静态文件。
// 搜索引擎（Google、Bing 等）和社交分享预览（WhatsApp、Facebook、Telegram 等）照常放行，不然顾客搜不到、分享不出预览。
const BAD = /(GPTBot|ChatGPT-User|OAI-SearchBot|CCBot|ClaudeBot|Claude-Web|anthropic-ai|Google-Extended|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|Applebot-Extended|meta-externalagent|meta-externalfetcher|FacebookBot|cohere-ai|cohere-training|Diffbot|ImagesiftBot|omgili|Timpibot|YouBot|AI2Bot|Ai2Bot-Dolma|PanguBot|Kangaroo Bot|Scrapy|python-requests|python-urllib|aiohttp|httpx|Go-http-client|curl\/|Wget|libwww-perl|okhttp|node-fetch|axios|HeadlessChrome|PhantomJS|AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|PetalBot|BLEXBot|serpstatbot|SeekportBot|Barkrowler|magpie-crawler|webzio|img2dataset|Screaming Frog|HTTrack|SiteSucker|WebCopier|Offline Explorer|Teleport)/i;
export default {
  async fetch(request, env) {
    const ua = request.headers.get("user-agent") || "";
    if (!ua || BAD.test(ua)) {
      return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, noai, noimageai" } });
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set("X-Robots-Tag", "noai, noimageai");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};
