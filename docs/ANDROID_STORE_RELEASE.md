# CityRail 轨道交通模拟器 Android 上架版

这个目录用于构建国内安卓商店专用包。核心玩法仍来自根目录现有 Web runtime；Android 工程只负责本地 WebView 宿主、试用/专业版授权入口、渠道支付适配和商店包装。

## 定位

- 应用名：CityRail 轨道交通模拟器
- 分类建议：教育 / 工具
- 包名：`com.cityrail.simulator`
- 玩法表述：轨道交通规划、线路设计、客流仿真、调度模拟
- 避免表述：游戏、游玩、玩家、充值、排行榜、联机、社区

## 构建方式

使用 Android Studio 打开 `android/`，同步 Gradle 后选择渠道 flavor。当前仓库还没有提交 Gradle Wrapper，因此命令行构建需要先在本机安装 Android SDK 与 Gradle，或在 Android Studio 中生成 Wrapper 后再执行：

```bash
gradle :app:assembleGenericRelease
gradle :app:assembleHuaweiRelease
gradle :app:assembleOppoRelease
gradle :app:assembleVivoRelease
```

构建时 `syncCityRailWeb` 会把根目录的 `index.html`、`js/`、`vendor/`、`assets/` 等静态资源同步进 APK 的 `android_asset/www`。`assets/posters/` 被排除，避免把未纳入发布的素材带入商店包。

## 试用与专业版

当前 Android 注入层实现了 30 分钟试用，试用期内不改变核心模拟功能。试用期结束后，遮罩会阻止继续使用，并引导用户解锁专业版授权。

授权状态保存在 Android `SharedPreferences`，渠道支付成功后调用：

```kotlin
licenseStore.markProfessional(orderId, channel)
```

## 渠道支付

支付入口已经抽象为：

- `PaymentGateway`
- `PaymentGatewayFactory`
- `huawei` / `oppo` / `vivo` / `generic` flavor

现在默认是渠道支付 stub。正式上架前，需要分别接入对应商店允许的应用内购买或数字商品服务：

- 华为：HMS IAP / 数字商品服务
- OPPO / 一加：OPPO 开放平台允许的支付能力
- vivo：vivo 开放平台允许的支付能力

不建议在 APK 内直接绕过渠道接微信、支付宝或银行卡网页支付。专业版属于数字功能授权，直接接第三方支付容易触发渠道审核风险。

## 合规建议

首版尽量保持：

- 不登录
- 不云存档
- 不 Workshop
- 不排行榜
- 不广告
- 不推送
- 不第三方统计 SDK
- 只申请 `INTERNET` 与 `ACCESS_NETWORK_STATE`

这样能最大限度减少隐私和备案材料复杂度。应用商店仍可能要求 APP 备案、软著或电子版权证书，具体以渠道审核为准。
