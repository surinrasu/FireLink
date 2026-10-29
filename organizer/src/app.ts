import { mapPreview } from "./maps";
import type {
  Activity,
  ApplicationPage,
  Member,
  OrganizerApplication,
  OrganizerTask,
  ResultNotice,
  Session,
  Workspace,
} from "../../shared/organizer";
import { api, APIError, setOrganization } from "./api";
import {
  applyPreferences,
  badge,
  closeDialog,
  empty,
  errorText,
  fieldLabels,
  formatDate,
  formError,
  h,
  icon,
  input,
  openDialog,
  preferences,
  renderBlocks,
  select,
  setBusy,
  stateLabels,
  textarea,
  toast,
  vehicleLabels,
} from "./ui";
import { mountEditor, type EditorHandle } from "./editor";

const root = document.querySelector<HTMLDivElement>("#app")!;
let session: Session | null = null;
let workspace: Workspace;
let currentOrg = "";
let generation = 0;
let editor: EditorHandle | null = null;
const reviewDrafts = new Map<string, { response: string; note: string }>();
const organizationDrafts = new Map<string, Record<string, string>>();
let reviewOutcome: {
  id: string;
  name: string;
  status: string;
  organization: string;
} | null = null;
const reviewDraftKey = (id: string) => `${currentOrg}:${id}`;

async function confirmDiscardDrafts() {
  if (!reviewDrafts.size && !organizationDrafts.size) return true;
  const dialog = openDialog(
    "有尚未提交的内容",
    `<p class="dialog-copy">退出登录将丢失暂存的${[reviewDrafts.size ? "审核回应和内部备注" : "", organizationDrafts.size ? "组织资料更改" : ""].filter(Boolean).join("、")}。</p><div class="dialog-actions"><button class="border" data-close-dialog>继续处理</button><button id="discard-drafts">放弃并退出</button></div>`,
  );
  return new Promise<boolean>((resolve) => {
    const cancel = () => resolve(false);
    dialog.addEventListener("close", cancel, { once: true });
    dialog.querySelector("#discard-drafts")!.addEventListener("click", () => {
      dialog.removeEventListener("close", cancel);
      closeDialog();
      resolve(true);
    });
  });
}
const roles = {
  admin: "组织管理员",
  manager: "任务负责人",
  reviewer: "审核员",
};
const destinations = [
  ["dashboard", "space_dashboard", "工作台"],
  ["tasks", "assignment", "任务管理"],
  ["applications", "fact_check", "报名审核"],
  ["incidents", "explore", "事件协作"],
  ["notices", "notifications", "通知记录"],
  ["settings", "settings", "组织设置"],
];
function routeInfo() {
  const raw = location.hash.slice(1) || "/dashboard";
  return new URL(raw.startsWith("/") ? raw : "/dashboard", location.origin);
}
const canEdit = () => workspace.membership.role !== "reviewer";
const isAdmin = () => workspace.membership.role === "admin";
const taskLink = (task: OrganizerTask) => `#/tasks/${task.id}`;
const applicationsLink = (taskId = "", status = "pending") =>
  `#/applications?${new URLSearchParams({ ...(taskId ? { task: taskId } : {}), status })}`;
function heading(title: string, description = "", actions = "", eyebrow = "") {
  return `<div class="page-heading"><div>${eyebrow ? `<div class="eyebrow">${h(eyebrow)}</div>` : ""}<h1 tabindex="-1">${h(title)}</h1>${description ? `<p>${h(description)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}
function timeline(activities: Activity[]) {
  return activities.length
    ? `<ol class="timeline">${activities.map((a) => `<li><strong>${h(a.actor)}</strong> · ${h(a.action)}<p>${h(a.subject)}</p><small>${formatDate(a.createdAt)}</small></li>`).join("")}</ol>`
    : `<p class="muted">暂时没有操作记录。</p>`;
}
function taskProgress(task: OrganizerTask) {
  const percentage = task.capacity
    ? Math.min(100, (task.accepted / task.capacity) * 100)
    : 0;
  return `<div><div class="progress-label"><span>已通过 <strong>${task.accepted}</strong>${task.capacity ? ` / ${task.capacity} 人` : " 人"}</span><span class="muted">${task.pending} 份待审核</span></div>${task.capacity ? `<div class="progress-track" role="meter" aria-label="已通过报名人数" aria-valuemin="0" aria-valuemax="${task.capacity}" aria-valuenow="${task.accepted}"><span style="width:${percentage}%"></span></div>` : ""}</div>`;
}
function shell(body: string, section: string) {
  const pending = workspace.tasks.reduce((n, task) => n + task.pending, 0);
  root.innerHTML = `<aside class="sidebar" aria-label="工作台导航"><a class="brand" href="#/dashboard"><strong>FireLink</strong></a>${canEdit() ? `<a class="button primary-container create-button" href="#/tasks/new" aria-label="新建任务">${icon("add")}<span>新建任务</span></a>` : ""}<nav class="side-links">${destinations.map(([id, symbol, label]) => `<a class="side-link ${section === id ? "active" : ""}" href="#/${id}" ${section === id ? 'aria-current="page"' : ""} title="${label}">${icon(symbol)}<span>${label}</span>${id === "applications" && pending ? `<span class="count">${pending}</span>` : ""}</a>`).join("")}</nav><div class="sidebar-footer"><span class="workspace-label">${workspace.organization.demo ? "演示环境" : workspace.organization.verified ? "已认证组织" : "组织待认证"}</span></div></aside>
  <div class="app-shell"><header class="topbar"><div class="org-switch">${icon("domain")}<select aria-label="切换组织" id="org-switch">${session!.memberships.map((m) => `<option value="${h(m.organizationId)}" ${m.organizationId === currentOrg ? "selected" : ""}>${h(m.organizationName)}</option>`).join("")}</select></div><span class="topbar-spacer"></span><button class="transparent circle" data-action="appearance" aria-label="外观与阅读设置" title="外观与阅读设置">${icon("contrast")}</button><a class="button transparent circle" href="#/notices" aria-label="通知记录" title="通知记录">${icon("notifications_none")}</a><button class="transparent circle" data-action="account" aria-label="账号菜单"><span class="avatar">${h(session!.account.name.slice(0, 1))}</span></button></header><main class="content" id="main">${body}</main></div>
  <nav class="mobile-nav" aria-label="主要导航">${destinations
    .slice(0, 3)
    .map(
      ([id, symbol, label]) =>
        `<a href="#/${id}" class="${section === id ? "active" : ""}" ${section === id ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span></a>`,
    )
    .join(
      "",
    )}<button class="${["incidents", "notices", "settings"].includes(section) ? "active" : ""}" data-action="more">${icon("more_horiz")}<span>更多</span></button></nav>`;
  document.title = `${destinations.find(([id]) => id === section)?.[2] || "工作台"} · FireLink`;
  root
    .querySelector<HTMLSelectElement>("#org-switch")
    ?.addEventListener("change", async (event) => {
      if (editor?.dirty() && !(await editor.flush())) {
        (event.target as HTMLSelectElement).value = currentOrg;
        return;
      }
      currentOrg = (event.target as HTMLSelectElement).value;
      setOrganization(currentOrg);
      location.hash = "/dashboard";
      void renderRoute();
    });
}
function dashboard() {
  const tasks = workspace.tasks;
  const pending = tasks.reduce((n, task) => n + task.pending, 0);
  const active = tasks.filter((t) => t.state === "open");
  const ending = active.filter(
    (t) => t.deadline && Date.parse(t.deadline) - Date.now() < 3 * 86400000,
  );
  const drafts = tasks.filter((t) => t.state === "draft");
  const today = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date());
  const metric = (
    label: string,
    count: number,
    note: string,
    symbol: string,
    href: string,
  ) =>
    `<a href="${href}" class="metric"><div class="metric-top"><span>${label}</span>${icon(symbol)}</div><strong>${count}<span class="sr-only">${label}</span></strong>${note ? `<small>${note}</small>` : ""}</a>`;
  const attention = tasks
    .filter((t) => t.pending > 0)
    .sort((a, b) => b.pending - a.pending);
  const rows = (attention.length ? attention : active).slice(0, 5);
  return `${heading("工作台", "", canEdit() ? `<a class="button" href="#/tasks/new">${icon("add")}<span>新建任务</span></a>` : "", today)}
  <section class="hero" aria-label="当前待办"><div class="hero-icon">${icon(pending ? "mark_email_unread" : "task_alt")}</div><div class="hero-copy"><h2>${pending ? `${pending} 份报名待审核` : "暂无待审核报名"}</h2></div><a class="button surface" href="${applicationsLink()}">${pending ? "开始审核" : "查看报名"}${icon("arrow_forward")}</a></section>
  <div class="metrics">${metric("待审核报名", pending, "", "fact_check", applicationsLink())}${metric("招募中任务", active.length, "", "campaign", "#/tasks?state=open")}${metric("即将截止", ending.length, "未来 72 小时内", "schedule", "#/tasks?ending=1")}${metric("任务草稿", drafts.length, "", "edit_note", "#/tasks?state=draft")}</div>
  <div class="dashboard-grid"><div><section class="panel"><div class="panel-header"><h2>需要关注的任务</h2><a href="#/tasks">全部任务 ${icon("arrow_forward")}</a></div>${rows.length ? rows.map((t) => `<div class="task-row"><div class="task-symbol">${icon("assignment")}</div><div class="task-info"><a href="${taskLink(t)}">${h(t.title)}</a><p>${h(t.incidentTitle)}</p></div><div class="task-row-end">${badge(t.state)}<small>${t.pending ? `<a href="${applicationsLink(t.id)}">${t.pending} 份待审核 →</a>` : `已通过 ${t.accepted}${t.capacity ? ` / ${t.capacity}` : ""}`}</small></div></div>`).join("") : empty("暂无任务", "", canEdit() ? '<a class="button" href="#/tasks/new">创建任务</a>' : "", "add_task")}</section></div><aside class="dashboard-aside"><section class="panel"><div class="panel-header"><h2>最近动态</h2></div>${timeline(workspace.activities.slice(0, 5))}</section>${!workspace.organization.verified ? `<section class="panel"><h2>完成组织认证</h2><p class="muted">认证后可发布招募。</p><a class="button border" href="#/settings">完善组织资料</a></section>` : ""}</aside></div>`;
}
function taskCard(task: OrganizerTask) {
  return `<article class="task-card" data-search="${h(`${task.title} ${task.incidentTitle} ${task.ownerName}`.toLowerCase())}"><div class="task-card-top">${badge(task.state)}<span class="muted">${icon(task.state === "draft" ? "edit_note" : "assignment")}</span></div><h2><a href="${taskLink(task)}">${h(task.title)}</a></h2>${task.summary ? `<p class="summary">${h(task.summary)}</p>` : ""}<div class="meta-line">${icon("location_on")}${h(task.incidentTitle)}</div><div class="meta-line">${icon("schedule")}${task.deadline ? `${formatDate(task.deadline)} 截止` : "未设置截止时间"}</div>${taskProgress(task)}<footer><span class="muted" style="font-size:.78rem">${h(task.ownerName)} · 负责人</span><a href="${task.state === "draft" && canEdit() ? `${taskLink(task)}/edit` : taskLink(task)}">${task.state === "draft" && canEdit() ? "继续编辑" : "查看任务"} ${icon("arrow_forward")}</a></footer></article>`;
}
function tasksPage(params: URLSearchParams) {
  const state = params.get("state") || "all",
    ending = params.has("ending");
  const visible = workspace.tasks.filter(
    (t) =>
      (state === "all" || t.state === state) &&
      (!ending ||
        (t.state === "open" &&
          !!t.deadline &&
          Date.parse(t.deadline) - Date.now() < 3 * 86400000)),
  );
  return `${heading("任务管理", "", canEdit() ? `<a class="button" href="#/tasks/new">${icon("add")}新建任务</a>` : "")}
  <div class="filter-chips" aria-label="任务状态">${["all", "open", "draft", "paused", "closed", "archived"].map((s) => `<a href="#/tasks${s === "all" ? "" : `?state=${s}`}" class="${s === state && !ending ? "active" : ""}" ${s === state && !ending ? 'aria-current="true"' : ""}>${s === "all" ? "全部任务" : stateLabels[s as keyof typeof stateLabels]} <span>${workspace.tasks.filter((t) => s === "all" || t.state === s).length}</span></a>`).join("")}${ending ? '<a href="#/tasks?ending=1" class="active">72 小时内截止</a>' : ""}</div>
  <div class="toolbar"><div class="field border round prefix search">${icon("search")}<input id="task-search" type="search" placeholder="搜索任务、事件或负责人" aria-label="搜索任务"></div>${select("incident-filter", "所属事件", [["", "全部事件"], ...workspace.incidents.map((i) => [i.id, i.title] as [string, string])])}</div>
  <div class="task-grid" id="task-grid">${visible.map(taskCard).join("")}</div><div id="task-empty" ${visible.length ? "hidden" : ""}>${empty(workspace.tasks.length ? "无匹配任务" : "暂无任务", workspace.tasks.length ? "清除筛选后可查看全部任务。" : "", workspace.tasks.length ? '<button class="border" type="button" id="clear-task-filters">清除筛选</button>' : canEdit() ? '<a class="button border" href="#/tasks/new">新建任务</a>' : "", "assignment")}</div>`;
}
function attachTaskSearch() {
  const search = root.querySelector<HTMLInputElement>("#task-search")!;
  const filter = root.querySelector<HTMLSelectElement>("#incident-filter")!;
  const apply = () => {
    let visible = 0;
    root.querySelectorAll<HTMLElement>(".task-card").forEach((card) => {
      const id = card
        .querySelector<HTMLAnchorElement>("h2 a")!
        .hash.split("/")[2];
      const task = workspace.tasks.find((t) => t.id === id);
      const show =
        (card.dataset.search ?? "").includes(
          search.value.trim().toLowerCase(),
        ) &&
        (!filter.value || task?.incidentId === filter.value);
      card.hidden = !show;
      if (show) visible++;
    });
    root.querySelector<HTMLElement>("#task-empty")!.hidden = visible > 0;
  };
  search.addEventListener("input", apply);
  filter.addEventListener("change", apply);
  root.querySelector("#clear-task-filters")?.addEventListener("click", () => {
    search.value = "";
    filter.value = "";
    if (routeInfo().search) location.hash = "/tasks";
    else {
      apply();
      search.focus();
    }
  });
}
function taskDetail(task: OrganizerTask, tab: string) {
  const actions = canEdit()
    ? `<button class="border" data-action="duplicate" data-id="${task.id}">${icon("content_copy")}复制</button>${task.state !== "archived" ? `<a class="button" href="${taskLink(task)}/edit">${icon("edit")}编辑任务</a>` : ""}`
    : "";
  const tabs = [
    ["overview", "任务概览"],
    ["applications", `报名审核 · ${task.pending}`],
    ["accepted", `已通过报名 · ${task.accepted}`],
    ["activity", "操作记录"],
  ];
  const stateActions: Record<string, [string, string][]> = {
    draft: [["open", "发布招募"]],
    open: [
      ["paused", "暂停招募"],
      ["closed", "截止招募"],
    ],
    paused: [
      ["open", "恢复招募"],
      ["closed", "截止招募"],
    ],
    closed: [
      ["open", "重新开放"],
      ["archived", "归档任务"],
    ],
    archived: [],
  };
  const incident = workspace.incidents.find((i) => i.id === task.incidentId);
  const eventMap =
    !task.blocks.some((b) => b.type === "map") && incident
      ? mapPreview(incident.latitude, incident.longitude, "所属事件位置")
      : "";
  const body =
    tab === "activity"
      ? `<section class="panel"><p class="muted">仅显示工作空间最近 30 条操作中的相关记录。</p>${timeline(workspace.activities.filter((a) => a.taskId === task.id))}</section>`
      : `<div class="detail-grid"><section class="panel"><div class="panel-header"><h2>任务说明</h2>${badge(task.state)}</div><p class="muted">${h(task.summary)}</p><hr class="section-divider"><div class="description">${renderBlocks(task.blocks)}${eventMap}</div></section><aside><section class="panel"><h2 style="margin-bottom:20px">招募信息</h2>${taskProgress(task)}<hr class="section-divider"><dl class="definition-list">${[
          [
            "服务时间",
            `${formatDate(task.startsAt)} — ${formatDate(task.endsAt)}`,
          ],
          ["报名截止", formatDate(task.deadline)],
          ["服务地点", task.location || "未设置"],
          ["集合地点", task.meetingPoint || "由双方沟通确认"],
          ["任务负责人", task.ownerName],
          [
            "必需资料",
            task.requiredFields.map((f) => fieldLabels[f] || f).join("、") ||
              "未设置",
          ],
          [
            "通过后开放",
            task.contactFields.map((f) => fieldLabels[f] || f).join("、"),
          ],
        ]
          .map(
            ([label, value]) =>
              `<div><dt>${label}</dt><dd>${h(value)}</dd></div>`,
          )
          .join(
            "",
          )}</dl><p class="muted" style="font-size:.72rem;margin-top:18px">北京时间（UTC+8）</p></section>${canEdit() && stateActions[task.state].length ? `<section class="panel"><h2>招募状态</h2><div class="page-actions" style="margin-top:14px">${stateActions[task.state].map(([state, label]) => `<button class="border" data-action="task-state" data-id="${task.id}" data-state="${state}">${label}</button>`).join("")}</div></section>` : ""}</aside></div>`;
  return `${heading(task.title, task.incidentTitle, actions)}<div class="tabs" aria-label="任务页面">${tabs.map(([id, label]) => `<a class="${tab === id ? "active" : ""}" href="${id === "applications" ? applicationsLink(task.id) : id === "accepted" ? applicationsLink(task.id, "accepted") : `${taskLink(task)}?tab=${id}`}">${label}</a>`).join("")}</div>${body}`;
}
function applicationName(item: OrganizerApplication) {
  return (
    String(item.profile.realName || item.profile.username || "报名者") +
    (!item.profile.realName && !item.profile.username
      ? ` · ${item.id.slice(0, 6)}`
      : "")
  );
}
function profileValue(key: string, value: unknown): string {
  if (key === "vehicles" && value && typeof value === "object")
    return (
      Object.entries(value)
        .filter(([, n]) => Number(n) > 0)
        .map(([type, n]) => `${vehicleLabels[type] || type} ${h(n)} 辆`)
        .join("、") || "未提供车辆"
    );
  if (key === "skills" && Array.isArray(value))
    return (
      value
        .map(
          (item) =>
            `<span>${h(item.title)} <small>（${item.status === "verified" ? "平台标记已核验" : "已上传，未核验"}）</small></span>`,
        )
        .join("<br>") || "未填写"
    );
  if (value == null || value === "" || (Array.isArray(value) && !value.length))
    return '<span class="muted">未填写</span>';
  return h(typeof value === "object" ? JSON.stringify(value) : value);
}
function applicationDetail(item: OrganizerApplication, back: string) {
  const task = workspace.tasks.find((t) => t.id === item.taskId)!;
  return `<a class="mobile-only button border" href="${back}">${icon("arrow_back")}返回报名列表</a><div class="review-heading"><div><h2>${h(applicationName(item))}</h2><p>${h(item.taskTitle)}</p></div>${badge(item.status)}</div><details class="review-task-context"><summary>任务要求与安排</summary><p><a href="${taskLink(task)}">查看任务：${h(task.title)}</a></p><p>${h(task.summary)}</p><p>服务时间：${formatDate(task.startsAt, true)}${task.endsAt ? ` — ${formatDate(task.endsAt, true)}` : ""}</p><p>服务地点：${h(task.location || "未设置")}</p>${task.meetingPoint ? `<p>集合地点：${h(task.meetingPoint)}</p>` : ""}<div class="description">${renderBlocks(task.blocks)}</div></details><p class="muted" style="font-size:.8rem;margin-top:16px">提交时的授权资料 · ${formatDate(item.createdAt, true)}</p><dl class="profile-grid">${Object.entries(
    item.profile,
  )
    .filter(([key]) => fieldLabels[key])
    .map(
      ([key, value]) =>
        `<div class="profile-item ${["equipment", "skills", "body"].includes(key) ? "wide" : ""}"><dt>${fieldLabels[key]}</dt><dd>${profileValue(key, value)}</dd></div>`,
    )
    .join("")}</dl><hr class="section-divider"><h3>联系方式</h3>${
    item.contacts
      ? `<div class="contact-list">${Object.entries(item.contacts)
          .map(
            ([key, value]) =>
              `<div class="contact-row"><div><small>${fieldLabels[key] || h(key)}</small><strong>${h(value)}</strong></div><button class="transparent circle" data-action="copy" data-value="${h(value)}" aria-label="复制${fieldLabels[key] || h(key)}">${icon("content_copy")}</button></div>`,
          )
          .join(
            "",
          )}</div><p class="muted" style="font-size:.78rem;margin-top:12px">仅用于本任务沟通。</p>`
      : `<div class="info-note" style="margin-top:12px">${icon("lock")}<div>${item.status === "accepted" ? "无查看权限，请联系管理员。" : item.status === "pending" ? `通过后向获授权成员开放：${item.contactFields.map((f) => fieldLabels[f] || f).join("、")}。` : "本次报名未开放联系方式。"}</div></div>`
  }
  ${item.status === "pending" ? `<hr class="section-divider"><form id="review-form"><details id="review-fields"><summary>添加回应或内部备注（可选）</summary>${textarea("response", "给志愿者的回应", "", 'maxlength="1000"')}${textarea("note", "内部备注（不发送给志愿者）", item.note, 'maxlength="2000"')}</details><p class="help">已通过 ${task.accepted}${task.capacity ? ` / ${task.capacity}` : ""} 人${task.capacity ? "" : " · 不限人数"}</p><div class="review-actions"><button class="border" type="button" data-decision="rejected">不通过</button><button type="button" data-decision="accepted">${icon("check")}通过并通知</button></div></form>` : `<hr class="section-divider"><h3>审核结果</h3><p class="preserve-lines" style="margin-top:12px">${h(item.response || (item.status === "withdrawn" ? "志愿者已撤回本次报名。" : "暂无附加回应。"))}</p><p class="muted" style="font-size:.78rem;margin-top:12px">${item.reviewerName ? `${h(item.reviewerName)} · ` : ""}${formatDate(item.updatedAt, true)}</p>${item.note ? `<h3 style="margin-top:20px">内部备注</h3><p class="preserve-lines">${h(item.note)}</p>` : ""}`}`;
}
async function applicationsPage(params: URLSearchParams, turn: number) {
  const taskId = params.get("task") || "",
    status = params.get("status") || "pending";
  const pageNumber = Number.parseInt(params.get("page") || "1", 10) || 1;
  const searchTerm = params.get("q") || "";
  const page = await api<ApplicationPage>(
    `/applications?${new URLSearchParams({ ...(taskId ? { taskId } : {}), status, page: String(pageNumber), q: searchTerm })}`,
  );
  if (turn !== generation) return;
  const filtered = page.items;
  const explicitId = params.get("id");
  const selected =
    filtered.find((a) => a.id === explicitId) ??
    (explicitId
      ? { id: explicitId }
      : matchMedia("(min-width: 700px)").matches
        ? filtered[0]
        : undefined);
  const link = (
    nextStatus: string,
    id?: string,
    nextPage = nextStatus === status ? pageNumber : 1,
  ) =>
    `#/applications?${new URLSearchParams({ ...(taskId ? { task: taskId } : {}), status: nextStatus, page: String(nextPage), ...(searchTerm ? { q: searchTerm } : {}), ...(id ? { id } : {}) })}`;
  const task = workspace.tasks.find((t) => t.id === taskId);
  const result =
    reviewOutcome?.organization === currentOrg ? reviewOutcome : null;
  const outcome = result
    ? `<section class="review-outcome" role="status"><p>${h(result.name)}的报名${result.status === "accepted" ? "已通过" : "未通过"}，已发送站内通知。</p><div class="row wrap">${status === "pending" && filtered.length ? `<a class="button border" href="${link(status, filtered[0].id)}">审核下一份</a>` : ""}<a class="button border" href="${link(result.status, result.id, 1)}">查看审核结果</a></div></section>`
    : "";
  const selectedIndex = filtered.findIndex((item) => item.id === selected?.id);
  const navigation =
    selectedIndex < 0
      ? ""
      : `<nav class="review-navigation" aria-label="逐份审核">${selectedIndex > 0 ? `<a class="button border" data-review-step="previous" aria-keyshortcuts="Alt+ArrowUp" title="上一份（Alt + ↑）" href="${link(status, filtered[selectedIndex - 1].id)}">上一份</a>` : ""}${selectedIndex + 1 < filtered.length ? `<a class="button border" data-review-step="next" aria-keyshortcuts="Alt+ArrowDown" title="下一份（Alt + ↓）" href="${link(status, filtered[selectedIndex + 1].id)}">下一份</a>` : ""}</nav>`;
  const body = `${heading(status === "accepted" ? "已通过报名" : "报名审核", task ? task.title : "", '<button class="border" data-action="refresh">' + icon("refresh") + "刷新</button>")}${outcome}
  <form class="toolbar" id="application-filter">${select("application-task", "所属任务", [["", "全部任务"], ...workspace.tasks.map((t) => [t.id, t.title] as [string, string])], taskId)}<div class="field border round prefix search">${icon("search")}<input id="application-search" name="q" value="${h(searchTerm)}" type="search" placeholder="搜索姓名、昵称或地区" aria-label="搜索报名资料"></div><button class="border" type="submit">搜索</button></form>
  <div class="filter-chips" aria-label="报名状态">${["pending", "accepted", "rejected", "withdrawn", "all"].map((s) => `<a href="${link(s)}" class="${s === status ? "active" : ""}">${s === "all" ? "全部" : stateLabels[s as keyof typeof stateLabels]} <span>${s === "all" ? Object.values(page.counts).reduce((a, b) => a + b, 0) : page.counts[s as keyof typeof page.counts]}</span></a>`).join("")}</div>
  ${filtered.length || selected ? `<div class="review-layout ${explicitId && selected ? "has-selection" : ""}"><div class="application-list" aria-label="报名列表">${filtered.map((a) => `<a class="application-row ${a.id === selected?.id ? "active" : ""}" href="${link(status, a.id)}" data-search="${h(`${applicationName(a)} ${a.profile.region ?? ""}`.toLowerCase())}" ${a.id === selected?.id ? 'aria-current="true"' : ""}><div class="row"><strong>${h(applicationName(a))}</strong>${badge(a.status)}</div><p>${h(a.taskTitle)}</p><small>${formatDate(a.createdAt)} 提交</small></a>`).join("")}<p id="application-search-empty" hidden class="muted">没有匹配的报名资料。</p></div><section class="review-detail" aria-label="报名详情" id="review-detail">${selected ? '<p role="status">正在加载授权资料…</p>' : empty("选择报名查看资料", "", "", "person_search")}</section></div>` : empty("无匹配报名", "", "", "fact_check")}`;
  const pagination =
    page.total > page.pageSize || pageNumber > 1
      ? `<nav class="pagination" aria-label="报名分页">${pageNumber > 1 ? `<a class="button border" href="${link(status, undefined, pageNumber - 1)}">上一页</a>` : ""}<span>第 ${pageNumber} 页 · 共 ${page.total} 份</span>${pageNumber * page.pageSize < page.total ? `<a class="button border" href="${link(status, undefined, pageNumber + 1)}">下一页</a>` : ""}</nav>`
      : "";
  shell(body + pagination, "applications");
  root
    .querySelector<HTMLSelectElement>("#application-task")!
    .addEventListener("change", (event) => {
      location.hash = applicationsLink(
        (event.target as HTMLSelectElement).value,
        status,
      ).slice(1);
    });
  root
    .querySelector<HTMLFormElement>("#application-filter")!
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const term = root
        .querySelector<HTMLInputElement>("#application-search")!
        .value.trim();
      location.hash = `/applications?${new URLSearchParams({ ...(taskId ? { task: taskId } : {}), status, q: term })}`;
    });
  if (selected) {
    try {
      const item = await api<OrganizerApplication>(
        `/applications/${selected.id}`,
      );
      if (turn !== generation) return;
      root.querySelector("#review-detail")!.innerHTML =
        navigation + applicationDetail(item, link(status));
      const reviewForm = root.querySelector<HTMLFormElement>("#review-form");
      if (reviewForm) {
        const key = reviewDraftKey(item.id);
        const response =
          reviewForm.querySelector<HTMLTextAreaElement>("#response")!;
        const note = reviewForm.querySelector<HTMLTextAreaElement>("#note")!;
        const draft = reviewDrafts.get(key);
        if (draft)
          reviewForm.querySelector<HTMLDetailsElement>("#review-fields")!.open =
            true;
        response.value = draft?.response ?? "";
        note.value = draft?.note ?? item.note;
        const status = document.createElement("p");
        status.className = "help";
        status.setAttribute("role", "status");
        status.id = "review-draft-status";
        reviewForm.prepend(status);
        const update = () => {
          const changed = response.value !== "" || note.value !== item.note;
          if (changed)
            reviewDrafts.set(key, {
              response: response.value,
              note: note.value,
            });
          else reviewDrafts.delete(key);
          status.textContent = changed
            ? "未提交 · 切换报名会保留，刷新或退出后丢失"
            : "";
        };
        reviewForm.addEventListener("input", update);
        update();
      } else reviewDrafts.delete(reviewDraftKey(item.id));
      root
        .querySelectorAll<HTMLButtonElement>("[data-decision]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            decisionDialog(
              item,
              button.dataset.decision as "accepted" | "rejected",
            ),
          ),
        );
    } catch (error) {
      if (turn === generation)
        root.querySelector("#review-detail")!.innerHTML = empty(
          "资料加载失败",
          errorText(error),
          '<button data-action="refresh">重试</button>',
          "wifi_off",
        );
    }
  }
}
function decisionDialog(
  item: OrganizerApplication,
  status: "accepted" | "rejected",
) {
  const source = root.querySelector<HTMLFormElement>("#review-form")!;
  const response =
    (
      source.elements.namedItem("response") as HTMLTextAreaElement
    ).value.trim() ||
    (status === "accepted"
      ? "报名已通过。后续安排请直接联系组织者。"
      : "本次报名未通过。");
  const note = (source.elements.namedItem("note") as HTMLTextAreaElement).value;
  const dialog = openDialog(
    status === "accepted" ? "通过这份报名？" : "确认不通过这份报名？",
    `<form id="decision-form"><div class="dialog-copy"><p><strong>${h(applicationName(item))}</strong> · ${h(item.taskTitle)}</p><p>${status === "accepted" ? `占用 1 个名额，开放已授权的${item.contactFields.map((f) => fieldLabels[f] || f).join("、")}。` : "通知志愿者未通过，联系方式不开放。"}</p></div>${textarea("decision-response", "发送给志愿者的回应", response, 'required maxlength="1000"')}<div class="dialog-actions"><button class="border" type="button" data-close-dialog>再看一下</button><button type="submit">确认${status === "accepted" ? "通过" : "不通过"}并通知</button></div></form>`,
  );
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      await api(`/applications/${item.id}/decision`, "POST", {
        status,
        response: new FormData(form).get("decision-response"),
        note,
      });
      reviewDrafts.delete(reviewDraftKey(item.id));
      reviewOutcome = {
        id: item.id,
        name: applicationName(item),
        status,
        organization: currentOrg,
      };
      const route = routeInfo();
      if (route.searchParams.get("status") !== "all") {
        route.searchParams.delete("id");
        const currentPage = Number(route.searchParams.get("page") || 1);
        if (
          root.querySelectorAll(".application-row").length === 1 &&
          currentPage > 1
        )
          route.searchParams.set("page", String(currentPage - 1));
        history.replaceState(
          null,
          "",
          `#${route.pathname}?${route.searchParams}`,
        );
      }
      closeDialog();
      toast("已保存并发送站内通知。");
      await renderRoute();
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
}
function requestHistory(kind: "incident" | "verification") {
  const records = workspace.requests.filter((r) => r.kind === kind);
  if (!records.length) return "";
  const labels = { pending: "待处理", resolved: "已处理", rejected: "未通过" };
  return `<section class="panel" style="margin-top:24px"><h2>申请记录</h2>${records.map((r) => `<article class="notice"><div class="notice-body"><p class="preserve-lines">${h(r.content)}</p><small>${formatDate(r.createdAt, true)}</small></div><span class="status">${labels[r.status] || h(r.status)}</span></article>`).join("")}</section>`;
}
function incidentsPage() {
  return `${heading("事件协作", "", canEdit() ? '<button data-action="incident-request" class="border">' + icon("add_location_alt") + "新增事件 / 信息纠错</button>" : "")}<div class="incident-grid">${workspace.incidents
    .map((incident) => {
      const tasks = workspace.tasks.filter((t) => t.incidentId === incident.id);
      return `<section class="panel"><div class="incident-header">${icon("location_on")}<h2>${h(incident.title)}</h2><p>${h(incident.region)}</p></div>${mapPreview(incident.latitude, incident.longitude, incident.region)}<div class="panel-header"><h3>本组织关联任务 · ${tasks.length}</h3>${canEdit() ? `<a href="#/tasks/new?incident=${incident.id}">创建关联任务 ${icon("arrow_forward")}</a>` : ""}</div>${tasks.length ? tasks.map((t) => `<div class="task-row"><div class="task-info"><a href="${taskLink(t)}">${h(t.title)}</a></div>${badge(t.state)}</div>`).join("") : '<p class="muted">暂无关联任务。</p>'}</section>`;
    })
    .join("")}</div>${requestHistory("incident")}`;
}
async function noticesPage(turn: number) {
  const notices = await api<ResultNotice[]>("/notices");
  if (turn !== generation) return;
  shell(
    `${heading("通知记录", "最近 200 条 · 已读状态来自志愿者端", '<button class="border" data-action="refresh">' + icon("refresh") + "刷新</button>")}<section class="panel">${notices.length ? notices.map((n) => `<article class="notice"><div class="task-symbol">${icon("notifications_none")}</div><div class="notice-body"><h2>${h(n.title)}</h2><p>${h(n.taskTitle)} · ${h(n.body)}</p><small>${formatDate(n.createdAt, true)}</small></div><span class="status">${n.readAt ? "已读" : "未读"}</span></article>`).join("") : empty("暂无通知", "", "", "notifications_none")}</section>`,
    "notices",
  );
}
function settingsPage() {
  const org = workspace.organization;
  const contacts = (type: string) =>
    org.contacts.find((c) => c.type === type)?.value || "";
  return `${heading("组织设置")}
  <div class="settings-grid"><div><section class="panel"><div class="panel-header"><h2>组织公开资料</h2><span class="status ${org.verified ? "status-accepted" : "status-pending"}">${org.verified ? "已认证" : org.verificationStatus === "pending" ? "认证审核中" : "未认证"}</span></div><form id="organization-form"><fieldset ${!isAdmin() ? "disabled" : ""} style="border:0;padding:0;margin:0">${input("org-name", "组织名称", org.name, 'required maxlength="100"')}${textarea("org-description", "组织介绍", org.description, 'maxlength="2000"')}${input("org-phone", "公开联系电话", contacts("phone"), 'maxlength="150"', "tel")}${input("org-wechat", "公开微信", contacts("wechat"), 'maxlength="150"')}${input("org-email", "公开邮箱", contacts("email"), 'maxlength="150"', "email")}<p class="help">至少填写一种公开联系方式。</p>${isAdmin() ? '<button type="submit">保存组织资料</button>' : '<p class="muted">仅管理员可修改。</p>'}</fieldset></form></section>
  <section class="panel"><div class="panel-header"><h2>组织成员</h2>${isAdmin() ? '<button class="border" data-action="invite">' + icon("person_add") + "邀请成员</button>" : ""}</div>${workspace.members.map((member) => `<div class="member-row"><span class="avatar">${h(member.name.slice(0, 1))}</span><div class="member-info"><strong>${h(member.name)} ${member.id === workspace.membership.id ? "<small>（你）</small>" : ""}</strong><p>${roles[member.role]}${member.active ? "" : " · 已停用"}${member.email ? ` · ${h(member.email)}` : ""}</p><small>${member.role === "admin" ? "全部任务" : `${member.taskIds.length} 个指定任务`}${member.canViewContacts ? " · 可查看已通过报名的联系方式" : ""}</small></div>${isAdmin() ? `<button class="transparent circle" data-action="member" data-id="${member.id}" aria-label="编辑${h(member.name)}的权限">${icon("manage_accounts")}</button>` : ""}</div>`).join("")}</section></div><aside>${!org.verified ? `<section class="panel"><h2>组织认证</h2><p class="muted" style="font-size:.87rem;margin-top:14px">认证后可发布招募。</p>${isAdmin() ? '<button class="border" data-action="verification" style="margin-top:18px">提交认证资料</button>' : ""}</section>` : ""}<section class="panel" style="margin-top:24px"><h2>阅读与显示</h2><button class="border" data-action="appearance">外观设置</button></section>${isAdmin() ? requestHistory("verification") : ""}</aside></div>`;
}
function attachSettings() {
  const form = root.querySelector<HTMLFormElement>("#organization-form")!;
  const key = currentOrg;
  const read = () =>
    Object.fromEntries(
      Array.from(new FormData(form), ([name, value]) => [name, String(value)]),
    );
  const original = read();
  if (!isAdmin()) organizationDrafts.delete(key);
  const draft = organizationDrafts.get(key);
  if (draft)
    for (const [name, value] of Object.entries(draft)) {
      const field = form.elements.namedItem(name) as HTMLInputElement | null;
      if (field) field.value = value;
    }
  const status = document.createElement("p");
  status.className = "help";
  status.id = "organization-draft-status";
  status.setAttribute("role", "status");
  form.prepend(status);
  const update = () => {
    const values = read();
    const changed = Object.keys(original).some(
      (name) => original[name] !== values[name],
    );
    if (changed) organizationDrafts.set(key, values);
    else organizationDrafts.delete(key);
    status.textContent = changed
      ? "更改未保存 · 切换页面会保留，刷新或退出后丢失"
      : "";
  };
  form.addEventListener("input", update);
  update();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const contacts = [
      ["phone", "公开电话"],
      ["wechat", "微信"],
      ["email", "电子邮箱"],
    ]
      .map(([type, label]) => ({
        type,
        label,
        value: String(data.get(`org-${type}`) || "").trim(),
      }))
      .filter((c) => c.value);
    if (!contacts.length)
      return formError(form, "请至少填写一种公开联系方式。");
    setBusy(form, true);
    try {
      await api("/organization", "PUT", {
        name: data.get("org-name"),
        description: data.get("org-description"),
        contacts,
      });
      organizationDrafts.delete(key);
      toast("组织资料已保存。");
      await refreshSession();
      await renderRoute();
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
}
function permissionsFields(member?: Member) {
  return `${select("member-role", "成员角色", Object.entries(roles), member?.role || "reviewer")}
  <label class="checkbox"><input type="checkbox" name="member-contacts" ${member?.canViewContacts ? "checked" : ""}><span>允许查看已通过报名的授权联系方式</span></label><p class="help" style="margin:12px 0">管理员可管理全部任务；其他角色只访问下方分配的任务。</p><fieldset style="border:0;padding:0"><legend>分配任务</legend><div class="check-grid">${workspace.tasks.map((task) => `<label class="checkbox"><input type="checkbox" name="member-tasks" value="${task.id}" ${member?.taskIds.includes(task.id) ? "checked" : ""}><span>${h(task.title)}</span></label>`).join("")}</div></fieldset>${member ? `<label class="checkbox"><input type="checkbox" name="member-active" ${member.active ? "checked" : ""}><span>成员可以访问工作台</span></label>` : ""}`;
}
function memberDialog(member?: Member) {
  const dialog = openDialog(
    member ? `成员权限 · ${member.name}` : "邀请组织成员",
    `<form>${member ? "" : input("member-email", "受邀成员邮箱", "", 'required maxlength="254"', "email")}${permissionsFields(member)}<div class="dialog-actions"><button class="border" type="button" data-close-dialog>取消</button><button type="submit">${member ? "保存权限" : "生成邀请链接"}</button></div></form>`,
    true,
  );
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    const data = new FormData(form);
    const body = {
      role: data.get("member-role"),
      canViewContacts: data.has("member-contacts"),
      taskIds: data.getAll("member-tasks"),
      ...(member
        ? { active: data.has("member-active") }
        : { email: data.get("member-email") }),
    };
    try {
      if (member) {
        await api(`/members/${member.id}`, "PUT", body);
        closeDialog();
        toast("成员权限已更新。");
        await refreshSession();
        await renderRoute();
      } else {
        const invite = await api<{ url: string }>("/invitations", "POST", body);
        openDialog(
          "邀请链接已生成",
          `<p class="dialog-copy">请自行转交给受邀成员。48 小时有效，仅限使用一次。</p>${textarea("invitation-link", "邀请链接", invite.url, "readonly")}<div class="dialog-actions"><button class="border" data-close-dialog>完成</button><button id="copy-invite">${icon("content_copy")}复制邀请链接</button></div>`,
        )
          .querySelector("#copy-invite")!
          .addEventListener("click", () => {
            void copyText(invite.url);
          });
      }
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
}
function requestDialog(kind: "incident" | "verification") {
  const dialog = openDialog(
    kind === "incident" ? "新增事件 / 信息纠错" : "提交组织认证",
    `<form><p class="dialog-copy">${kind === "incident" ? "填写事件名称、地区、需求及来源；纠错请注明对应事件。" : "填写机构登记信息、公开链接及联系人。"}</p>${textarea("request-content", "申请说明", "", 'required minlength="10" maxlength="5000"')}<div class="dialog-actions"><button class="border" type="button" data-close-dialog>取消</button><button type="submit">提交申请</button></div></form>`,
  );
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      await api("/requests", "POST", {
        kind,
        content: new FormData(form).get("request-content"),
      });
      closeDialog();
      toast(
        workspace.organization.demo
          ? "申请已保存到演示空间。"
          : "申请已提交，等待平台处理。",
      );
      await renderRoute();
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
}
function taskStateDialog(task: OrganizerTask, state: string) {
  const labels: Record<string, string> = {
    open: "开放招募",
    paused: "暂停招募",
    closed: "截止招募",
    archived: "归档任务",
  };
  const description: Record<string, string> = {
    open: workspace.organization.demo
      ? "仅在演示空间发布。"
      : "公开任务并接收报名。",
    paused: "暂停新报名，已有报名仍可审核。",
    closed: "停止新报名，已有报名仍可审核。",
    archived: "从公开列表移除，保留历史报名和操作记录。",
  };
  const dialog = openDialog(
    `${labels[state]}？`,
    `<form><p class="dialog-copy"><strong>${h(task.title)}</strong><br>${description[state]}</p><div class="dialog-actions"><button class="border" type="button" data-close-dialog>取消</button><button type="submit">确认${labels[state]}</button></div></form>`,
  );
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      await api(`/tasks/${task.id}/state`, "POST", {
        state,
        version: task.version,
      });
      closeDialog();
      toast(`已${labels[state]}。`);
      await renderRoute();
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
}
function appearanceDialog() {
  const settings = preferences();
  const dialog = openDialog(
    "外观与阅读",
    `${select(
      "theme",
      "主题",
      [
        ["system", "跟随系统"],
        ["light", "浅色"],
        ["dark", "深色"],
      ],
      settings.theme,
    )}${select(
      "text-size",
      "文字大小",
      [
        ["normal", "标准字号"],
        ["large", "更大字号"],
      ],
      settings.text,
    )}<div class="dialog-actions"><button data-close-dialog>完成</button></div>`,
  );
  const apply = () =>
    applyPreferences(
      dialog.querySelector<HTMLSelectElement>("#theme")!.value,
      dialog.querySelector<HTMLSelectElement>("#text-size")!.value,
    );
  dialog
    .querySelectorAll("select")
    .forEach((element) => element.addEventListener("change", apply));
}
async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制。");
  } catch {
    const dialog = openDialog(
      "复制内容",
      `${textarea("copy-value", "内容", value, "readonly")}<p class="muted">请选中后手动复制。</p><div class="dialog-actions"><button data-close-dialog>完成</button></div>`,
    );
    dialog.querySelector("textarea")!.select();
  }
}
root.addEventListener("keydown", (event) => {
  if (
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !["ArrowUp", "ArrowDown"].includes(event.key) ||
    document.querySelector("dialog[open]") ||
    (event.target as Element).closest(
      "input, textarea, select, [contenteditable]",
    )
  )
    return;
  const link = root.querySelector<HTMLAnchorElement>(
    `[data-review-step="${event.key === "ArrowUp" ? "previous" : "next"}"]`,
  );
  if (link) {
    event.preventDefault();
    link.click();
  }
});
root.addEventListener("click", (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    "[data-action]",
  );
  if (!target) return;
  const task = workspace?.tasks.find((t) => t.id === target.dataset.id);
  switch (target.dataset.action) {
    case "refresh":
      void renderRoute();
      break;
    case "login-help":
      openDialog(
        "账号帮助",
        '<p class="dialog-copy">账号由组织管理员邀请开通。忘记密码请联系平台运营人员。</p><div class="dialog-actions"><button data-close-dialog>关闭</button></div>',
      );
      break;
    case "appearance":
      appearanceDialog();
      break;
    case "copy":
      void copyText(target.dataset.value || "");
      break;
    case "task-state":
      if (task) taskStateDialog(task, target.dataset.state!);
      break;
    case "duplicate":
      if (task) location.hash = `/tasks/new?copy=${task.id}`;
      break;
    case "invite":
      memberDialog();
      break;
    case "member":
      memberDialog(workspace.members.find((m) => m.id === target.dataset.id));
      break;
    case "incident-request":
      requestDialog("incident");
      break;
    case "verification":
      requestDialog("verification");
      break;
    case "more": {
      const dialog = openDialog(
        "更多功能",
        `<nav class="side-links">${destinations
          .slice(3)
          .map(
            ([id, symbol, label]) =>
              `<a class="side-link" style="width:auto;justify-content:flex-start" href="#/${id}">${icon(symbol)}${label}</a>`,
          )
          .join("")}</nav>`,
      );
      dialog
        .querySelectorAll("a")
        .forEach((a) => a.addEventListener("click", closeDialog));
      break;
    }
    case "account": {
      const dialog = openDialog(
        "当前账号",
        `<p><strong>${h(session!.account.name)}</strong></p><p class="muted">${workspace.organization.demo ? "演示账号" : h(session!.account.email)}</p><p style="margin-top:12px">${roles[workspace.membership.role]}</p><div class="dialog-actions"><button class="border" data-close-dialog>返回工作台</button><button id="logout">退出登录</button></div>`,
      );
      dialog.querySelector("#logout")!.addEventListener("click", async () => {
        try {
          if (editor?.dirty() && !(await editor.flush())) {
            closeDialog();
            return;
          }
          if (!(await confirmDiscardDrafts())) return;
          await api("/auth/logout", "POST", {});
          reviewDrafts.clear();
          organizationDrafts.clear();
          closeDialog();
          editor?.dispose();
          editor = null;
          history.replaceState(null, "", "#/login");
          location.reload();
        } catch (error) {
          toast(errorText(error));
        }
      });
      break;
    }
  }
});
async function refreshSession() {
  session = await api<Session>("/auth/session");
  if (!session.memberships.some((m) => m.organizationId === currentOrg))
    currentOrg = session.memberships[0]?.organizationId || "";
  setOrganization(currentOrg);
}
async function showLogin() {
  reviewDrafts.clear();
  organizationDrafts.clear();
  const joinToken = routeInfo().pathname.match(/^\/join\/([^/]+)$/)?.[1];
  let demo = false;
  try {
    demo = (await api<{ demo: boolean }>("/auth/config")).demo;
  } catch {
    /* Login stays available when config cannot load. */
  }
  root.innerHTML = `<div class="login-layout"><div class="login-brand"><a href="#/login" aria-label="FireLink">FireLink</a></div><main id="main" class="login-main"><h1>${joinToken ? "加入组织" : "组织者登录"}</h1>${joinToken ? "<p>已有账号请使用原密码。</p>" : ""}<form id="login-form">${joinToken ? input("name", "你的姓名", "", 'required maxlength="60" autocomplete="name"') : input("email", "登录邮箱", "", 'required autocomplete="username"', "email")}${input("password", joinToken ? "密码（至少 12 个字符）" : "密码", "", `required ${joinToken ? 'minlength="12" autocomplete="new-password"' : 'autocomplete="current-password"'} maxlength="200"`, "password")}<button type="submit" class="full">${joinToken ? "接受邀请并进入" : "登录工作台"}</button></form>${demo && !joinToken ? '<button id="demo-login" class="border full">进入演示工作台</button>' : ""}<div class="login-tools"><button class="transparent" data-action="login-help">账号帮助</button><button class="transparent circle" data-action="appearance" aria-label="外观与阅读设置">${icon("contrast")}</button></div></main></div>`;
  document.title = "登录 · FireLink 组织者工作台";
  const form = root.querySelector<HTMLFormElement>("#login-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(form, true);
    const data = new FormData(form);
    try {
      await api(
        `/auth/${joinToken ? "join" : "login"}`,
        "POST",
        joinToken
          ? {
              token: joinToken,
              name: data.get("name"),
              password: data.get("password"),
            }
          : { email: data.get("email"), password: data.get("password") },
      );
      await refreshSession();
      history.replaceState(null, "", "#/dashboard");
      await renderRoute();
    } catch (error) {
      formError(form, errorText(error));
    } finally {
      setBusy(form, false);
    }
  });
  root
    .querySelector<HTMLButtonElement>("#demo-login")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "正在进入…";
      try {
        const result = await api<{ organizationId: string }>(
          "/auth/demo",
          "POST",
          {},
        );
        currentOrg = result.organizationId;
        await refreshSession();
        history.replaceState(null, "", "#/dashboard");
        await renderRoute();
      } catch (error) {
        formError(form, errorText(error));
        button.disabled = false;
        button.textContent = "重新进入演示工作台";
      }
    });
}
async function renderRoute() {
  const turn = ++generation;
  editor?.dispose();
  editor = null;
  const route = routeInfo();
  if (route.pathname !== "/applications") reviewOutcome = null;
  if (route.pathname.startsWith("/join/")) return showLogin();
  if (!session) {
    try {
      await refreshSession();
    } catch (error) {
      if (error instanceof APIError && error.status === 401) return showLogin();
      root.innerHTML = `<main class="boot" id="main">${empty("暂时无法连接工作台", errorText(error), '<button data-action="refresh">重新连接</button>', "wifi_off")}</main>`;
      return;
    }
  }
  if (!currentOrg) {
    root.innerHTML = `<main class="boot" id="main">${empty("当前没有可访问的组织", "请使用组织邀请链接，或退出后重新进入演示。", '<button id="leave-empty-session">退出登录</button>')}</main>`;
    root
      .querySelector("#leave-empty-session")!
      .addEventListener("click", async () => {
        await api("/auth/logout", "POST", {});
        history.replaceState(null, "", "#/login");
        location.reload();
      });
    return;
  }
  try {
    const data = await api<Workspace>("/workspace");
    if (turn !== generation) return;
    workspace = data;
    const path = route.pathname;
    if (path === "/applications")
      await applicationsPage(route.searchParams, turn);
    else if (path === "/notices") await noticesPage(turn);
    else if (path === "/tasks/new" || /^\/tasks\/[^/]+\/edit$/.test(path)) {
      if (!canEdit()) {
        shell(
          empty("没有编辑权限", "请联系组织管理员分配任务编辑权限。"),
          "tasks",
        );
        return;
      }
      const task = workspace.tasks.find((t) => t.id === path.split("/")[2]);
      const copy = workspace.tasks.find(
        (t) => t.id === route.searchParams.get("copy"),
      );
      if (path !== "/tasks/new" && !task) {
        shell(
          empty("任务不存在", "任务可能已移除，或你没有访问权限。"),
          "tasks",
        );
        return;
      }
      shell(
        heading(
          task ? "编辑任务" : "新建任务",
          "",
          '<a class="button border" href="#/tasks">' +
            icon("arrow_back") +
            "返回任务</a>",
        ) + '<div id="editor"></div>',
        "tasks",
      );
      editor = mountEditor(
        root.querySelector("#editor")!,
        workspace,
        task,
        copy,
        route.searchParams.get("incident") || "",
      );
    } else if (/^\/tasks\/[^/]+$/.test(path)) {
      const task = workspace.tasks.find((t) => t.id === path.split("/")[2]);
      shell(
        task
          ? taskDetail(task, route.searchParams.get("tab") || "overview")
          : empty("任务不存在", "任务可能已移除，或你没有访问权限。"),
        "tasks",
      );
    } else if (path === "/tasks") {
      shell(tasksPage(route.searchParams), "tasks");
      attachTaskSearch();
    } else if (path === "/incidents") shell(incidentsPage(), "incidents");
    else if (path === "/settings") {
      shell(settingsPage(), "settings");
      attachSettings();
    } else shell(dashboard(), "dashboard");
    if (turn === generation) {
      root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  } catch (error) {
    if (turn !== generation) return;
    if (error instanceof APIError && error.status === 401) {
      session = null;
      return showLogin();
    }
    if (workspace)
      shell(
        empty(
          "暂时无法打开此页面",
          errorText(error),
          '<button data-action="refresh">重试</button>',
          "wifi_off",
        ),
        "dashboard",
      );
    else
      root.innerHTML = `<main class="boot" id="main">${empty("无法打开工作台", errorText(error), '<button data-action="refresh">重试</button>', "wifi_off")}</main>`;
  }
}
applyPreferences();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
  applyPreferences(),
);
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  const main = document.querySelector<HTMLElement>("#main");
  if (main) {
    main.tabIndex = -1;
    main.focus();
  }
});
const connection = document.querySelector<HTMLElement>("#connection")!;
function updateConnection() {
  connection.hidden = navigator.onLine;
  if (navigator.onLine) toast("网络已恢复。");
}
window.addEventListener("offline", updateConnection);
window.addEventListener("online", updateConnection);
connection.hidden = navigator.onLine;
window.addEventListener("hashchange", async (event) => {
  if (editor?.dirty()) {
    const destination = new URL(event.newURL).hash;
    history.replaceState(null, "", new URL(event.oldURL).hash);
    if (!(await editor.flush())) {
      const dialog = openDialog(
        "有尚未保存的内容",
        '<p class="dialog-copy">离开将丢失未保存的修改。</p><div class="dialog-actions"><button class="border" data-close-dialog>继续编辑</button><button id="discard-editor">放弃修改并离开</button></div>',
      );
      dialog.querySelector("#discard-editor")!.addEventListener("click", () => {
        editor?.dispose();
        editor = null;
        closeDialog();
        history.replaceState(null, "", destination);
        void renderRoute();
      });
      return;
    }
    history.replaceState(null, "", destination);
  }
  void renderRoute();
});
window.addEventListener("beforeunload", (event) => {
  if (editor?.dirty() || reviewDrafts.size || organizationDrafts.size)
    event.preventDefault();
});
void renderRoute();
