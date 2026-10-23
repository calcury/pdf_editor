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

## 本地 PDF 压缩

开启 **Compress PDF** 开关后，应用在浏览器中使用 Ghostscript WebAssembly 重写 PDF：清理无用对象并按滑块设置重采样/压缩内嵌彩色与灰度图片，不会把整页栅格化，文字和矢量保持为 PDF 内容。比例从 10%（更小文件/更低图片质量）到 95%（更高质量/可能更大文件）。整个处理过程可由 GitHub Pages 静态托管，不需要 Python 服务端；首次压缩会下载约 16 MB 的引擎。

Ghostscript WebAssembly 使用 AGPL-3.0 许可证。公开部署/分发前请确认符合许可证义务及源代码提供要求；商业使用需确认许可证是否适用。引擎约 16 MB，仅在压缩时加载。

## 功能与限制

- 文件及页面仅保存在当前浏览器会话内，刷新页面后需重新选择文件。
- 图片压缩比例控制 Ghostscript 的图像重采样和 JPEG 编码设置，不保证输出文件大小会严格按百分比缩放；图片原本已高度压缩时，文件大小可能变化很小。
- 虽允许最多 500 MB 输入，但浏览器处理会产生额外内存开销，大型文档可能运行缓慢或失败。建议拆分大文件；加密、损坏或复杂 PDF 的兼容性取决于浏览器端解析库。
- 修改、合并输出可能无法保留所有特殊对象（例如数字签名、表单、注释或书签）。请检查下载结果；不要用作唯一存档。

## 技术栈

Vite、PDF.js（预览）、pdf-lib（合并、页面选择与尺寸调整）和 Ghostscript WebAssembly（PDF 图片压缩）。Ghostscript 使用 AGPL-3.0 许可证，分发前请检查合规要求。
