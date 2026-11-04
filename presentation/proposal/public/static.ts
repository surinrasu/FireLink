import { SCENES } from "../scenes.ts";

const get = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const previous = get<HTMLButtonElement>("previous");
const next = get<HTMLButtonElement>("next");
const media = matchMedia("(prefers-color-scheme: dark)");
let index = 0;
const paintTheme = () => {
  document.body.className = media.matches ? "dark" : "light";
};
paintTheme();
media.addEventListener("change", paintTheme);

function render() {
  const scene = SCENES[index];
  const emphasis = document.createElement("em");
  emphasis.textContent = scene.title[1];
  get("headline").replaceChildren(
    document.createTextNode(scene.title[0]),
    document.createElement("br"),
    emphasis,
  );
  get("description").textContent = scene.description;
  get("points").replaceChildren(
    ...scene.points.map((point) => {
      const item = document.createElement("li");
      const icon = document.createElement("i");
      icon.textContent = "check";
      icon.setAttribute("aria-hidden", "true");
      item.append(icon, document.createTextNode(point));
      return item;
    }),
  );
  const screenshot = (theme: string) =>
    new URL(`screenshots/${scene.id}-${theme}.png`, import.meta.url).href;
  get("preview-dark").setAttribute("srcset", screenshot("dark"));
  const preview = get<HTMLImageElement>("preview-light");
  preview.src = screenshot("light");
  preview.alt = `FireLink Android 客户端：${scene.label}`;
  get("connection").textContent =
    `${index + 1} / ${SCENES.length}　${scene.label}`;
  previous.disabled = index === 0;
  next.querySelector("span")!.textContent =
    index === SCENES.length - 1 ? "从头开始" : "下一页";
  document.title = `${scene.label} | FireLink 开题汇报`;
}
function go(target: number) {
  index = Math.max(0, Math.min(target, SCENES.length - 1));
  history.replaceState(null, "", `#${SCENES[index].id}`);
  render();
}
function fromHash() {
  index = Math.max(
    0,
    SCENES.findIndex((scene) => scene.id === location.hash.slice(1)),
  );
  render();
}
previous.addEventListener("click", () => go(index - 1));
next.addEventListener("click", () => go((index + 1) % SCENES.length));
window.addEventListener("hashchange", fromHash);
window.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  )
    return;
  const target = {
    ArrowRight: (index + 1) % SCENES.length,
    PageDown: (index + 1) % SCENES.length,
    ArrowLeft: index - 1,
    PageUp: index - 1,
    Home: 0,
    End: SCENES.length - 1,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  go(target);
});
fromHash();
