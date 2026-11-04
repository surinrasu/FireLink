# 组件清单

目前应用的范围：登录、开始、任务列表与详情、任务编辑、报名审核、事件、通知、组织与账户设置。

## 样式与代码入口

| 层级             | 来源                                                       | 职责                                           |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| 基础控件         | BeerCSS                                                    | 原生控件的基础样式、图标、交互反馈             |
| 主题             | [theme.ts](src/theme.ts) + `theme.css`                     | 亮暗模式、主题色、语义色、高对比度基础         |
| 共享组件         | [components.css](public/components.css)                    | 控件尺寸、字号、圆角、状态、弹层、反馈         |
| 页面组合         | [style.css](public/style.css)                              | 栅格、侧栏、底栏、各页面的空间安排与响应式重排 |
| 共享 HTML 与行为 | [ui.ts](src/ui.ts)                                         | 表单、搜索、标签、空状态、弹窗、提示、内容渲染 |
| 专用交互         | `selects.ts`、`task-picker.ts`、`hue-picker.ts`、`maps.ts` | 键盘操作、选择、主题色、地图绘制等             |

加载顺序为 BeerCSS → Leaflet → 主题 → 共享组件 → 页面布局。`style.css` 末尾的强制颜色和减少动画规则保留最高优先级。

## 组件目录

| 编号 | 组件               | 共用入口                                                                | 关键细节                                                                                                                                          |
| ---- | ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 操作按钮           | `button`、`a.button`                                                    | 主操作使用实心；次要操作使用 `.border`；辅助操作使用 `.transparent`。按钮和链接按钮共用字号、尺寸、图标间距和圆角。                               |
| 2    | 图标按钮           | `.circle` + `icon()`                                                    | 用于关闭、主题、账户等；必须有 `aria-label`，保留完整点击范围。                                                                                   |
| 3    | 输入框             | `input()`、`.field`                                                     | 文本、密码、邮箱、数字、日期时间共用边框与圆角；保留可见标签及浏览器输入语义。                                                                    |
| 4    | 多行输入           | `textarea()`                                                            | 与输入框共用外观；允许纵向调整，长文本自然换行。                                                                                                  |
| 5    | 搜索框             | `searchField()`                                                         | 任务、报名、事件和选择弹窗共用搜索图标、边框、圆角、标签与输入结构。                                                                              |
| 6    | 下拉与选项菜单     | `select()`、[selects.ts](src/selects.ts)                                | 保留原生 `select` 作为值来源；菜单支持方向键、首尾跳转、键入匹配、Esc 和焦点恢复。                                                                |
| 7    | 带搜索的选择弹窗   | `openTaskPicker()`                                                      | 事件与负责人使用同一弹窗，统一选项、描述、选中标记与空结果提示。                                                                                  |
| 8    | 页面筛选标签       | `.filter-chips`                                                         | 任务状态、报名状态使用相同标签；当前项以底色、描边、字重和下划线共同表示。导航使用 `aria-current`。                                               |
| 9    | 分段切换           | `.segmented-control`                                                    | 排序和卡片／列表共用分段外观；一次选中一项。排序保留方向键与滑动指示，大字号时纵向排列。                                                          |
| 10   | 多选按钮           | `.multi-select-option`                                                  | 活跃事件和资料要求共用小圆角矩形、选中描边、底色及字重；分别保留 `aria-pressed` 和原生 checkbox。                                                 |
| 11   | 普通复选与单选     | `.checkbox`、`.preference-choice`                                       | 成员权限、主题和字号设置保留原生输入；标签也可点击，选择状态可见。                                                                                |
| 12   | 状态标签           | `badge()`、`.status`                                                    | 招募、报名和验证状态使用语义色与文字。状态标签不作为按钮，也不只靠颜色表达。                                                                      |
| 13   | 面板与卡片         | `.panel`、`.task-card`、`.review-layout`                                | 共用表面色、边框和主面板圆角；任务卡片、审核分栏等保留各自内容布局。                                                                              |
| 14   | 页面标题与操作区   | `heading()`、`.page-heading`、`.page-actions`                           | 标题、说明和右侧操作按同一方式排列；空间不足时换行。                                                                                              |
| 15   | 列表选项           | `.select-option`、`.task-picker-option`、`.application-row`             | 统一选中色与文字色；选项菜单、资料列表分别保留勾选或描边等状态提示。                                                                              |
| 16   | 导航与页内标签     | `.side-link`、`.mobile-nav`、`.tabs`                                    | 侧栏与底栏共用当前项颜色和字重；页内标签保留下划线。窄屏与大字号允许重排。                                                                        |
| 17   | 折叠区             | `details` / `summary`                                                   | 编辑分区、任务安排、审核补充资料采用原生折叠语义；摘要可键盘操作。                                                                                |
| 18   | 弹窗               | `openDialog()` / `closeDialog()`                                        | 统一标题、关闭按钮、宽度、圆角、遮罩、动作区与焦点恢复。`wide` 只用于较宽内容。                                                                   |
| 19   | 空状态             | `empty()`                                                               | 图标、标题、说明、恢复操作共用结构。提示应说明当前为空的原因或下一步。                                                                            |
| 20   | 提示、错误与结果   | `formError()`、`.field-error`、`.info-note`、`.review-outcome`          | 字段错误靠近字段；表单错误使用 alert 并获得焦点；成功结果和信息提示使用各自语义色。                                                               |
| 21   | 临时提示与断网提示 | `toast()`、`.connection-banner`                                         | 临时反馈与持续网络状态分开；手机上避开底栏，使用 live region 通知辅助技术。                                                                       |
| 22   | 加载与忙碌状态     | `.route-status`、`setBusy()`                                            | 路由进度与提交状态共用现有机制；使用 `aria-busy` 并避免重复提交，尊重减少动画设置。                                                               |
| 23   | 进度、表格与资料   | `.progress-track`、`.table-scroll`、`.definition-list`、`.profile-grid` | 数字进度保留文本和 meter 语义；宽表允许局部滚动，资料内容可换行。                                                                                 |
| 24   | 分页与连续审核     | `.pagination`、`.review-navigation`                                     | 共用操作按钮；页码、上一份／下一份保持明确文字。                                                                                                  |
| 25   | 文件上传与媒体     | `.upload-actions`、`.upload-button`、`renderBlocks()`                   | 上传入口复用按钮；文件输入可被键盘操作，上传中显示状态，图片与视频有说明。                                                                        |
| 26   | 地图               | [incident-map.ts](src/incident-map.ts)、[maps.ts](src/maps.ts)          | 事件地图负责查看与筛选；编辑地图负责绘制。Shadow DOM 内的操作按钮、坐标输入和焦点环复用相同尺寸与形状变量。地图底图与标记保留地理识别需要的配色。 |
| 27   | 主题与色相选择     | `preferences()`、`applyPreferences()`、`huePicker()`                    | 同一个设置来源；主题、字号和色相在页面之间保留，支持亮暗模式与系统偏好。                                                                          |

## 共用尺寸

以下变量在 `components.css` 的 `:root` 中定义。颜色统一引用 `theme.ts` 的语义色。

| 变量                               | 当前值               | 用途                         |
| ---------------------------------- | -------------------- | ---------------------------- |
| `--font-control`                   | `0.9rem`             | 操作与选择控件的文字         |
| `--font-caption`                   | `0.8rem`             | 帮助与次要说明               |
| `--control-height`                 | `max(44px, 2.75rem)` | 点击范围，随字号增大         |
| `--field-height`                   | `3rem`               | 单行表单与搜索               |
| `--control-gap`                    | `8px`                | 同组控件、图标与文字间距     |
| `--radius-action`                  | `999px`              | 操作按钮与单选筛选标签       |
| `--radius-choice`                  | `10px`               | 多选按钮                     |
| `--radius-field`                   | `12px`               | 输入框、搜索框及局部内容容器 |
| `--radius-item`                    | `10px`               | 菜单和列表选项               |
| `--radius-surface`                 | `20px`               | 主面板、卡片、弹窗           |
| `--radius-overlay`                 | `16px`               | 浮层菜单和提示               |
| `--radius-status`                  | `8px`                | 状态标签                     |
| `--focus-width` / `--focus-offset` | `3px` / `3px`        | 键盘焦点提示                 |

## 复用示例

```ts
searchField("task-search", "搜索任务", {
  placeholder: "搜索任务、事件或负责人",
  value: query,
  className: "search", // 工具栏中的弹性布局
});

input("title", "任务标题", title, "required maxlength=120");
select("task", "所属任务", choices, taskId);
badge("expired");
empty("无匹配任务", "请调整筛选条件。", actionHtml);
openDialog("确认操作", bodyHtml);
```

```html
<button type="submit">保存</button>
<button type="button" class="border">取消</button>
<a class="button border" href="#/tasks">返回任务</a>
<button type="button" class="transparent circle" aria-label="关闭">
  <i aria-hidden="true">close</i>
</button>

<div class="segmented-control" role="group" aria-label="任务视图">
  <button type="button" aria-pressed="true">卡片</button>
  <button type="button" aria-pressed="false">列表</button>
</div>

<button class="multi-select-option" type="button" aria-pressed="true">
  事件名称
</button>
```

## 新页面约定

- 先查目录并复用已有函数或类，再增加新变体。相同用途的控件使用相同状态和尺寸。
- 页面只定义位置、排列、宽度、断点等布局，避免重新指定按钮字号、图标大小、输入框圆角与选中色。
- 搜索、下拉和普通输入共用 `.field`。工具栏通过 gap 管理间距，清除组件库自动添加的相邻字段外边距。
- 操作按钮、多选、导航和状态标签保留不同语义；有视觉差异时应能用职责解释。
- 所有文本进入 HTML 前使用 `h()`；表单保留 label，纯图标按钮保留可访问名称。
- `aria-pressed`、`aria-checked`、`aria-current` 和原生 `checked` 与视觉状态同步；多选不改成单选交互。
- 增加组件时同时检查默认、悬停、键盘焦点、选中、禁用及实际需要的忙碌／错误状态。
- 保留现有强制颜色、减少动画、主题色、手机安全区和大字号支持。

## 验证入口

在本地服务运行时，从 `organizer/` 执行：

```sh
bun run check
bun run build
bun run test:browser
bun run test:ux
bun run test:colors
bun run test:media
```
