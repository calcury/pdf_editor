# PDF 编辑器（GitHub Pages）

纯前端 PDF 页面整理工具。所有文件均在浏览器本地读取和处理，不会上传到服务器。支持多 PDF 页面合并、页面预览、选择/重排页面及输出为原始尺寸、A4 或 A3。

## 本地测试

需要 Node.js 20 或更高版本：

```sh
npm ci
npm run dev
```

打开终端显示的本地地址（通常是 `http://localhost:5173`），在浏览器里选择 PDF 进行测试。生产版本本地预览：

```sh
npm run build
npm run preview
```

打开 preview 命令显示的地址（通常是 `http://localhost:4173`）。如果 Windows 临时目录权限导致构建出错，可将临时目录设为项目内路径后再运行：

```powershell
$env:TEMP="$PWD\.tmp"; $env:TMP="$PWD\.tmp"; New-Item -ItemType Directory -Force $env:TEMP | Out-Null; npm run build
```

构建产物位于 `dist/`。

## GitHub Pages 自动部署

1. 将仓库推送到 GitHub。
2. 在 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。
3. 确认 Actions 有 `pages: write` 与 `id-token: write` 权限（工作流已声明），推送到 `main` 分支后自动构建并部署。
4. 如果默认分支不是 `main`，修改 `.github/workflows/deploy.yml` 的触发分支。

工作流自动使用仓库名作为 Vite Pages 子路径；部署到 `username.github.io` 根站点时，设置仓库变量 `PAGES_BASE_PATH` 为 `/`。

## 功能与限制

- 文件及页面仅保存在当前浏览器会话内，刷新页面后需重新选择文件。
- 压缩功能已移除：通用 PDF 压缩通常需要重采样图像/重新编码，可能降低质量；本工具不声称无损压缩或模拟 Ghostscript 质量档。
- 虽允许最多 500 MB 输入，但浏览器处理会产生额外内存开销，大型文档可能运行缓慢或失败。建议拆分大文件；加密、损坏或复杂 PDF 的兼容性取决于浏览器端解析库。
- 修改、合并输出可能无法保留所有特殊对象（例如数字签名、表单、注释或书签）。请检查下载结果；不要用作唯一存档。

## 技术栈

Vite、PDF.js（预览）和 pdf-lib（合并、页面选择与尺寸调整）。
