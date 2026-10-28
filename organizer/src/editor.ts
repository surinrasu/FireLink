import type {
  ContentBlock,
  OrganizerTask,
  TaskInput,
  Workspace,
} from "../../shared/organizer";
import { api, uploadMedia } from "./api";
import { mediaTypes } from "../../shared/media";
import { mapPreview, updatePreview } from "./maps";
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
  select,
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
  paragraph: "段落",
  image: "图片",
  video: "视频",
  table: "表格",
  map: "地图位置",
};

export function mountEditor(
  host: HTMLElement,
  workspace: Workspace,
  task?: OrganizerTask,
  copy?: OrganizerTask,
  incidentId = "",
): EditorHandle {
  const source = task || copy;
  let id = task?.id;
  let version = task?.version ?? 1;
  let disposed = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout>;
  let saving: Promise<void> | null = null;
  let revision = 0;
  let autoSaveStopped = false;
  const deletedBlocks: {
    block: ContentBlock;
    index: number;
    uploadCancelled: boolean;
  }[] = [];
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
  const requirementsLocked =
    !!task && task.pending + task.accepted + task.rejected + task.withdrawn > 0;
  const fields = source?.requiredFields || ["realName", "region"];
  const contacts = source?.contactFields || ["phone"];
  host.innerHTML = `<form id="task-form"><div class="editor-layout"><div>
    <section class="panel editor-section"><h2><span class="step-number">1</span>基本信息</h2>${input("title", "任务标题", copy ? `${copy.title}（副本）` : task?.title || "", 'required maxlength="100"')}${textarea("summary", "一句话介绍任务", source?.summary || "", 'maxlength="500"')}
    <div class="form-grid">${select("incidentId", "所属事件", [["", "请选择事件"], ...workspace.incidents.map((i) => [i.id, i.title] as [string, string])], incidentId || source?.incidentId || "", "required")}${select(
      "ownerId",
      "任务负责人",
      workspace.members
        .filter((m) => m.active && m.role !== "reviewer")
        .map((m) => [m.id, m.name]),
      source?.ownerId || workspace.membership.id,
    )}</div></section>
    <section class="panel editor-section"><h2><span class="step-number">2</span>时间与地点</h2><p class="muted" style="font-size:.8rem;margin-top:12px">北京时间（UTC+8）</p><div class="form-grid">${input("startsAt", "服务开始时间", task ? beijingInput(task.startsAt) : "", "", "datetime-local")}${input("endsAt", "服务结束时间", task ? beijingInput(task.endsAt) : "", "", "datetime-local")}${input("deadline", "报名截止时间", task ? beijingInput(task.deadline) : "", "", "datetime-local")}${input("capacity", "计划招募人数", source?.capacity?.toString() || "", 'min="1" max="10000" step="1"', "number")}</div><p class="help">留空不限人数，按通过报名计数。</p>${input("location", "服务地点", source?.location || "", 'maxlength="300"')}${input("meetingPoint", "集合地点（可选）", source?.meetingPoint || "", 'maxlength="300"')}<button class="border" type="button" id="mark-location">${icon("add_location_alt")}地图标记</button></section>
    <section class="panel editor-section"><h2><span class="step-number">3</span>工作内容与参与要求</h2><div id="blocks"></div><div class="row wrap">${select("add-block-type", "添加内容", Object.entries(blockNames))}<button class="border" type="button" id="add-block">${icon("add")}添加</button></div></section>
    <section class="panel editor-section"><h2><span class="step-number">4</span>报名资料与授权</h2>${requirementsLocked ? '<div class="info-note" style="margin-top:14px">已有报名，授权要求不可修改。如需更改，请复制为新任务。</div>' : ""}<fieldset style="border:0;padding:0;margin-top:20px"><legend>报名必填资料</legend><div class="check-grid">${Object.entries(
      fieldLabels,
    )
      .filter(([key]) => !["phone", "wechat", "email"].includes(key))
      .map(
        ([key, label]) =>
          `<label class="checkbox"><input type="checkbox" name="requiredFields" value="${key}" ${fields.includes(key) ? "checked" : ""} ${requirementsLocked ? "disabled" : ""}><span>${label}</span></label>`,
      )
      .join(
        "",
      )}</div></fieldset><fieldset style="border:0;padding:0;margin-top:20px"><legend>通过后开放的联系方式</legend><div class="check-grid">${["phone", "wechat", "email"].map((key) => `<label class="checkbox"><input type="checkbox" name="contactFields" value="${key}" ${contacts.includes(key) ? "checked" : ""} ${requirementsLocked ? "disabled" : ""}><span>${fieldLabels[key]}</span></label>`).join("")}</div></fieldset></section>
    </div><aside class="editor-preview"><p class="preview-label">志愿者端内容预览</p><div class="preview-phone" id="live-preview"></div></aside></div>
    <footer class="editor-footer"><small id="save-status" role="status">${draft ? "草稿填写后自动保存" : "已发布任务的更改需要手动保存"}</small><div class="actions"><button class="border" type="button" id="preview-task">${icon("visibility")}预览</button><button class="border" type="submit">保存${draft ? "草稿" : "更改"}</button>${draft ? '<button type="button" id="publish-task">发布招募</button>' : ""}</div></footer></form>`;
  const form = host.querySelector<HTMLFormElement>("#task-form")!;
  const status = host.querySelector<HTMLElement>("#save-status")!;
  const blockHost = host.querySelector<HTMLElement>("#blocks")!;
  const undoRegion = document.createElement("div");
  undoRegion.className = "block-undo row wrap";
  undoRegion.hidden = true;
  undoRegion.innerHTML =
    '<span id="block-undo-status" role="status"></span><button type="button" class="border" id="undo-block">撤销删除</button>';
  blockHost.before(undoRegion);
  const undoButton = undoRegion.querySelector<HTMLButtonElement>("button")!;
  const undoStatus = undoRegion.querySelector<HTMLElement>("span")!;
  undoButton.addEventListener("click", () => {
    if (blocks.length >= 50)
      return toast("内容已达 50 段，请先删除空段再恢复。");
    const deleted = deletedBlocks.pop();
    if (!deleted) return;
    readBlocks();
    const index = Math.min(deleted.index, blocks.length);
    blocks.splice(index, 0, deleted.block);
    drawBlocks();
    changed();
    undoRegion.hidden = !deletedBlocks.length;
    undoStatus.textContent = deletedBlocks.length
      ? `还有 ${deletedBlocks.length} 段可撤销删除`
      : "";
    blockHost.children[index]
      ?.querySelector<HTMLElement>('input:not([type="file"]), textarea')
      ?.focus();
    toast(
      deleted.uploadCancelled
        ? "内容已恢复；已取消的上传请重新选择文件。"
        : "已恢复删除的内容。",
    );
  });
  const value = (name: string) => String(new FormData(form).get(name) || "");
  function readBlocks() {
    blocks = blocks.map((block, index) => {
      const result = block;
      result.text = value(`block-text-${index}`);
      if (block.type === "map") {
        const latitude = value(`block-lat-${index}`).trim(),
          longitude = value(`block-lng-${index}`).trim();
        result.latitude = latitude ? Number(latitude) : undefined;
        result.longitude = longitude ? Number(longitude) : undefined;
      }
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
      block.text || "标记位置",
      `editable data-map-index="${index}" ${incident ? `center-lat="${incident.latitude}" center-lng="${incident.longitude}"` : ""}`,
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
      if (disposed || !blocks.includes(block)) return;
      block.url = result.url;
      job.pending = false;
      changed();
      refreshUpload(block);
    } catch (error) {
      if (disposed || !blocks.includes(block)) return;
      job.pending = false;
      job.error = errorText(error);
      refreshUpload(block);
      status.textContent = "上传未完成，请重试或删除该内容块";
    } finally {
      picker.value = "";
    }
  });
  blockHost.addEventListener("locationchange", (event) => {
    const map = event.target as HTMLElement;
    const index = Number(map.dataset.mapIndex);
    const point = (
      event as CustomEvent<{ latitude: number; longitude: number }>
    ).detail;
    form.querySelector<HTMLInputElement>(`#block-lat-${index}`)!.value = String(
      point.latitude,
    );
    form.querySelector<HTMLInputElement>(`#block-lng-${index}`)!.value = String(
      point.longitude,
    );
    changed();
  });
  function drawBlocks() {
    blockHost.innerHTML = blocks
      .map(
        (block, index) =>
          `<div class="block-editor" style="border-top:1px solid var(--outline-variant);margin-top:20px;padding-top:16px"><div class="row"><strong class="max" style="font-size:.85rem">${index + 1}. ${blockNames[block.type]}</strong><button class="transparent circle" type="button" data-move-block="${index}" ${index === 0 ? "disabled" : ""} aria-label="上移第 ${index + 1} 段">${icon("arrow_upward")}</button><button class="transparent circle" type="button" data-remove-block="${index}" aria-label="删除第 ${index + 1} 段">${icon("delete_outline")}</button></div>${block.type === "paragraph" ? textarea(`block-text-${index}`, "段落内容", block.text || "", 'maxlength="10000"') : input(`block-text-${index}`, block.type === "heading" ? "小标题" : "说明文字", block.text || "", 'maxlength="10000"')}${uploadControl(block, index)}${block.type === "map" ? `${mapControl(block, index)}<div class="form-grid">${input(`block-lat-${index}`, "纬度", String(block.latitude ?? ""), 'min="-90" max="90" step="any"', "number")}${input(`block-lng-${index}`, "经度", String(block.longitude ?? ""), 'min="-180" max="180" step="any"', "number")}</div>` : ""}${block.type === "table" ? textarea(`block-rows-${index}`, "表格内容", block.rows?.map((row) => row.join(" | ")).join("\n") || "", 'maxlength="10000"') + '<p class="help">每行一条记录，列之间用 | 分隔，第一行为表头。</p>' : ""}</div>`,
      )
      .join("");
    blockHost
      .querySelectorAll<HTMLButtonElement>("[data-remove-block]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          readBlocks();
          const index = Number(button.dataset.removeBlock);
          const removed = blocks.splice(index, 1)[0];
          deletedBlocks.push({
            block: structuredClone(removed),
            index,
            uploadCancelled: !!uploads.get(removed)?.pending,
          });
          uploads.get(removed)?.controller.abort();
          uploads.delete(removed);
          drawBlocks();
          changed();
          undoRegion.hidden = false;
          undoStatus.textContent = `已删除第 ${index + 1} 段 · 本次编辑可撤销`;
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
      meetingPoint: value("meetingPoint").trim(),
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
      ["服务开始（北京时间）", value("startsAt").replace("T", " ")],
      ["服务结束（北京时间）", value("endsAt").replace("T", " ")],
      ["报名截止（北京时间）", value("deadline").replace("T", " ")],
      ["服务地点", value("location")],
      ["集合地点", value("meetingPoint")],
      ["招募人数", value("capacity")],
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
      map.setAttribute("label", block.text || "标记位置");
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
      if (!automatic) form.reportValidity();
      return;
    }
    if (!input.contactFields.length) {
      if (!automatic) formError(form, "请至少选择一种通过后开放的联系方式。");
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
  function changed() {
    revision++;
    dirty = true;
    preview();
    status.textContent = draft ? "有未保存的更改…" : "更改尚未保存";
    clearTimeout(timer);
    if (draft && !autoSaveStopped)
      timer = setTimeout(() => {
        void save(true).catch(() => {});
      }, 1200);
  }
  drawBlocks();
  preview();
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    autoSaveStopped = false;
    void save().catch(() => {});
  });
  host.querySelector("#add-block")!.addEventListener("click", () => {
    readBlocks();
    if (blocks.length >= 50) return toast("最多添加 50 段内容。");
    blocks.push({
      type: value("add-block-type") as ContentBlock["type"],
      text: "",
    });
    drawBlocks();
    changed();
  });
  host.querySelector("#mark-location")!.addEventListener("click", () => {
    readBlocks();
    let index = blocks.findIndex((block) => block.type === "map");
    if (index < 0) {
      if (blocks.length >= 50) return toast("最多添加 50 段内容。");
      index = blocks.length;
      blocks.push({
        type: "map",
        text: value("meetingPoint") || value("location"),
      });
      drawBlocks();
      changed();
    }
    const map = blockHost.querySelector<HTMLElement>(
      `[data-map-index="${index}"]`,
    )!;
    map.scrollIntoView({ block: "center", behavior: "instant" });
    form
      .querySelector<HTMLInputElement>(`#block-lat-${index}`)!
      .focus({ preventScroll: true });
  });
  host.querySelector("#preview-task")!.addEventListener("click", () => {
    openDialog(
      "志愿者端内容预览",
      `<div class="preview-phone">${previewHTML()}</div><div class="dialog-actions"><button data-close-dialog>返回编辑</button></div>`,
    );
  });
  host
    .querySelector<HTMLButtonElement>("#publish-task")
    ?.addEventListener("click", async () => {
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
      if (
        !input.summary ||
        !input.location ||
        !input.startsAt ||
        !input.deadline ||
        !input.requiredFields.length
      )
        return formError(
          form,
          "发布前请补充摘要、服务地点、开始时间、报名截止时间，并选择至少一项必需资料。",
        );
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
      clearTimeout(timer);
      uploads.forEach((job) => job.controller.abort());
    },
  };
}
