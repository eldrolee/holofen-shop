/**
 * 管理员名单来自环境变量 ADMIN_EMAILS（逗号或空格分隔），不写进网页。
 * 名单里的每个人现在都是 admin（商品、进货、订单都能改）。
 *
 * 以后如果要「只能看、或只能改订单」：在 ROLES 里加一个角色，
 * 去掉 products:write / restocks:write，再在 roleForEmail 里用另一个环境变量返回那个角色。
 * 路由已经按 can(role, action) 判断，数据库不用改。created_by 记的是邮箱。
 */
export const ROLES = {
  admin: {
    label: "管理员",
    can: new Set(["read", "products:write", "restocks:write", "orders:write", "export"]),
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmails(raw) {
  return [...new Set(String(raw || "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL.test(s)))];
}

export function roleForEmail(env, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  if (parseEmails(env.ADMIN_EMAILS).includes(e)) return "admin";
  return null;
}

export function can(role, action) {
  const spec = ROLES[role];
  return !!(spec && spec.can.has(action));
}

function loopback(request) {
  const host = String(request.headers.get("host") || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function teamIssuer(raw) {
  const t = String(raw || "").trim().replace(/\/$/, "");
  if (!t) return "";
  const withScheme = t.startsWith("https://") ? t : `https://${t.replace(/^https?:\/\//, "")}`;
  let url;
  try { url = new URL(withScheme); } catch { return ""; }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) return "";
  return url.origin;
}

function b64url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let jwksCache = { issuer: "", at: 0, keys: [] };

async function jwks(issuer, force) {
  const now = Date.now();
  if (!force && jwksCache.issuer === issuer && now - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) return jwksCache.issuer === issuer ? jwksCache.keys : [];
  const data = await res.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache = { issuer, at: now, keys };
  return keys;
}

async function verifyAccessJwt(token, env) {
  const issuer = teamIssuer(env.ACCESS_TEAM_DOMAIN);
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!issuer || !aud || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return null;
  }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  let keys = await jwks(issuer, false);
  let jwk = keys.find((k) => k && k.kid === header.kid);
  if (!jwk) {
    keys = await jwks(issuer, true);
    jwk = keys.find((k) => k && k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof payload.exp !== "number" || payload.exp + skew < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf - skew > now) return null;
  if (payload.iss !== issuer) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  const email = String(payload.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return null;
  return email;
}

/**
 * 没配好 Cloudflare Access（缺 ACCESS_TEAM_DOMAIN 或 ACCESS_AUD）时，/admin 和 /api/admin 一律拒绝。
 * 唯一例外是本机：ALLOW_DEV_ADMIN=1 且 Host 是 localhost。正式环境和 Git 预览都没有这个开关。
 */
export function accessConfigured(env) {
  return !!(teamIssuer(env && env.ACCESS_TEAM_DOMAIN) && String((env && env.ACCESS_AUD) || "").trim());
}

export async function authorize(request, env) {
  if (!accessConfigured(env)) {
    if (env.ALLOW_DEV_ADMIN === "1" && loopback(request)) {
      return { ok: true, email: "local-dev@localhost", role: "admin", local: true };
    }
    return { ok: false, status: 401, error: "请先用 Cloudflare Access 登录。" };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, error: "请先用 Cloudflare Access 登录。" };
  let email;
  try {
    email = await verifyAccessJwt(token, env);
  } catch {
    return { ok: false, status: 401, error: "登录无效，请重新登录。" };
  }
  if (!email) return { ok: false, status: 401, error: "登录无效，请重新登录。" };
  const role = roleForEmail(env, email);
  if (!role) return { ok: false, status: 403, error: "这个邮箱不在管理员名单里。" };
  return { ok: true, email, role, local: false };
}
