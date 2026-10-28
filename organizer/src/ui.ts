import type {
  ApplicationState,
  ContentBlock,
  TaskState,
} from "../../shared/organizer";
import { h } from "./html";
import { mapPreview } from "./maps";
export { h } from "./html";
export const icon = (name: string) => `<i aria-hidden="true">${h(name)}</i>`;
export const stateLabels: Record<TaskState | ApplicationState, string> = {
  draft: "草稿",
  open: "招募中",
  paused: "已暂停",
  closed: "已截止",
  archived: "已归档",
  pending: "待审核",
  accepted: "已通过",
  rejected: "未通过",
  withdrawn: "已撤回",
};
export const fieldLabels: Record<string, string> = {
  username: "昵称",
  pronouns: "称谓",
  realName: "真实姓名",
  age: "年龄",
  gender: "性别",
  region: "常驻地区",
  body: "身体与活动限制",
  equipment: "装备说明",
  vehicles: "车辆情况",
  skills: "技能证明",
  phone: "手机号码",
  wechat: "微信",
  email: "电子邮箱",
};
export const vehicleLabels: Record<string, string> = {
  motorcycle: "摩托车",
  cargoTricycle: "货运三轮车",
  sedan: "轿车",
  offRoad: "越野车",
  cargoVan: "货运面包车",
};
export function badge(state: TaskState | ApplicationState) {
  return `<span class="status status-${state}"><span aria-hidden="true"></span>${stateLabels[state]}</span>`;
}
export function formatDate(value: string, full = false) {
  if (!value || Number.isNaN(Date.parse(value))) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(full ? { year: "numeric" } : {}),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function input(
  name: string,
  label: string,
  value = "",
  options = "",
  type = "text",
) {
  return `<div class="field label border"><input id="${h(name)}" name="${h(name)}" type="${h(type)}" value="${h(value)}" placeholder=" " ${options}><label for="${h(name)}">${h(label)}</label></div>`;
}
export function textarea(
  name: string,
  label: string,
  value = "",
  options = "",
) {
  return `<div class="field textarea label border"><textarea id="${h(name)}" name="${h(name)}" placeholder=" " ${options}>${h(value)}</textarea><label for="${h(name)}">${h(label)}</label></div>`;
}
export function select(
  name: string,
  label: string,
  choices: [string, string][],
  value = "",
  options = "",
) {
  return `<div class="field label border"><select id="${h(name)}" name="${h(name)}" ${options}>${choices.map(([key, text]) => `<option value="${h(key)}" ${key === value ? "selected" : ""}>${h(text)}</option>`).join("")}</select><label for="${h(name)}">${h(label)}</label></div>`;
}
export function empty(
  title: string,
  description: string,
  action = "",
  symbol = "inbox",
) {
  return `<div class="empty-state">${icon(symbol)}<h2>${h(title)}</h2>${description ? `<p>${h(description)}</p>` : ""}${action}</div>`;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作暂未完成，请重试。";
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string) {
  const element = document.querySelector<HTMLDivElement>("#toast")!;
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 5000);
}
const dialogElement = document.querySelector<HTMLDialogElement>("#dialog")!;
let restoreFocus: HTMLElement | null = null;
export function openDialog(title: string, body: string, wide = false) {
  if (dialogElement.open) dialogElement.close();
  restoreFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  dialogElement.classList.toggle("wide", wide);
  dialogElement.innerHTML = `<header class="dialog-header"><h2 id="dialog-title">${h(title)}</h2><button class="transparent circle" type="button" data-close-dialog aria-label="关闭">${icon("close")}</button></header>${body}`;
  dialogElement.showModal();
  dialogElement
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) =>
      button.addEventListener("click", () => dialogElement.close()),
    );
  return dialogElement;
}
dialogElement.addEventListener("close", () => {
  if (restoreFocus?.isConnected) restoreFocus.focus();
});
export function closeDialog() {
  dialogElement.close();
}
export function formError(form: HTMLElement, message: string) {
  let element = form.querySelector<HTMLElement>(".form-error");
  if (!element) {
    element = document.createElement("p");
    element.className = "form-error";
    element.setAttribute("role", "alert");
    form.prepend(element);
  }
  element.textContent = message;
  element.tabIndex = -1;
  element.focus();
}
export function setBusy(form: HTMLElement, busy: boolean) {
  form.setAttribute("aria-busy", String(busy));
  form
    .querySelectorAll<HTMLButtonElement>('button[type="submit"]')
    .forEach((button) => {
      button.disabled = busy;
    });
}
export function renderBlocks(blocks: ContentBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === "heading") return `<h3>${h(block.text)}</h3>`;
      if (block.type === "table")
        return `<div class="table-scroll"><table>${(block.rows ?? []).map((row, i) => `<tr>${row.map((cell) => `<${i ? "td" : "th"}>${h(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div>`;
      if (block.type === "map")
        return mapPreview(
          block.latitude,
          block.longitude,
          block.text || "位置",
        );
      if (
        (block.type === "image" || block.type === "video") &&
        block.url &&
        (block.url.startsWith("https://") ||
          (new URL(block.url, location.origin).origin === location.origin &&
            new URL(block.url, location.origin).pathname.startsWith(
              "/api/organizer-media/",
            )))
      )
        return block.type === "image"
          ? `<figure><img loading="lazy" src="${h(block.url)}" alt="${h(block.text || "任务说明图片")}"><figcaption>${h(block.text)}</figcaption></figure>`
          : `<video controls playsinline preload="none" src="${h(block.url)}" aria-label="${h(block.text || "任务说明视频")}"></video>`;
      return `<p class="preserve-lines">${h(block.text)}</p>`;
    })
    .join("");
}
export function preferences() {
  try {
    return {
      theme: localStorage.getItem("firelink:theme") || "system",
      text: localStorage.getItem("firelink:text") || "normal",
    };
  } catch {
    return { theme: "system", text: "normal" };
  }
}
export function applyPreferences(
  theme = preferences().theme,
  text = preferences().text,
) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
  document.body.classList.toggle("light", !dark);
  document.documentElement.classList.toggle("large-text", text === "large");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#191c19" : "#fbf8f4");
  try {
    localStorage.setItem("firelink:theme", theme);
    localStorage.setItem("firelink:text", text);
  } catch {
    /* Private browsing can disallow storage. */
  }
}
