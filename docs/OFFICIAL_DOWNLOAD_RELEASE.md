# 官网下载与在线使用

目标：官网提供两个路径。

- 在线游玩：继续访问 `https://cityrailgame.com/`，行为保持现有版本。
- 下载客户端：访问 `https://cityrailgame.com/download.html`，先下载安装到本地，再登录或付费解锁。

## 更新策略

桌面客户端是轻量启动器，默认加载：

```text
https://cityrailgame.com/?client=desktop
```

所以核心功能、支付状态、远程更新与在线版一致。网页版本更新后，下载版下次打开即可获得新内容，不需要用户重新下载安装。安装包本体只在桌面壳能力变化时更新。

## 发布清单

官网读取：

```text
releases/latest.json
```

首次打包后，把安装包上传到 `releases/` 或对象存储，再填入：

- `windows.url`
- `macos.url`
- `android.url`
- `version`
- `size`
- `sha256`

下载页会自动启用对应按钮。

## 付费模式

当前采用：

```text
先下载/安装 -> 打开客户端 -> 使用现有登录/付费体系解锁
```

如果后续发现下载包被滥用，或需要改成“先付费再下载”，只需要把 `download.html` 的下载按钮切到支付/登录入口，支付成功后再显示安装包链接；桌面启动器无需重写。

## 打包桌面客户端

进入 `desktop/`：

```bash
npm install
npm run dist
```

产物在 `desktop/dist/`。上传产物后更新 `releases/latest.json`。
