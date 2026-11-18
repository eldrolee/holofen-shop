# Holofen

Holofen 宝可梦卡牌网店（试运行站）。商店页面仍是原来的静态网页。商品、进货和订单改由 Cloudflare D1 保存，店主在 `/admin` 管理。

- 本地打开商店：先按下面的步骤跑起来，再用浏览器打开 `http://127.0.0.1:8788`。
- 卡价参考仍来自原来的目录。后台里上架、并且填了「前台编号」的商品，会改掉商店上那一件的售价和库存；库存为 0 时显示「售罄」。
- 顾客下单后的确认信仍走原来的 Supabase `send-mail`，这次没有搬。店务后台只是记账，不发信。

## 店务后台要 Eldro 自己做的事

GitHub 仓库已经接到 Cloudflare Worker `holofen-shop`。main 分支会跑 `npx wrangler deploy`，其他分支会跑 `npx wrangler preview`。不要再新建一个 Pages 项目。还没有 D1 数据库，也没有改域名。

两个人都是完整管理员：Eldro（eldrolee@gmail.com）和合伙人（lieuhongjun0533@gmail.com）。邮箱写在 Cloudflare 的环境变量 `ADMIN_EMAILS` 里，不写进网页。

1. 安装 Node.js 后，在这个目录运行 `npm install`。
2. 登录 Cloudflare：`npx wrangler login`。
3. 数据库 `holofen` 已经建好，`database_id` 已写进 `wrangler.toml`。`preview_database_id` 仍是 `local-holofen`，那是你自己电脑上的库。
4. 同一个 id 也写进了 `[[previews.d1_databases]]`，Git 预览用的是这一份库。
5. 迁移 `0001` 和 `0002` 已经灌进线上库。里面有一批名字带「示例」的数据，不是真实库存。看完可以在后台总览按「删除全部示例」。
6. 打开 Worker `holofen-shop` → Settings → Variables and Secrets。`ADMIN_EMAILS` 已经设好（`eldrolee@gmail.com,lieuhongjun0533@gmail.com`）。Production 和 Preview 还要加上：
   - `ACCESS_TEAM_DOMAIN` = `https://你的团队名.cloudflareaccess.com`
   - `ACCESS_AUD` = 下一步 Access 应用里的 Application Audience (AUD) Tag
7. 开通免费的 Cloudflare Zero Trust（Access，50 人以内免费）。用一次性邮箱验证码即可，不必另买登录服务。新建一个 Self-hosted 应用，域名选这个 Worker 的网站，路径加上：
   - `/admin`
   - `/admin/*`
   - `/api/admin`
   - `/api/admin/*`
   策略选 Allow，Include → Emails，填上 `eldrolee@gmail.com` 和 `lieuhongjun0533@gmail.com`。两人都是完整权限。身份来源选 One-time PIN。
8. 把第 6 步的 `ACCESS_AUD` 和团队域名填好。在这两项填上之前，`/admin` 和 `/api/admin` 一律拒绝登录。填好后用这两个邮箱打开 `https://你的网站/admin`，收验证码登录。先不要合并。
9. 域名还指着 Vercel 的话，先不要改 DNS。确认 Worker 网站没问题后，再把域名接到 Cloudflare。`vercel.json` 可以留着，Cloudflare 不读它。迁完、并且 Vercel 项目不再使用之后，删掉 `vercel.json` 即可。图片缓存已经写在 `_headers`。

本地预览（不连线上库）：

```bash
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

打开 `http://127.0.0.1:8788/admin`。`.dev.vars` 里的 `ALLOW_DEV_ADMIN=1` 只在本机、而且还没填写 `ACCESS_AUD` 时有效。不要把 `ALLOW_DEV_ADMIN` 加到 Cloudflare 的线上环境变量。

库存规则：进货状态改成「已到货」才加库存，再保存一次不会重复加。订单一点保存就扣库存；之后标成「已付款」不会再扣。取消或删除订单会把库存加回。

以后如果只想给某人看订单、不让改商品：在 `functions/_lib/auth.js` 的 `ROLES` 里加一个角色，并让 `roleForEmail` 从另一个环境变量返回它。现在两个人都是 `admin`。
