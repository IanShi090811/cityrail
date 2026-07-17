# CityRail Cloudflare Pages + 虎皮椒支付部署说明（v146.7）

本版本已把原来的普通 Node 后端支付接口改成 Cloudflare Pages Functions。你可以继续把前端部署在 Cloudflare Pages，同域名下会自动生成这些接口：

- `POST /api/pay/create`：创建虎皮椒订单
- `POST /api/pay/notify`：虎皮椒异步回调，验签成功后开通账号
- `GET /api/pay/status?trade_order_id=...`：前端轮询订单状态
- `GET /api/check-username/:username`：注册页用户名查重
- `POST /api/login`：登录已支付账号

## 1. 文件结构

Cloudflare Pages 会识别项目根目录的 `functions/` 文件夹：

```text
functions/
  _shared/
    cityrail-cloudflare.js
  api/
    check-username/
      [username].js
    pay/
      create.js
      notify.js
      status.js
    login.js
    register.js
```

部署后，对应接口就是：

```text
POST https://你的域名/api/pay/create
POST https://你的域名/api/pay/notify
GET  https://你的域名/api/pay/status?trade_order_id=订单号
GET  https://你的域名/api/check-username/用户名
POST https://你的域名/api/login
```

## 2. 必须绑定 KV

Cloudflare Pages Functions 不能用内存或本地文件保存订单，所以本版本使用 Cloudflare KV。

在 Cloudflare 控制台创建一个 KV Namespace，然后在 Pages 项目里绑定：

```text
Binding name: CITYRAIL_KV
```

代码里读取的是 `env.CITYRAIL_KV`，所以绑定名必须叫 `CITYRAIL_KV`。

KV 里会保存：

- `order:<trade_order_id>`：订单状态
- `pending-user:<username>`：待支付用户名对应订单
- `user:<username>`：支付成功后的正式账号

## 3. 必须设置环境变量

进入：

```text
Cloudflare Dashboard
→ Workers & Pages
→ 你的 Pages 项目
→ Settings
→ Environment variables
```

添加：

```text
XHP_APPID=201906180967
XHP_APPSECRET=你的虎皮椒密钥
XHP_GATEWAY=https://api.xunhupay.com/payment/do.html
CITYRAIL_PRODUCT_TITLE=CityRail都市城轨完整版
PUBLIC_BASE_URL=https://你的Cloudflare域名
```

`PUBLIC_BASE_URL` 必须是公网 HTTPS 域名，例如：

```text
https://你的项目.pages.dev
```

或你绑定的正式域名。

注意：你之前已经把虎皮椒密钥发在聊天里，正式上线前建议去虎皮椒后台重置密钥，然后只放到 Cloudflare 环境变量里。

## 4. 前端不用改地址

前端仍然请求相对路径：

```text
/api/pay/create
/api/pay/status
/api/login
/api/check-username/:username
```

部署到 Cloudflare Pages 后，会自动请求同域名下的 Pages Functions。

## 5. 支付开通逻辑

1. 用户填写用户名和密码。
2. 点击微信或支付宝支付。
3. `/api/pay/create` 创建待支付订单，订单和密码哈希写入 KV。
4. 用户扫码付款。
5. 虎皮椒回调 `/api/pay/notify`。
6. Function 验签、校验金额、校验订单号。
7. 成功后写入 `user:<username>`，账号变为正式可登录。
8. 前端轮询 `/api/pay/status`，显示支付成功并进入游戏。

正式账号只会在虎皮椒回调验签成功后创建。单纯跳转回游戏页面不会开通账号。

## 6. 部署后怎么检查

先访问：

```text
https://你的域名/api/pay/status
```

如果返回：

```json
{"error":"缺少订单号"}
```

说明 Pages Functions 已经工作。

如果是 404，说明 `functions/` 没部署成功。

如果是 500，打开 Cloudflare Pages 的 Functions Logs，看是不是缺少 `CITYRAIL_KV`、`XHP_APPSECRET` 或其他环境变量。

## 7. 本地自检

```bash
npm run selfcheck
```

会检查前端 JS、Cloudflare Functions JS、静态检查和浏览器 smoke test。
