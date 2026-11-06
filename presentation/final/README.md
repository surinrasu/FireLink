# FireLink 结题汇报

邓雪意（24168119）、朱禹杭（24168202）的 20 分钟课程结题汇报。共 26 页主体（含 FireLink 结束页）与 9 页备查，默认中文，可切换英文。主体计划讲述 18:50，留出 1:10 用于停顿、放大截图和现场衔接。

服务完成点是审核通过与经同意的联系方式交接；后续沟通和现场协作沿用组织已有渠道。

## 交付文件

| 文件 | 用途 |
| --- | --- |
| [FireLink-结题汇报.html](FireLink-结题汇报.html) | 可独立复制和离线播放的双语演示，图片、样式和脚本已内嵌 |
| [FireLink-结题汇报.pdf](FireLink-结题汇报.pdf) | 中文幻灯片，35 页 |
| [FireLink-Final-Review-English.pdf](FireLink-Final-Review-English.pdf) | 英文幻灯片，35 页 |
| [FireLink-演讲稿.html](FireLink-演讲稿.html) | 独立中文讲稿，包含逐页口述、操作提示、时间安排与备查回答 |
| [FireLink-演讲稿.pdf](FireLink-演讲稿.pdf) | 可打印的中文讲稿，15 页 |
| [FireLink-演讲稿.md](FireLink-演讲稿.md) | 仅含小标题和讲述正文的 Markdown，包含主体与答辩备查 |

## 快速播放

线上汇报位于 `/pre/final`，独立演讲稿位于 `/pre/final/script`，讲稿 PDF 位于 `/pre/final/script.pdf`。汇报的“帮助”面板也提供演讲稿入口。

直接用浏览器打开 `FireLink-结题汇报.html` 即可。演示采用静态界面截图，无需启动应用、后端或模拟器。建议把独立讲稿放在手机、纸质稿或另一块屏幕上。

也可从仓库根目录启动本地预览：

```sh
mise run presentation:final
```

打开 <http://127.0.0.1:4173>。此命令使用项目固定的 Bun 版本提供静态文件，按 `Ctrl+C` 结束。也可在 `presentation` 目录执行 `bun run final`，或在本目录执行 `bun serve.ts`。

| 操作 | 快捷键或入口 |
| --- | --- |
| 上一页 / 下一页 | `←` / `→`，或底部按钮 |
| 当前播放范围的首页 / 末页 | `Home` / `End` |
| 目录、标题搜索、备查跳转 | `O`；默认主体播放在第 26 页结束 |
| 中文 / English | `L` |
| 隐藏 / 显示底栏 | `F`；隐藏后也可点击右下角按钮恢复 |
| 切换深浅色 | `D` 或底部“主题”按钮 |
| 同屏中文讲稿与计时 | `N`；投影时打开会让观众看到讲稿 |
| 查看完整界面截图 | 点击截图，滚动查看，`Esc` 返回 |
| 黑屏 / 恢复 | `B`；黑屏后任意按键或点击可恢复 |
| 关闭弹窗 | `Esc` |
| 打印当前语言的全部 35 页 | `P` |
| 查看帮助 | `H` 或 `?` |

手机上页面纵向重排，宽表格可横向滚动。底部“备查页”可扩展播放范围，“主题”可切换亮暗外观。隐藏底栏后幻灯片会自动放大，翻页与其他快捷键仍可使用。PDF 可作播放备用。

## 编辑与重建

| 源文件 | 编辑内容 |
| --- | --- |
| [content.ts](content.ts) | 中英文文案、页面结构、图片名、逐页中文讲述 `notes` 与建议时长 `time` |
| [style.css](style.css) | 演示样式、手机重排、打印排版 |
| [app.ts](app.ts) | 翻页、目录、语言切换、弹窗与快捷键 |
| [index.html](index.html) | 开发版页面骨架，通过本地预览服务器加载 TypeScript 构建的脚本及 `assets/` |
| [assets/](assets/) | 静态界面截图与标志 |
| [speaker-script.ts](speaker-script.ts) | 独立讲稿生成器，`actions` 为逐页操作，`cautions` 为答辩补充提示 |

修改源文件后，从仓库根目录执行：

```sh
mise run presentation:build
```

此任务使用 Bun 将 TypeScript 打包为浏览器脚本，依次生成离线演示 HTML、独立讲稿 HTML 和 Markdown，无需安装第三方运行时依赖。单独使用本目录时，运行 `bun build.ts` 和 `bun speaker-script.ts`。直接修改生成后的 HTML 或 Markdown 会在下次重建时被覆盖。更新图片时，保持 `content.ts` 中的文件名与 `assets/` 一致。

执行 `mise run check:presentation` 会检查开题与结题演示的 TypeScript 类型，并运行演示测试。结题演示与开题演示共用 `proposal/` 中锁定的 TypeScript 和类型依赖，可通过 `mise run presentation:install` 安装。

PDF 需在 HTML 重建后重新导出：打开演示，选好语言后按 `P`，保存为对应 PDF，保留背景图形并关闭浏览器页眉页脚；讲稿使用其“打印讲稿”按钮。重建任务不会自动更新 PDF。

## 设计与验证依据

视觉延续组织者工作台，以 [theme.ts](../../organizer/src/theme.ts)、[components.css](../../organizer/public/components.css)、[style.css](../../organizer/public/style.css) 和 [组件清单](../../organizer/COMPONENTS.md) 为依据。演示使用固定 H266 蓝色、PingFang 系列字体、圆角控件及实际应用截图。

本次交付记录：70 个桌面语言与页面组合检查通过；390px、700px 宽度的中英文布局检查未发现页面横向溢出；7 项交互检查通过，未记录外部网络请求或页面错误。相关后端 49 项测试与配色方案 4 项测试通过。新增自定义资料界面通过 `custom-requirements` 场景的桌面、手机布局及资料区域无障碍自动检查。检查范围和视觉交接说明保存在仓库 `.artifacts/final-report/`，属于本次范围内的验证记录。

任务创建与审核截图已对应 `4afb122` 的自定义资料设计：用“可参与时段”和“相关支援经验”展示填写项与申请答案的关系。第 13、15、16、23 页、来源备查及对应讲稿同步说明自定义资料、答案快照、要求锁定和验证结果。

PR #1 合并时按演讲者确认的 `034a36d` 同步重建全部交付材料。此次复跑后端 57 项、演示 15 项及配色 4 项测试，全部通过；中英文桌面、手机布局与 7 项交互检查通过，记录位于 `.artifacts/pr1-merge-validation/`。

演练事件与人员资料为合成数据。内容以实现与机制为依据，研究假设和补充说明保留在讲稿中。范围约定见 [PRODUCT.md](PRODUCT.md)。
