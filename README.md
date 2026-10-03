# Sider ChatGPT

在 Microsoft Edge 的划词浮窗和侧栏中使用自己的 ChatGPT 账号，帮助理解正在阅读的网页。当前版本：**1.0.0**。

[下载可加载扩展](https://github.com/Firefly1007/sider-chatgpt/releases/latest) · [隐私政策](https://firefly1007.github.io/sider-chatgpt/privacy/) · [问题反馈](https://github.com/Firefly1007/sider-chatgpt/issues)

这是由 Firefly1007 维护的独立项目，与 OpenAI、Microsoft 或其他同名产品不存在官方隶属关系。需要用户自行登录 ChatGPT；可用模型、额度及服务可用性由 ChatGPT 决定。

## 安装

1. 在 [Releases](https://github.com/Firefly1007/sider-chatgpt/releases/latest) 下载 **sider-chatgpt-1.0.0.zip**。GitHub 自动生成的 Source code 压缩包是源码，不能直接安装。
2. 将 ZIP 解压到固定目录。找到其中 **Sider-ChatGPT** 文件夹，确认内有 `manifest.json`。
3. 打开 `edge://extensions/`，启用“开发人员模式”，点击“加载解压缩的扩展”，选择上述文件夹。
4. 在普通标签页登录 [ChatGPT](https://chatgpt.com/)，刷新需要划词的网页。
5. 更新时替换原目录内容，在扩展页点击“重新加载”，再刷新阅读页。

## 功能与交互

- **划词阅读**：选择文字后可问 AI、解释、翻译、总结、搜索或生成脑图。仅划词不发送任务；快捷功能在点击后发送，问 AI 在输入问题并提交后发送。
- **原位浮窗**：点击功能后，回答窗替换原悬浮栏。点击 × 释放当前任务并返回悬浮栏；点击网页其他位置关闭普通浮层并取消选区，手动固定的窗口继续保留。
- **拖动**：悬浮栏使用右侧六点把手；浮窗使用标题行中间的双横线把手。操作浮层或输入问题时保留原文高亮。
- **持续追问**：回答完成后可以在同一浮窗中追问。快捷功能首轮使用 Instant，后续追问可选择网页实际可用的思考程度。中断后可手动“重新开始”，不会自动重复提交原问题。
- **侧栏**：点击扩展图标打开 ChatGPT。侧栏打开时，划词栏的“附加”将选区写入对话草稿，不自动发送。
- **附加网页**：点击侧栏原生输入框内的回形针，将当前网页标题、URL 和提取后的正文提交给 ChatGPT。此动作会直接发送；已有文本草稿会暂存并尝试恢复。
- **本地呈现**：支持 Markdown、KaTeX 公式、Mermaid 脑图及图表导出，相关依赖与字体随扩展打包。
- **外观与设置**：跟随系统或当前生效的 Dark Reader 主题；可设置目标语言、思考偏好、排除网站，以及是否隐藏豆包网页浮层以避免重叠。

## 数据处理

执行任务时，问题、选中文字及必要网页背景会通过 ChatGPT 网页提交给该服务。**“问 AI”和“解释”可能附带提取后的整篇网页正文，其他划词任务使用选区附近背景；材料可包含页面标题和 URL。** 请不要在不希望提交内容的页面使用相关功能。

扩展没有开发者自建的数据接收服务器，不提取密码、Cookie 或账号令牌。设置保存在浏览器本地；任务标识使用会话存储；问题正文、回答及暂存草稿不写入扩展的持久化存储。启用扩展后会预加载 ChatGPT 网页，因此即使尚未发送任务，也会产生到 ChatGPT 的正常网页连接。

ChatGPT 网页自身的账号、Cookie、网络信息、数据保存与训练设置适用其政策。浮窗使用临时聊天，侧栏是普通 ChatGPT 网页；**关闭浮窗并不等于删除 ChatGPT 服务端的数据**。完整说明见 [隐私政策](https://firefly1007.github.io/sider-chatgpt/privacy/)。

## 权限

| 权限 | 实际用途 |
| --- | --- |
| 网站访问权限 | 在普通 HTTP/HTTPS 页面显示划词工具、读取用户启动任务所需材料；操作 ChatGPT 网页 |
| `offscreen` | 在扩展隐藏文档中承载临时 ChatGPT 网页及备用会话 |
| `storage` | 保存设置和任务关联标识，不持久化保存任务正文 |
| `tabs` | 读取当前标签页 URL，核对附加内容的来源并处理页面通信 |
| `sidePanel` | 在 Edge 侧栏呈现 ChatGPT |
| `webNavigation` | 来源文档导航后清理旧任务，防止结果串到新页面 |
| `declarativeNetRequestWithHostAccess` | 仅对本扩展发起、目标为 ChatGPT 的子框架响应移除 `Content-Security-Policy` 和 `X-Frame-Options`，以支持嵌入 |

## 从源码构建

需要 Node.js 24；打包需要 Python 3。安装成品 ZIP 不需要这些开发工具。

```sh
npm ci
npm run build
npm run check
python scripts/package.py
```

- `dist/`：构建后可以加载的扩展目录。
- `artifacts/Sider-ChatGPT-可加载包.zip`：成品扩展，包含 `Sider-ChatGPT/manifest.json`。
- `artifacts/Sider-ChatGPT-源码.zip`：公开源码快照。
- 自定义产物目录：`python scripts/package.py --output-dir /path/to/output`。

依赖锁定在 `package-lock.json`，第三方依赖许可随构建输出到 `dist/THIRD-PARTY-NOTICES.txt`。本地参考材料、真实浏览调试记录和内部截图不包含在公开仓库或源码包中。

## 验证

```sh
npm test
node --test tests/browser/extension.test.js tests/browser/features.test.js
```

测试主要在 Windows 上运行。部分界面测试使用已安装的 Microsoft Edge；完整 MV3 测试需要 Playwright Chromium 和 PowerShell 7。先运行 `npx playwright install chromium`；已有浏览器时，可通过 `CGP_CHROMIUM_PATH` 指定可执行文件。PowerShell 不在 PATH 时可设置 `CGP_POWERSHELL_PATH`。

完整 MV3 测试使用本地代理提供模拟 ChatGPT 网页并阻止外部网络请求，不调用真实账号或消耗模型额度。`npm run test:browser` 还包含等待时间较长的会话闲置测试。

## 限制与反馈

扩展商店页、浏览器内部页面等受保护页面无法注入划词功能。ChatGPT 改版、登录过期、模型权限变化或浏览器终止后台页面会影响可用性。安装成功不等于已通过扩展商店审核。

通过 [GitHub Issues](https://github.com/Firefly1007/sider-chatgpt/issues) 报告问题。Issues 是公开的，请勿提交密码、Cookie、令牌、完整私人对话或敏感网页材料。
