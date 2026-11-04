# FireLink 课程汇报

| 目录 | 内容 | 启动命令（在仓库根目录执行） |
| --- | --- | --- |
| [proposal/](proposal/) | 开题汇报，包含志愿者客户端演示、截图与测试 | `mise run presentation:proposal` |
| [final/](final/) | 结题汇报，包含双语幻灯片、PDF 与独立演讲稿 | `mise run presentation:final` |

汇报脚本统一使用项目固定的 Bun 1.4.3。首次使用可执行 `mise -C server install` 准备工具链。开题汇报再执行 `mise run presentation:install` 安装依赖，并按照 [开题汇报说明](proposal/README.md) 准备 Android 环境。结题汇报使用 Bun 内置模块，也可直接打开 [离线幻灯片](final/FireLink-结题汇报.html)。

两个预览默认使用 `http://127.0.0.1:4173`，请分别启动。开题汇报可以通过 `DEMO_PORT` 调整端口。

| 任务（在仓库根目录执行） | 用途 |
| --- | --- |
| `mise run presentation:install` | 按锁文件安装开题汇报及其后端依赖 |
| `mise run presentation:build` | 重建结题幻灯片与演讲稿 HTML |
| `mise run presentation:deploy` | 随现有站点发布两份汇报及演讲稿 |
| `mise run check:presentation` | 开题汇报类型检查与测试 |
| `mise run presentation:screenshots` | 启动开题客户端并更新演示截图 |

也可在本目录使用 `bun run proposal`、`bun run final`、`bun run final:build`。`bun run start`、`bun run test`、`bun run check`、`bun run screenshots:update` 等命令转发到开题汇报；单独安装开题依赖使用 `bun install --cwd proposal --frozen-lockfile`。

线上路径为 `/pre/proposal`、`/pre/final` 和 `/pre/final/script`（演讲稿），讲稿 PDF 为 `/pre/final/script.pdf`。开题线上版复用原有文案与深浅色截图，支持按钮、方向键和链接定位；本地开题演示仍可运行客户端。`organizer/build.ts` 调用 `site.ts` 将两份汇报加入现有 Worker 的静态资源构建。
