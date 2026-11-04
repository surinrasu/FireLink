import type {
  ContentBlock,
  MapAnnotation,
  OrganizerTask,
  TaskInput,
  Workspace,
} from "../../shared/organizer";
import { api, uploadMedia } from "./api";
import { mediaTypes } from "../../shared/media";
import { mapPreview, updatePreview } from "./maps";
import { completeMap, mapAnnotations } from "../../shared/maps";
import { openTaskPicker, type TaskChoice } from "./task-picker";
import {
  closeDialog,
  errorText,
  fieldLabels,
  formError,
  h,
  icon,
  input,
  openDialog,
  renderBlocks,
  textarea,
  toast,
} from "./ui";

export interface EditorHandle {
  dispose(): void;
  dirty(): boolean;
  flush(): Promise<boolean>;
}
const beijingInput = (value: string) =>
  value
    ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)
    : "";
const utcInput = (value: string) =>
  value ? new Date(`${value}:00+08:00`).toISOString() : "";
const blockNames = {
  heading: "小标题",
  paragraph: "文本",
  image: "图片",
  video: "视频",
  table: "表格",
  map: "地图",
};

export function mountEditor(
  host: HTMLElement,
  workspace: Workspace,
  status: HTMLElement,
  task?: OrganizerTask,
  copy?: OrganizerTask,
  incidentId = "",
): EditorHandle {
  const source = task || copy;
  const now = Date.now();
  const minute = 60 * 1000;
  const quarterHour = 15 * minute;
  const hour = 60 * minute;
  const times = task || {
    startsAt: new Date(
      Math.ceil((now + quarterHour) / quarterHour) * quarterHour,
    ).toISOString(),
    deadline: new Date(now + 10 * minute).toISOString(),
    endsAt: new Date(Math.ceil((now + 12 * hour) / hour) * hour).toISOString(),
  };
  let id = task?.id;
  let version = task?.version ?? 1;
  let disposed = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout>;
  let saving: Promise<void> | null = null;
  let revision = 0;
  let autoSaveStopped = false;
  const uploads = new Map<
    ContentBlock,
    {
      controller: AbortController;
      pending: boolean;
      progress: number;
      error: string;
    }
  >();
  let blocks: ContentBlock[] = structuredClone(
    source?.blocks || [
      { type: "heading", text: "我们需要这样的帮助" },
      { type: "paragraph", text: "" },
    ],
  );
  const draft = !task || task.state === "draft";
  status.id = "save-status";
  status.setAttribute("role", "status");
  status.textContent = draft
    ? "自动保存已启用"
    : "已发布任务的更改需要手动保存";
  const requirementsLocked =
    !!task &&
    task.pending +
      task.accepted +
      task.rejected +
      task.withdrawn +
      task.expired >
      0;
  const fields = source?.requiredFields || ["realName", "region"];
  const contacts = source?.contactFields || ["phone"];
  const requirementOptions = (
    name: string,
    keys: string[],
    selected: string[],
  ) =>
    keys
      .map(
        (key) =>
          `<label class="requirement-option"><input class="sr-only" type="checkbox" name="${name}" value="${key}" ${selected.includes(key) ? "checked" : ""} ${requirementsLocked ? "disabled" : ""}><span class="multi-select-option">${fieldLabels[key]}</span></label>`,
      )
      .join("");
  const fieldGroups: [string, string[]][] = [
    ["身份信息", ["realName", "age", "gender"]],
    ["个人情况", ["username", "pronouns", "region", "body"]],
    ["资质与资源", ["equipment", "vehicles", "skills"]],
  ];
  const requirements = fieldGroups
    .map(
      ([label, keys], index) =>
        `<div class="requirement-group" role="group" aria-labelledby="requirement-label-${index}"><span id="requirement-label-${index}" class="requirement-label">${label}</span><div class="requirement-options">${requirementOptions("requiredFields", keys, fields)}</div></div>`,
    )
    .join("");
  const incidentChoices: TaskChoice[] = workspace.incidents.map((incident) => ({
    id: incident.id,
    title: incident.title,
    detail: incident.region,
  }));
  const ownerChoices: TaskChoice[] = workspace.members
    .filter((member) => member.active && member.role !== "reviewer")
    .map((member) => ({
      id: member.id,
      title: member.name,
      detail: member.email,
    }));
  const selectedIncident = incidentChoices.find(
    (choice) => choice.id === (incidentId || source?.incidentId),
  );
  const selectedOwner =
    ownerChoices.find(
      (choice) => choice.id === (source?.ownerId || workspace.membership.id),
    ) || ownerChoices[0];
  const pickerButton = (
    name: string,
    label: string,
    symbol: string,
    choice?: TaskChoice,
  ) =>
    `<input type="hidden" id="${name}" name="${name}" value="${h(choice?.id || "")}"><button class="border editor-picker-button" type="button" id="${name}-picker" aria-haspopup="dialog">${icon(symbol)}<span id="${name}-selection" class="editor-picker-value">${h(choice?.title || `待选择${label}`)}</span></button>`;
  host.innerHTML = `<form id="task-form"><div class="editor-layout"><div>
    <section class="panel editor-section"><h2><span class="step-number">1</span>基本信息</h2>${input("title", "任务标题", copy ? `${copy.title}（副本）` : task?.title || "", 'required maxlength="100"')}<div class="task-summary"><label for="summary">工作内容与能力要求摘要</label><div class="field textarea border"><textarea id="summary" name="summary" maxlength="500" rows="3">${h(source?.summary || "")}</textarea></div></div>
    </section>
    <details class="panel editor-section" id="task-schedule"><summary class="editor-section-toggle"><h2><span class="step-number">2</span>时间 地点及人数</h2>${icon("expand_more")}</summary><p class="muted" style="font-size:.8rem;margin-top:12px">北京时间（UTC+8）</p><div class="form-grid">${input("startsAt", "任务开始时间", beijingInput(times.startsAt), "", "datetime-local")}${input("endsAt", "任务结束时间", beijingInput(times.endsAt), "", "datetime-local")}${input("deadline", "报名截止时间", beijingInput(times.deadline), "", "datetime-local")}${input("capacity", "人数上限", source?.capacity?.toString() || "", 'min="1" max="10000" step="1"', "number")}</div>${input("location", "地点描述", source?.location || "", 'maxlength="300"')}</details>
    <details class="panel editor-section" id="task-details"><summary class="editor-section-toggle"><h2><span class="step-number">3</span>详细信息</h2>${icon("expand_more")}</summary><div class="block-history" role="group" aria-label="内容编辑历史"><button class="border" type="button" id="undo-block" disabled>${icon("undo")}撤销</button><button class="border" type="button" id="redo-block" disabled>${icon("redo")}重做</button></div><div id="blocks"></div><div class="block-add-actions" role="group" aria-label="添加内容">${Object.entries(
      blockNames,
    )
      .map(
        ([type, label]) =>
          `<button class="border" type="button" data-add-block="${type}" aria-label="添加${label}">${icon("add")}${label}</button>`,
      )
      .join("")}</div></details>
    <section class="panel editor-section"><h2><span class="step-number">4</span>志愿者上传资料</h2>${requirementsLocked ? '<div class="info-note" style="margin-top:14px">已有报名，授权要求不可修改。如需更改，请复制为新任务。</div>' : ""}<fieldset id="required-fields" tabindex="-1" style="border:0;padding:0;margin-top:20px"><legend>报名必填资料</legend>${requirements}<div id="contact-fields" class="requirement-group" role="group" aria-labelledby="contact-fields-label" tabindex="-1"><span id="contact-fields-label" class="requirement-label">联系方式</span><div class="requirement-options">${requirementOptions("contactFields", ["phone", "wechat", "email"], contacts)}</div></div></fieldset></section>
    </div><aside class="editor-preview"><p class="preview-label">志愿者端内容预览</p><div class="preview-phone" id="live-preview"></div></aside></div>
    <footer class="editor-footer"><div class="editor-pickers" role="group" aria-label="任务事件与负责人">${pickerButton("incidentId", "事件", "explore", selectedIncident)}${pickerButton("ownerId", "负责人", "person", selectedOwner)}</div><div class="actions"><button class="border" type="button" id="preview-task">${icon("visibility")}预览</button><button class="border" type="submit">保存${draft ? "草稿" : "更改"}</button>${draft ? '<button type="button" id="publish-task">发布招募</button>' : ""}</div></footer></form>`;
  const form = host.querySelector<HTMLFormElement>("#task-form")!;
  let pickerDialog: HTMLDialogElement | undefined;
  const bindPicker = (
    name: string,
    label: string,
    placeholder: string,
    choices: TaskChoice[],
  ) => {
    const field = form.elements.namedItem(name) as HTMLInputElement;
    const button = form.querySelector<HTMLButtonElement>(`#${name}-picker`)!;
    button.addEventListener("click", () => {
      pickerDialog = openTaskPicker(
        label,
        placeholder,
        choices,
        field.value,
        (choice) => {
          if (choice.id === field.value) return;
          field.value = choice.id;
          form.querySelector(`#${name}-selection`)!.textContent = choice.title;
          button.removeAttribute("aria-invalid");
          field.dispatchEvent(new Event("change", { bubbles: true }));
        },
      );
      pickerDialog.addEventListener(
        "close",
        () => {
          pickerDialog = undefined;
        },
        { once: true },
      );
    });
  };
  bindPicker("incidentId", "事件", "搜索事件名称或地区", incidentChoices);
  bindPicker("ownerId", "负责人", "搜索姓名或邮箱", ownerChoices);
  form.addEventListener(
    "invalid",
    (event) => {
      const section = (event.target as HTMLElement).closest<HTMLDetailsElement>(
        "details.editor-section",
      );
      if (section) section.open = true;
    },
    true,
  );
  const footer = form.querySelector<HTMLElement>(".editor-footer")!;
  let focusFrame = 0;
  const revealFocus = () => {
    cancelAnimationFrame(focusFrame);
    // Native focus scrolling does not account for the sticky action bar.
    focusFrame = requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (
        disposed ||
        !(focused instanceof HTMLElement) ||
        !form.contains(focused) ||
        footer.contains(focused)
      )
        return;
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + 12;
      const bottom =
        Math.min(
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
          footer.getBoundingClientRect().top,
        ) - 12;
      const bounds = (
        focused.closest(".field") || focused
      ).getBoundingClientRect();
      const delta =
        bounds.top < top || bounds.height > bottom - top
          ? bounds.top - top
          : Math.max(0, bounds.bottom - bottom);
      if (delta) window.scrollBy({ top: delta, behavior: "instant" });
    });
  };
  const footerResize = new ResizeObserver(revealFocus);
  footerResize.observe(footer);
  form.addEventListener("focusin", revealFocus);
  window.addEventListener("resize", revealFocus);
  window.visualViewport?.addEventListener("resize", revealFocus);
  const blockHost = host.querySelector<HTMLElement>("#blocks")!;
  const undoButton = host.querySelector<HTMLButtonElement>("#undo-block")!;
  const redoButton = host.querySelector<HTMLButtonElement>("#redo-block")!;
  // Keep block identities so unrelated uploads survive a history change.
  const snapshot = () =>
    blocks.map((block) => ({ block, content: structuredClone(block) }));
  type BlockSnapshot = ReturnType<typeof snapshot>;
  const past: BlockSnapshot[] = [];
  const future: BlockSnapshot[] = [];
  let current: BlockSnapshot;
  let editGroup: EventTarget | null = null;
  function updateHistoryButtons() {
    undoButton.disabled = !past.length;
    redoButton.disabled = !future.length;
  }
  function recordBlocks(event?: Event) {
    const next = snapshot();
    const group = event?.type === "input" ? event.target : null;
    if (
      JSON.stringify(next.map((entry) => entry.content)) !==
      JSON.stringify(current.map((entry) => entry.content))
    ) {
      if (!group || group !== editGroup) {
        past.push(current);
        if (past.length > 100) past.shift();
      }
      current = next;
      future.length = 0;
    }
    editGroup = group;
    updateHistoryButtons();
  }
  function restoreBlocks(from: BlockSnapshot[], to: BlockSnapshot[]) {
    const restored = from.pop();
    if (!restored) return;
    to.push(current);
    for (const block of blocks) {
      if (restored.some((entry) => entry.block === block)) continue;
      uploads.get(block)?.controller.abort();
      uploads.delete(block);
    }
    blocks = restored.map(({ block, content }) => {
      for (const key of Object.keys(block) as (keyof ContentBlock)[])
        delete block[key];
      Object.assign(block, structuredClone(content));
      return block;
    });
    current = restored;
    editGroup = null;
    drawBlocks();
    changed();
    // Keep keyboard focus in the history controls when one becomes disabled.
    (from.length
      ? from === past
        ? undoButton
        : redoButton
      : from === past
        ? redoButton
        : undoButton
    ).focus();
  }
  undoButton.addEventListener("click", () => restoreBlocks(past, future));
  redoButton.addEventListener("click", () => restoreBlocks(future, past));
  const publishButton = host.querySelector<HTMLButtonElement>("#publish-task");
  let deadlineTimer: ReturnType<typeof setTimeout>;
  for (const name of ["title", "summary", "startsAt", "deadline"]) {
    const field = form.elements.namedItem(name) as HTMLInputElement;
    const label = form.querySelector<HTMLLabelElement>(`label[for="${name}"]`)!;
    field.setAttribute("aria-label", label.textContent || "");
    label.insertAdjacentHTML("beforeend", ' <span aria-hidden="true">*</span>');
  }
  type PublishCheck = { field: string; message: string; complete: boolean };
  function publicationChecks(): PublishCheck[] {
    const checks: PublishCheck[] = [];
    const check = (field: string, complete: boolean, message: string) =>
      checks.push({ field, complete, message });
    const invalidate = (field: string, message: string) => {
      const existing = checks.find((item) => item.field === field);
      if (existing) {
        if (!existing.complete) return;
        existing.complete = false;
        existing.message = message;
      } else check(field, false, message);
    };
    const required = {
      title: "任务标题",
      summary: "工作内容与能力要求摘要",
      startsAt: "任务开始时间",
      deadline: "报名截止时间",
    };
    for (const [field, label] of Object.entries(required))
      check(field, !!value(field).trim(), `请填写${label}`);
    check("incidentId", !!value("incidentId").trim(), "请选择事件");
    check("ownerId", !!value("ownerId").trim(), "请选择负责人");
    for (const field of ["endsAt", "capacity"])
      if (value(field)) check(field, true, "");
    if (
      value("deadline") &&
      Date.parse(`${value("deadline")}:00+08:00`) <= Date.now()
    )
      invalidate("deadline", "报名截止时间须晚于当前时间");
    if (
      value("deadline") &&
      value("endsAt") &&
      value("deadline") > value("endsAt")
    )
      invalidate("deadline", "报名截止时间不能晚于任务结束时间");
    if (
      value("endsAt") &&
      value("startsAt") &&
      value("endsAt") <= value("startsAt")
    )
      invalidate("endsAt", "任务结束时间须晚于任务开始时间");
    check(
      "required-fields",
      !!form.querySelector('[name="requiredFields"]:checked'),
      "请至少选择一项报名必填资料",
    );
    check(
      "contact-fields",
      !!form.querySelector('[name="contactFields"]:checked'),
      "请至少选择一种联系方式",
    );
    blocks.forEach((block, index) => {
      if (block.type === "image" || block.type === "video")
        check(
          `block-file-${index}`,
          !!block.url &&
            !uploads.get(block)?.pending &&
            !uploads.get(block)?.error,
          `请完成第 ${index + 1} 段${blockNames[block.type]}上传，或删除该内容块`,
        );
      if (block.type === "map")
        check(
          `block-map-${index}`,
          completeMap(block),
          `请完成第 ${index + 1} 段地图标注：位置至少 1 个点，路径 2 个不同点，范围 3 个不共线的点`,
        );
    });
    check(
      "organization-verified",
      workspace.organization.verified,
      "请先完成组织认证",
    );
    check(
      "organization-contacts",
      !!workspace.organization.contacts.length,
      "请在组织设置中填写至少一种公开联系方式",
    );
    for (const field of form.querySelectorAll<HTMLInputElement>(
      "input:invalid, select:invalid, textarea:invalid",
    )) {
      invalidate(
        field.id,
        field.id === "capacity"
          ? "人数上限须为 1 至 10000 的整数"
          : `请检查${field.getAttribute("aria-label") || form.querySelector(`label[for="${field.id}"]`)?.textContent || "此项内容"}`,
      );
    }
    return checks;
  }
  function updateReadiness() {
    if (!publishButton) return;
    const checks = publicationChecks();
    const issues = checks.filter((item) => !item.complete);
    const counted = checks.filter(
      (item) => item.field !== "incidentId" && item.field !== "ownerId",
    );
    publishButton.disabled = issues.length > 0;
    publishButton.textContent = issues.length
      ? `发布招募 (${counted.filter((item) => item.complete).length}/${counted.length})`
      : "发布招募";
    publishButton.title = issues.map((issue) => issue.message).join("\n");
    clearTimeout(deadlineTimer);
    const untilDeadline =
      Date.parse(`${value("deadline")}:00+08:00`) - Date.now();
    if (untilDeadline > 0)
      deadlineTimer = setTimeout(
        updateReadiness,
        Math.min(untilDeadline + 1, 2147483647),
      );
    form.querySelectorAll(".field-error").forEach((e) => e.remove());
    form.querySelectorAll('[aria-invalid="true"]').forEach((e) => {
      e.removeAttribute("aria-invalid");
      const described = (e.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter((id) => !id.endsWith("-publish-error"))
        .join(" ");
      if (described) e.setAttribute("aria-describedby", described);
      else e.removeAttribute("aria-describedby");
    });
    for (const issue of issues) {
      const field = form.querySelector<HTMLElement>(`#${issue.field}`);
      if (
        !field ||
        !value(issue.field).trim() ||
        field.hasAttribute("aria-invalid")
      )
        continue;
      field.setAttribute("aria-invalid", "true");
      const error = document.createElement("p");
      error.className = "field-error";
      error.id = `${issue.field}-publish-error`;
      error.textContent = issue.message;
      field.setAttribute(
        "aria-describedby",
        `${field.getAttribute("aria-describedby") || ""} ${error.id}`.trim(),
      );
      (field.closest(".field") || field).after(error);
    }
  }
  const value = (name: string) => String(new FormData(form).get(name) || "");
  function readBlocks() {
    blocks = blocks.map((block, index) => {
      const result = block;
      result.text = value(`block-text-${index}`);
      if (block.type === "table")
        result.rows = value(`block-rows-${index}`)
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => line.split("|").map((cell) => cell.trim()));
      return result;
    });
  }
  function uploadControl(block: ContentBlock, index: number) {
    if (block.type !== "image" && block.type !== "video") return "";
    const settings = mediaTypes[block.type],
      job = uploads.get(block);
    return `<div class="media-upload"><div class="media-upload-preview">${block.url ? renderBlocks([block]) : ""}</div><div class="upload-actions"><label class="button border upload-button" for="block-file-${index}">${icon("upload")}${block.url ? "更换" : "上传"}${blockNames[block.type]}</label><input class="file-input" id="block-file-${index}" type="file" accept="${settings.accept}" data-upload="${index}" aria-label="${block.url ? "更换" : "上传"}${blockNames[block.type]}" ${job?.pending ? "disabled" : ""}><span class="upload-status" role="status">${job?.pending ? `上传中 ${job.progress}%` : h(job?.error || "")}</span></div><p class="help">${settings.hint}</p></div>`;
  }
  function mapControl(block: ContentBlock, index: number) {
    const incident = workspace.incidents.find(
      (i) => i.id === value("incidentId"),
    );
    return mapPreview(
      block.latitude,
      block.longitude,
      block.text || "地图",
      `editable id="block-map-${index}" tabindex="-1" data-map-index="${index}" ${incident ? `center-lat="${incident.latitude}" center-lng="${incident.longitude}"` : ""}`,
      mapAnnotations(block),
    );
  }
  function refreshUpload(block: ContentBlock) {
    const index = blocks.indexOf(block);
    const row = blockHost.children[index];
    if (!row) return;
    const region = row.querySelector(".media-upload")!;
    const job = uploads.get(block);
    region.querySelector(".upload-status")!.textContent = job?.pending
      ? job.progress === 100
        ? "正在处理…"
        : `上传中 ${job.progress}%`
      : job?.error || "";
    region.querySelector<HTMLInputElement>("input")!.disabled = !!job?.pending;
    region
      .querySelector(".upload-button")!
      .classList.toggle("upload-busy", !!job?.pending);
    if (block.url && !job?.pending) {
      region.querySelector(".upload-button")!.innerHTML =
        `${icon("upload")}更换${blockNames[block.type]}`;
      region
        .querySelector("input")!
        .setAttribute("aria-label", `更换${blockNames[block.type]}`);
    }
    if (block.url && !job?.pending)
      updatePreview(
        region.querySelector(".media-upload-preview")!,
        renderBlocks([block]),
      );
  }
  blockHost.addEventListener("change", async (event) => {
    const picker = event.target as HTMLInputElement;
    if (!picker.matches("[data-upload]")) return;
    const block = blocks[Number(picker.dataset.upload)];
    if (block.type !== "image" && block.type !== "video") return;
    const file = picker.files?.[0];
    if (!file) return;
    const settings = mediaTypes[block.type];
    if (
      !(settings.accept.split(",") as string[]).includes(file.type) ||
      file.size > settings.limit ||
      !file.size
    ) {
      picker.value = "";
      return toast(settings.hint);
    }
    readBlocks();
    const job = {
      controller: new AbortController(),
      pending: true,
      progress: 0,
      error: "",
    };
    uploads.set(block, job);
    changed();
    refreshUpload(block);
    try {
      const result = await uploadMedia(
        file,
        job.controller.signal,
        (percent) => {
          job.progress = percent;
          if (!disposed) refreshUpload(block);
        },
      );
      if (disposed || !blocks.includes(block) || uploads.get(block) !== job)
        return;
      block.url = result.url;
      job.pending = false;
      changed();
      refreshUpload(block);
    } catch (error) {
      if (disposed || !blocks.includes(block) || uploads.get(block) !== job)
        return;
      job.pending = false;
      job.error = errorText(error);
      refreshUpload(block);
      status.textContent = "上传未完成，请重试或删除该内容块";
    } finally {
      picker.value = "";
    }
  });
  blockHost.addEventListener("mapchange", (event) => {
    const map = event.target as HTMLElement;
    const index = Number(map.dataset.mapIndex);
    const { annotations } = (
      event as CustomEvent<{ annotations: MapAnnotation[] }>
    ).detail;
    blocks[index].annotations = annotations;
    const point = annotations[0]?.coordinates[0];
    blocks[index].latitude = point?.latitude;
    blocks[index].longitude = point?.longitude;
    changed();
  });
  function drawBlocks() {
    blockHost.innerHTML = blocks
      .map(
        (block, index) =>
          `<div class="block-editor" style="border-top:1px solid var(--outline-variant);margin-top:20px;padding-top:16px"><div class="row"><strong class="max" style="font-size:.85rem">${index + 1}. ${blockNames[block.type]}</strong><button class="transparent circle" type="button" data-move-block="${index}" ${index === 0 ? "disabled" : ""} aria-label="上移第 ${index + 1} 段">${icon("arrow_upward")}</button><button class="transparent circle" type="button" data-remove-block="${index}" aria-label="删除第 ${index + 1} 段">${icon("delete_outline")}</button></div>${block.type === "paragraph" ? textarea(`block-text-${index}`, "文本内容", block.text || "", 'maxlength="10000"') : input(`block-text-${index}`, block.type === "heading" ? "小标题" : "说明文字", block.text || "", 'maxlength="10000"')}${uploadControl(block, index)}${block.type === "map" ? mapControl(block, index) : ""}${block.type === "table" ? textarea(`block-rows-${index}`, "表格内容", block.rows?.map((row) => row.join(" | ")).join("\n") || "", 'maxlength="10000"') + '<p class="help">每行一条记录，列之间用 | 分隔，第一行为表头。</p>' : ""}</div>`,
      )
      .join("");
    blockHost
      .querySelectorAll<HTMLButtonElement>("[data-remove-block]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          readBlocks();
          const index = Number(button.dataset.removeBlock);
          const removed = blocks.splice(index, 1)[0];
          uploads.get(removed)?.controller.abort();
          uploads.delete(removed);
          drawBlocks();
          changed();
          undoButton.focus();
        }),
      );
    blockHost
      .querySelectorAll<HTMLButtonElement>("[data-move-block]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          readBlocks();
          const i = Number(button.dataset.moveBlock);
          [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
          drawBlocks();
          changed();
        }),
      );
  }
  function data(): TaskInput {
    readBlocks();
    return {
      title: value("title").trim(),
      summary: value("summary").trim(),
      incidentId: value("incidentId"),
      ownerId: value("ownerId"),
      capacity: value("capacity") ? Number(value("capacity")) : null,
      startsAt: utcInput(value("startsAt")),
      endsAt: utcInput(value("endsAt")),
      deadline: utcInput(value("deadline")),
      location: value("location").trim(),
      meetingPoint: source?.meetingPoint || "",
      blocks,
      requiredFields: Array.from(
        form.querySelectorAll<HTMLInputElement>(
          '[name="requiredFields"]:checked',
        ),
      ).map((e) => e.value),
      contactFields: Array.from(
        form.querySelectorAll<HTMLInputElement>(
          '[name="contactFields"]:checked',
        ),
      ).map((e) => e.value),
      version,
    };
  }
  function previewHTML() {
    readBlocks();
    const rows = [
      ["任务开始（北京时间）", value("startsAt").replace("T", " ")],
      ["任务结束（北京时间）", value("endsAt").replace("T", " ")],
      ["报名截止（北京时间）", value("deadline").replace("T", " ")],
      ["地点描述", value("location")],
      ["集合地点", source?.meetingPoint || ""],
      ["人数上限", value("capacity")],
    ].filter(([, text]) => text);
    const metadata: ContentBlock[] = rows.length
      ? [
          { type: "heading", text: "招募信息" },
          { type: "table", rows: [["项目", "信息"], ...rows] },
        ]
      : [];
    return `<div class="meta-line">${icon(workspace.organization.verified ? "verified" : "domain")}${h(workspace.organization.name)}</div><h2>${h(value("title") || "任务标题")}</h2><p class="muted">${h(value("summary") || "任务摘要")}</p><div class="description">${renderBlocks([...metadata, ...blocks])}</div>`;
  }
  function preview() {
    updatePreview(host.querySelector("#live-preview")!, previewHTML());
    blocks.forEach((block, index) => {
      if (block.type !== "map") return;
      const map = blockHost.querySelector(`[data-map-index="${index}"]`);
      if (!map) return;
      for (const coordinate of ["latitude", "longitude"] as const) {
        if (block[coordinate] === undefined) map.removeAttribute(coordinate);
        else map.setAttribute(coordinate, String(block[coordinate]));
      }
      map.setAttribute("annotations", JSON.stringify(mapAnnotations(block)));
      map.setAttribute("label", block.text || "地图");
      const incident = workspace.incidents.find(
        (i) => i.id === value("incidentId"),
      );
      if (incident) {
        map.setAttribute("center-lat", String(incident.latitude));
        map.setAttribute("center-lng", String(incident.longitude));
      }
    });
  }
  async function save(automatic = false): Promise<void> {
    if ([...uploads.values()].some((job) => job.pending || job.error)) {
      if (!automatic)
        status.textContent = "请等待上传完成，失败的文件可重试或删除";
      return;
    }
    if (saving) {
      await saving;
      if ([...uploads.values()].some((job) => job.pending || job.error)) return;
      if (!dirty) return;
    }
    if (!dirty && id) return;
    const input = data();
    if (!input.title || !input.incidentId) {
      if (!automatic) {
        if (!input.title) form.reportValidity();
        else {
          status.textContent = "请先选择事件";
          const button =
            form.querySelector<HTMLButtonElement>("#incidentId-picker")!;
          button.setAttribute("aria-invalid", "true");
          button.focus();
          button.click();
        }
      }
      return;
    }
    if (!input.contactFields.length) {
      if (!automatic) formError(form, "请至少选择一种联系方式。");
      return;
    }
    if (!form.checkValidity()) {
      if (!automatic) form.reportValidity();
      return;
    }
    const savedRevision = revision;
    status.textContent = "正在保存…";
    saving = (async () => {
      try {
        if (id) {
          await api(`/tasks/${id}`, "PUT", input);
          version++;
        } else {
          const created = await api<{ id: string }>("/tasks", "POST", input);
          id = created.id;
          version = 1;
        }
        if (savedRevision === revision) dirty = false;
        if (!disposed) {
          status.textContent =
            "已保存 · " +
            new Intl.DateTimeFormat("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date());
          form.querySelector(".form-error")?.remove();
        }
        if (!automatic && !disposed) toast("任务已保存。");
      } catch (error) {
        autoSaveStopped = true;
        if (!disposed) {
          status.textContent = "保存未完成，内容仍保留在此页面";
          formError(form, errorText(error));
        }
        throw error;
      } finally {
        saving = null;
      }
    })();
    await saving;
  }
  function changed(event?: Event) {
    revision++;
    dirty = true;
    preview();
    recordBlocks(event);
    updateReadiness();
    status.textContent = draft ? "有未保存的更改…" : "更改尚未保存";
    clearTimeout(timer);
    if (draft && !autoSaveStopped)
      timer = setTimeout(() => {
        void save(true).catch(() => {});
      }, 1200);
  }
  drawBlocks();
  preview();
  current = snapshot();
  updateReadiness();
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    autoSaveStopped = false;
    void save().catch(() => {});
  });
  host
    .querySelectorAll<HTMLButtonElement>("[data-add-block]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        readBlocks();
        if (blocks.length >= 50) return toast("最多添加 50 段内容。");
        blocks.push({
          type: button.dataset.addBlock as ContentBlock["type"],
          text: "",
        });
        drawBlocks();
        changed();
        blockHost.lastElementChild
          ?.querySelector<HTMLElement>('input:not([type="file"]), textarea')
          ?.focus();
      }),
    );
  host.querySelector("#preview-task")!.addEventListener("click", () => {
    openDialog(
      "志愿者端内容预览",
      `<div class="preview-phone">${previewHTML()}</div><div class="dialog-actions"><button data-close-dialog>返回编辑</button></div>`,
    );
  });
  publishButton?.addEventListener("click", async () => {
    updateReadiness();
    if (publishButton.disabled) return;
    clearTimeout(timer);
    try {
      await save();
    } catch {
      return;
    }
    if (
      !id ||
      dirty ||
      [...uploads.values()].some((job) => job.pending || job.error)
    )
      return;
    const input = data();
    const dialog = openDialog(
      "确认发布这份招募？",
      `<p class="dialog-copy"><strong>${h(input.title)}</strong><br>${workspace.organization.demo ? "仅在演示空间发布。" : "公开任务并接收报名。"}</p><div class="dialog-actions"><button class="border" data-close-dialog>继续检查</button><button id="confirm-publish">确认发布</button></div>`,
    );
    dialog
      .querySelector<HTMLButtonElement>("#confirm-publish")!
      .addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          await api(`/tasks/${id}/state`, "POST", { state: "open", version });
          dirty = false;
          closeDialog();
          toast("招募已发布。");
          location.hash = `/tasks/${id}`;
        } catch (error) {
          formError(dialog, errorText(error));
          button.disabled = false;
        }
      });
  });
  if (copy) {
    dirty = true;
    revision++;
    status.textContent = "副本尚未保存，请重新确认日期和地点。";
  }
  return {
    dirty: () =>
      dirty ||
      !!saving ||
      [...uploads.values()].some((job) => job.pending || !!job.error),
    flush: async () => {
      clearTimeout(timer);
      try {
        await save();
        return (
          !dirty &&
          ![...uploads.values()].some((job) => job.pending || !!job.error)
        );
      } catch {
        return false;
      }
    },
    dispose: () => {
      disposed = true;
      pickerDialog?.close();
      cancelAnimationFrame(focusFrame);
      footerResize.disconnect();
      window.removeEventListener("resize", revealFocus);
      window.visualViewport?.removeEventListener("resize", revealFocus);
      clearTimeout(timer);
      clearTimeout(deadlineTimer);
      uploads.forEach((job) => job.controller.abort());
    },
  };
}
