import type { DemoInput, DemoStatus, Scene, Theme } from "../types.ts";

type Elements = {
  screen: HTMLImageElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  back: HTMLButtonElement;
};
function $<K extends string>(
  id: K,
): K extends keyof Elements ? Elements[K] : HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少页面元素：${id}`);
  return element as K extends keyof Elements ? Elements[K] : HTMLElement;
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const media = matchMedia("(prefers-color-scheme: dark)");
let scenes: Scene[] = [];
let index = 0;
let revision: number | null = null;
let session: string | null = null;
let busy = false;
let live = false;
let generation = 0;
let frameURL: string | null = null;
let inputBusy = false;
const theme = (): Theme => (media.matches ? "dark" : "light");
function paintTheme() {
  document.body.className = theme();
}
paintTheme();
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "连接失败");
  return data as T;
}
function render() {
  const s = scenes[index];
  $("headline").replaceChildren(
    document.createTextNode(s.title[0]),
    document.createElement("br"),
  );
  const em = document.createElement("em");
  em.textContent = s.title[1];
  $("headline").append(em);
  $("description").textContent = s.description;
  $("points").replaceChildren(
    ...s.points.map((p) => {
      const li = document.createElement("li"),
        icon = document.createElement("i");
      icon.textContent = "check";
      icon.setAttribute("aria-hidden", "true");
      li.append(icon, document.createTextNode(p));
      return li;
    }),
  );
  $("previous").classList.toggle("circle", index === 0);
  $("previous").classList.toggle("round", index > 0);
  $("previous-label").hidden = index === 0;
  const lastPage = index === scenes.length - 1;
  $("next").firstElementChild!.textContent = lastPage ? "从头开始" : "下一页";
  $("next").lastElementChild!.textContent = lastPage
    ? "fast_forward"
    : "arrow_forward";
  setControls();
}
function setControls() {
  for (const element of document.querySelectorAll<HTMLButtonElement>(
    "#previous, #next, #reset, #back",
  ))
    element.disabled = busy || !scenes.length;
  $("previous").disabled = busy || index === 0;
  $("back").disabled = busy || !live;
}
function cover(message: string, detail = "", failed = false) {
  live = false;
  const scene = scenes[index]?.id || "welcome";
  $("preview-dark").setAttribute("srcset", `/screenshots/${scene}-dark.png`);
  $("preview-light").setAttribute("src", `/screenshots/${scene}-light.png`);
  $("screen-preview").hidden = false;
  $("screen").hidden = true;
  $("screen-cover").hidden = false;
  $("screen-message").textContent = message;
  $("screen-detail").textContent = detail;
  $("screen-detail").hidden = !detail;
  $("screen-cover").querySelector("progress")!.hidden = failed;
  $("retry").hidden = !failed;
  setControls();
}
async function activate(next = index) {
  if (busy || !scenes.length) return;
  const desiredTheme = theme();
  busy = true;
  index = Math.max(0, Math.min(next, scenes.length - 1));
  generation++;
  revision = null;
  render();
  history.replaceState(null, "", `#${scenes[index].id}`);
  cover("准备演示场景");
  $("connection").textContent = "等待应用页面就绪";
  try {
    const state = await request<DemoStatus>("/api/demo/scene", {
      id: scenes[index].id,
      theme: desiredTheme,
    });
    revision = state.revision;
    session = state.session;
    $("connection").textContent = "";
  } catch (e) {
    cover("连接未完成", errorMessage(e), true);
    $("connection").textContent = "请确认启动终端仍在运行";
  } finally {
    busy = false;
    setControls();
    if (revision !== null && desiredTheme !== theme())
      queueMicrotask(() => activate());
  }
}
async function frames() {
  if (!busy && revision !== null && !document.hidden) {
    const token = generation,
      expected = revision;
    try {
      const response = await fetch(`/api/demo/frame?revision=${expected}`, {
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("正在同步应用画面");
      const blob = await response.blob();
      if (
        token !== generation ||
        busy ||
        Number(response.headers.get("X-Demo-Revision")) !== revision
      )
        return;
      const url = URL.createObjectURL(blob),
        image = new Image();
      image.src = url;
      await image.decode();
      if (token !== generation || busy) {
        URL.revokeObjectURL(url);
        return;
      }
      $("screen").src = url;
      if (frameURL) URL.revokeObjectURL(frameURL);
      frameURL = url;
      $("screen").hidden = false;
      $("screen-preview").hidden = true;
      $("screen-cover").hidden = true;
      live = true;
      $("connection").textContent = "";
      setControls();
    } catch (e) {
      if (token === generation && !busy) {
        cover("实时画面已中断", "正在尝试重新连接；也可以重置本页。", true);
        $("connection").textContent = errorMessage(e);
      }
    }
  }
}
async function loop() {
  await frames();
  setTimeout(loop, 450);
}
async function input(action: DemoInput) {
  if (busy || !live || inputBusy) return;
  inputBusy = true;
  try {
    await request("/api/demo/input", { ...action, revision });
  } catch (e) {
    $("connection").textContent = errorMessage(e);
  } finally {
    inputBusy = false;
  }
}
let down: { x: number; y: number } | null = null;
function position(event: PointerEvent) {
  const rect = $("screen").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}
$("screen").addEventListener("pointerdown", (e) => {
  if (!live || busy) return;
  down = position(e);
  $("screen").setPointerCapture(e.pointerId);
});
$("screen").addEventListener("pointerup", (e) => {
  if (!down) return;
  const start = down,
    end = position(e);
  down = null;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  input(
    distance < 0.025
      ? { type: "tap", ...end }
      : { type: "swipe", ...start, endX: end.x, endY: end.y },
  );
});
$("screen").addEventListener("pointercancel", () => {
  down = null;
});
$("screen").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    input({
      type: "swipe",
      x: 0.5,
      y: e.deltaY > 0 ? 0.8 : 0.25,
      endX: 0.5,
      endY: e.deltaY > 0 ? 0.25 : 0.8,
    });
  },
  { passive: false },
);
document.querySelector<HTMLElement>(".brand")!.onclick = (e) => {
  e.preventDefault();
  activate(0);
};
$("previous").onclick = () => activate(index - 1);
$("next").onclick = () => activate((index + 1) % scenes.length);
$("reset").onclick = $("retry").onclick = () => activate();
$("back").onclick = () => input({ type: "back" });
media.addEventListener("change", () => {
  paintTheme();
  activate();
});
document.addEventListener("keydown", (e) => {
  if (
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    (e.target instanceof Element &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
  )
    return;
  if (
    [
      "ArrowRight",
      "ArrowLeft",
      "PageDown",
      "PageUp",
      "Home",
      "End",
      "r",
      "R",
    ].includes(e.key)
  )
    e.preventDefault();
  if (["ArrowRight", "PageDown"].includes(e.key))
    activate((index + 1) % scenes.length);
  if (["ArrowLeft", "PageUp"].includes(e.key)) activate(index - 1);
  if (e.key === "Home") activate(0);
  if (e.key === "End") activate(scenes.length - 1);
  if (e.key.toLowerCase() === "r") activate();
});
window.addEventListener("hashchange", () => {
  const target = scenes.findIndex((s) => s.id === location.hash.slice(1));
  if (target >= 0) activate(target);
});
// Other presentation windows and backend restarts cannot leave a previous frame marked live.
setInterval(async () => {
  if (busy || document.hidden || !session) return;
  try {
    const status = await request<DemoStatus>("/api/demo/status");
    if (busy) return;
    if (status.session !== session) {
      revision = null;
      generation++;
      cover("服务已重新启动", "请重置本页，以恢复预设场景。", true);
      return;
    }
    if (status.revision !== revision) {
      generation++;
      revision = null;
      if (status.busy) {
        cover("正在同步场景", "另一个演示窗口正在切换页面");
        return;
      }
      if (status.scene) {
        index = scenes.findIndex((s) => s.id === status.scene);
        revision = status.revision;
        render();
        cover("准备演示场景");
        history.replaceState(null, "", `#${status.scene}`);
      } else cover("场景未就绪", status.error || "请重置本页", true);
    }
  } catch {
    /* Frame polling reports connection failure and automatically resumes. */
  }
}, 3000);
try {
  scenes = await request<Scene[]>("/api/demo/scenes");
  const target = scenes.findIndex((s) => s.id === location.hash.slice(1));
  index = Math.max(0, target);
  await activate();
} catch (e) {
  cover("无法读取演示", errorMessage(e), true);
  $("retry").onclick = () => location.reload();
}
loop();
