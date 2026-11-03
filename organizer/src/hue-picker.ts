import {
  DEFAULT_HUE,
  hctHex,
  hueGradient,
  hueName,
  normalizeHue,
} from "./theme";

const presets = [266, 320, 25, 90, 155];
const hueDescription = (hue: number) => `${hueName(hue)}色系，${hue} 度`;

export function huePicker(hue: number): string {
  return `<fieldset class="hue-picker"><legend>主题色</legend>
    <div class="hue-wheel" role="slider" tabindex="0" aria-label="主题色相"
      aria-valuemin="0" aria-valuemax="359" aria-valuenow="${hue}"
      aria-valuetext="${hueDescription(hue)}" aria-describedby="hue-help"
      style="--hue-gradient:${hueGradient};--hue-angle:${hue}deg">
      <span class="hue-readout" aria-hidden="true"><strong data-hue-name>${hueName(hue)}</strong><span data-hue-value>${hue}°</span></span>
      <span class="hue-handle" aria-hidden="true"></span>
    </div>
    <p id="hue-help" class="hue-help">拖动色环或使用方向键调整</p>
    <div class="hue-presets" role="group" aria-label="常用主题色">
      ${presets.map((value) => `<button type="button" class="hue-preset" data-hue="${value}" aria-label="${hueDescription(value)}${value === DEFAULT_HUE ? "，默认色" : ""}" aria-pressed="${hue === value}" style="--swatch:${hctHex(value, 36, 40)}"><span class="hue-swatch" aria-hidden="true"><i>check</i></span><span>${hueName(value)}</span></button>`).join("")}
    </div>
    <button type="button" class="border hue-reset" data-hue="${DEFAULT_HUE}">恢复默认色</button>
    <p class="forced-colors-note">系统高对比度已启用，主题色将在关闭后显示。</p>
  </fieldset>`;
}

export function updateHuePicker(root: HTMLElement, hue: number) {
  const wheel = root.querySelector<HTMLElement>(".hue-wheel");
  if (!wheel) return;
  wheel.style.setProperty("--hue-angle", `${hue}deg`);
  wheel.setAttribute("aria-valuenow", String(hue));
  wheel.setAttribute("aria-valuetext", hueDescription(hue));
  wheel.querySelector("[data-hue-name]")!.textContent = hueName(hue);
  wheel.querySelector("[data-hue-value]")!.textContent = `${hue}°`;
  root
    .querySelectorAll<HTMLElement>(".hue-preset")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.hue) === hue),
      ),
    );
}

export function bindHuePicker(
  root: HTMLElement,
  onChange: (hue: number) => void,
) {
  const change = (hue: number) => {
    hue = normalizeHue(hue);
    onChange(hue);
    updateHuePicker(root, hue);
  };
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-hue]");
    if (button) change(Number(button.dataset.hue));
  });
  root.addEventListener("keydown", (event) => {
    const wheel = (event.target as Element).closest<HTMLElement>(".hue-wheel");
    if (!wheel) return;
    const value = Number(wheel.getAttribute("aria-valuenow"));
    const step = event.shiftKey ? 10 : 1;
    const keys: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + 15,
      PageDown: value - 15,
      Home: 0,
      End: 359,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    change(Math.max(0, Math.min(359, keys[event.key])));
  });
  let drag: { id: number; wheel: HTMLElement } | undefined;
  const fromPointer = (event: PointerEvent, wheel: HTMLElement) => {
    const bounds = wheel.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    // The center is a readout; avoid arbitrary hue changes while crossing it.
    if (Math.hypot(x, y) < bounds.width * 0.28) return;
    change(((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360);
  };
  root.addEventListener("pointerdown", (event) => {
    const wheel = (event.target as Element).closest<HTMLElement>(".hue-wheel");
    if (!wheel || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    wheel.focus({ preventScroll: true });
    wheel.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, wheel };
    fromPointer(event, wheel);
  });
  root.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) fromPointer(event, drag.wheel);
  });
  for (const type of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const) {
    root.addEventListener(type, (event) => {
      if (drag?.id === event.pointerId) drag = undefined;
    });
  }
}
