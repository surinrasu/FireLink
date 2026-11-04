# FireLink 开题汇报

开题汇报网页与志愿者客户端演示。页面、截图、启动器、本地演示后端和测试均保存在本目录。

线上版位于 `/pre/proposal`，使用 `static.html`、`public/static.ts` 和已有截图，支持翻页及系统深浅色。随工作台一起构建和部署。

## 运行

使用项目固定的 Bun 1.4.3，以及项目 Android 构建环境。启动器会准备专用 AVD 并启动客户端演示。

在仓库根目录执行：

```sh
mise -C server install
mise run presentation:install
mise run presentation:proposal
```

默认地址为 `http://127.0.0.1:4173`，运行日志与本机 AVD 保存在 `.artifacts/`。

## 检查与截图

在仓库根目录执行 `mise run check:presentation` 运行类型检查与测试；`mise run presentation:screenshots` 启动客户端并更新 `public/screenshots/` 中的演示截图。

直接使用 Bun 时，在本目录执行 `bun install --frozen-lockfile` 安装依赖，再用 `bun run start` 启动。`bun run check`、`bun run test` 和 `bun run screenshots:update` 分别对应类型检查、测试与截图更新。

结题汇报、PDF 和演讲稿见 [../final/](../final/)。
