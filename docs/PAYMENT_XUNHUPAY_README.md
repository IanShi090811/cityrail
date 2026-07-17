# CityRail 虎皮椒支付接入说明（v146.7）

本版本只新增支付接入，不改动游戏模拟、控制中心、ATS、快慢车等现有逻辑。

## 已新增接口

- `POST /api/pay/create`：创建虎皮椒支付订单
- `POST /api/pay/notify`：虎皮椒异步回调，验签成功且状态为 `OD` 后创建正式账号
- `GET /api/pay/status?trade_order_id=...`：前端轮询订单状态

## 环境变量

请在服务器或部署平台配置：

```bash
XHP_APPID=201906180967
XHP_APPSECRET=你的虎皮椒密钥
XHP_GATEWAY=https://api.xunhupay.com/payment/do.html
PUBLIC_BASE_URL=https://你的公网域名
CITYRAIL_PRODUCT_TITLE=CityRail都市城轨完整版
```

`PUBLIC_BASE_URL` 必须是公网 HTTPS 域名，否则虎皮椒服务器无法访问 `/api/pay/notify`。
支付金额由后端固定为 `18.8` 元，不通过环境变量覆盖。

## 支付流程

1. 用户注册填写用户名密码。
2. 点击微信/支付宝支付。
3. 前端请求 `/api/pay/create`。
4. 后端签名并请求虎皮椒网关。
5. 前端显示虎皮椒返回的二维码或跳转链接。
6. 虎皮椒支付成功后回调 `/api/pay/notify`。
7. 后端验签，确认金额和订单号，写入正式用户。
8. 前端轮询 `/api/pay/status`，成功后进入游戏。

## 安全说明

密钥只在后端使用，前端 JS 不包含密钥。

## v146.7 Cloudflare Pages 说明

如果你部署在 Cloudflare Pages，不需要启动 `server/server.js`。本版本已经新增 `functions/` 目录，Cloudflare 会把它自动部署成 `/api/pay/create`、`/api/pay/notify`、`/api/pay/status` 等接口。

Cloudflare Pages 必须额外配置：

1. KV 绑定：`CITYRAIL_KV`
2. 环境变量：`XHP_APPID`、`XHP_APPSECRET`、`XHP_GATEWAY`、`CITYRAIL_PRODUCT_TITLE`、`PUBLIC_BASE_URL`

详细步骤见 `docs/CLOUDFLARE_PAGES_PAYMENT_SETUP.md`。
