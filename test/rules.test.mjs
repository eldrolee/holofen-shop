import test from "node:test";
import assert from "node:assert/strict";
import { orderTarget, restockTarget, stockDeltas } from "../functions/_lib/inventory.js";
import { accessConfigured, authorize, can, parseEmails, roleForEmail } from "../functions/_lib/auth.js";
import { centsToRm } from "../functions/_lib/http.js";

test("restock only adds stock once it has arrived", () => {
  assert.equal(restockTarget("待下单", 4), 0);
  assert.equal(restockTarget("已下单", 4), 0);
  assert.equal(restockTarget("已到货", 4), 4);
});

test("marking the same arrival again does not add a second time", () => {
  const applied = new Map([["box", 4]]);
  const target = new Map([["box", restockTarget("已到货", 4)]]);
  assert.deepEqual(stockDeltas(applied, target, "restock"), []);
});

test("raising an arrived quantity only adds the difference", () => {
  const applied = new Map([["box", 2]]);
  const target = new Map([["box", restockTarget("已到货", 5)]]);
  assert.deepEqual(stockDeltas(applied, target, "restock"), [{ product_id: "box", delta: 3 }]);
});

test("leaving 已到货 gives the added units back", () => {
  const applied = new Map([["box", 2]]);
  const target = new Map([["box", restockTarget("已下单", 2)]]);
  assert.deepEqual(stockDeltas(applied, target, "restock"), [{ product_id: "box", delta: -2 }]);
});

test("recording an order holds stock, and paying does not hold more", () => {
  assert.equal(orderTarget(0, 2), 2);
  assert.equal(orderTarget(1, 2), 0);
  const applied = new Map([["box", 2]]);
  const still = new Map([["box", orderTarget(0, 2)]]);
  assert.deepEqual(stockDeltas(applied, still, "order"), []);
});

test("cancelling an order returns the held units", () => {
  const applied = new Map([["box", 2]]);
  const target = new Map([["box", orderTarget(1, 2)]]);
  assert.deepEqual(stockDeltas(applied, target, "order"), [{ product_id: "box", delta: 2 }]);
});

test("admin allow-list accepts several emails and ignores anyone else", () => {
  const env = { ADMIN_EMAILS: "eldrolee@gmail.com, lieuhongjun0533@gmail.com" };
  assert.deepEqual(parseEmails(env.ADMIN_EMAILS), ["eldrolee@gmail.com", "lieuhongjun0533@gmail.com"]);
  assert.equal(roleForEmail(env, "Lieuhongjun0533@gmail.com"), "admin");
  assert.equal(roleForEmail(env, "someone@else.com"), null);
  assert.equal(can("admin", "orders:write"), true);
  assert.equal(can("admin", "products:write"), true);
  assert.equal(can("orders", "products:write"), false);
});

function fakeRequest(host, extra = {}) {
  const headers = new Map(Object.entries({ host, ...extra }).map(([key, value]) => [key.toLowerCase(), value]));
  return { headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null } };
}

test("admin stays closed until Access is configured", async () => {
  const env = { ADMIN_EMAILS: "eldrolee@gmail.com,lieuhongjun0533@gmail.com" };
  assert.equal(accessConfigured(env), false);
  assert.equal(accessConfigured({ ...env, ACCESS_AUD: "aud-tag" }), false);
  assert.equal(accessConfigured({ ...env, ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com" }), false);
  for (const request of [
    fakeRequest("holofen-shop.workers.dev"),
    fakeRequest("localhost"),
    fakeRequest("127.0.0.1:8788"),
    fakeRequest("holofen-shop.workers.dev", { "Cf-Access-Jwt-Assertion": "aaa.bbb.ccc" }),
  ]) {
    const result = await authorize(request, env);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  }
  const local = await authorize(fakeRequest("127.0.0.1:8788"), { ...env, ALLOW_DEV_ADMIN: "1" });
  assert.equal(local.ok, true);
  assert.equal(local.local, true);
});

test("money stays in cents", () => {
  assert.equal(centsToRm(82000), "820.00");
  assert.equal(centsToRm(5), "0.05");
  assert.equal(centsToRm(-150), "-1.50");
});
