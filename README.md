# dsh-error-brief

让 DeepSeek Harness 把**上游真实错误**显示出来，而不是一律显示「API 密钥无效」。

## 为什么需要

DSH 前端的失败渲染里有一句：

```js
return code === "AUTH" ? t("message.failure.auth") : message;
```

只要错误 `code` 是 `AUTH`（额度用完、上游 403、代理连不上被归类成鉴权失败都会被算进去），
原始 `message` 就被丢掉，换成固定文案。实测里上游明明返回的是：

```
403 {"code":810000,"message":"GLM-5.3 免费额度已用完,开通连续包月会员继续使用"}
```

界面却只显示「API 密钥无效」，导致一路误判成 key / baseURL / 反代配置问题。

## 这个插件做什么

- **Host 半**监听 `session/event` 的 `turn/end` 失败原因，把 `reason` 原文
  （code / message / 完整 JSON）存在**内存环形缓冲**，不写任何文件；
  并注册 `/api/dsh-error-brief/errors` 与 `/api/dsh-error-brief/report` 两个路由。
- **Browser 半**做两件可见的事：
  1. 轮询 Host 路由，把最近一条真实错误显示在右下角**可关闭的提示条**；
  2. 把页面上的「API 密钥无效 / API key is invalid」**就地替换**成
     `[上游错误] <code> <原始 message>`。
- 辅路：拦截非 2xx 的 `fetch` 响应，从 body 里读 `error.message`，
  即使核心没把错误写进 `turn/end` 也能抓到。

不改 app.asar、不改任何现有插件/条目的配置；卸载即完全恢复。

## 安装

1. 打开 DSH →「插件」→「添加插件」，把本仓库**目录**作为本地路径添加。
2. 确认插件是启用状态，按提示**重启 DSH**。
3. 也可以命令行安装（desktop profile 由桌面端管理，命令需用 DSH 自带 CLI）：

```
"<DSH 安装目录>\DeepSeek Harness.exe" --expose-internals ^
  "<DSH 安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" ^
  plugin --profile desktop add "file:<本仓库目录>"
```

## 配置（可选，写在插件自己的 cordis.patch.yml 条目 config 下）

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxErrors` | 20 | 内存里保留的错误条数 |
| `replaceLabel` | true | 是否替换「API 密钥无效」文案；关掉则只保留提示条 |
| `pollMs` | 3000 | 浏览器轮询间隔，最小 1000 |

## 验证

随便发一条会失败的消息（例如选一个额度用完的模型）。
期望：失败处显示 `[上游错误] … GLM-5.3 免费额度已用完 …`，
右下角出现完整原文提示条（点一下关闭）。

## 限制

- 只影响 web 客户端的显示；不修改 DSH 核心错误分类，也不会改变重试策略。
- 若某类错误既不进 `turn/end.reason`、也不经过浏览器 `fetch`，插件抓不到 ——
  这种情况把失败卡片里的「上次尝试错误」原文发我，我再补一条捕获路径。
- 文本替换基于可见文案，不依赖 DSH 的 DOM 类名，升级后一般仍有效；
  若 DSH 改了这句文案，把新文案加到 `lib/client.js` 的 `LABELS` 即可。

## 卸载

插件页移除 `dsh-error-brief`（或在 profile 的 bundles/dependencies 里删掉它），重启 DSH。
