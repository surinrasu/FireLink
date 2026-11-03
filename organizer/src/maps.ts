import * as L from "leaflet";
import type { MapAnnotation, MapCoordinate } from "../../shared/organizer";
import {
  completeMapAnnotation,
  mapAnnotations,
  mapAnnotationLabels,
  mapMinimumPoints,
  MAX_MAP_ANNOTATIONS,
  MAX_MAP_POINTS,
  validCoordinates,
} from "../../shared/maps";
import { h } from "./html";
import { MAP_INK } from "./theme";
export { validCoordinates } from "../../shared/maps";

export function mapPreview(
  latitude?: number,
  longitude?: number,
  label = "地图",
  extra = "",
  annotations?: MapAnnotation[],
) {
  const marks = mapAnnotations({ latitude, longitude, annotations });
  if (!marks.length && !extra.includes("editable"))
    return '<p class="muted">地图尚未添加标注</p>';
  const coordinates = validCoordinates(latitude, longitude)
    ? `latitude="${latitude}" longitude="${longitude}"`
    : "";
  return `<firelink-map ${coordinates} ${annotations === undefined ? "" : `annotations="${h(JSON.stringify(annotations))}"`} label="${h(label)}" ${extra}></firelink-map>`;
}

class LocationMap extends HTMLElement {
  static observedAttributes = [
    "latitude",
    "longitude",
    "annotations",
    "label",
    "center-lat",
    "center-lng",
  ];
  private map?: L.Map;
  private layers?: L.LayerGroup;
  private observer?: IntersectionObserver;
  private resize?: ResizeObserver;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private root = this.attachShadow({ mode: "open" });
  private mode: MapAnnotation["type"] = "point";
  private active?: number;
  private selectedPoint?: number;
  private localChange = false;
  private drawing = false;
  constructor() {
    super();
    this.root.addEventListener("click", (event) => this.controlClick(event));
    // Coordinate entry is explicitly applied, independently of the enclosing task form.
    this.root.addEventListener("input", (event) => event.stopPropagation());
    this.root.addEventListener("change", (event) => event.stopPropagation());
    this.root.addEventListener("keydown", (event) => {
      if (
        (event as KeyboardEvent).key === "Enter" &&
        event.target instanceof HTMLInputElement
      ) {
        event.preventDefault();
        this.enterCoordinate(this.selectedPoint !== undefined);
      }
    });
  }
  private get annotations(): MapAnnotation[] {
    const raw = this.getAttribute("annotations");
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as MapAnnotation[];
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (mark) =>
              ["point", "path", "area"].includes(mark.type) &&
              Array.isArray(mark.coordinates) &&
              mark.coordinates.every((point) =>
                validCoordinates(point.latitude, point.longitude),
              ),
          )
        )
          return parsed;
      } catch {
        /* Invalid embedded data stays an empty map. */
      }
      return [];
    }
    const latitude = this.getAttribute("latitude"),
      longitude = this.getAttribute("longitude");
    return latitude?.trim() && longitude?.trim()
      ? mapAnnotations({
          latitude: Number(latitude),
          longitude: Number(longitude),
        })
      : [];
  }
  connectedCallback() {
    if (this.map || this.observer) return;
    const editable = this.hasAttribute("editable");
    this.root.innerHTML = `<link rel="stylesheet" href="/mng-dash/assets/leaflet.css"><style>
      :host{display:block;min-width:0;margin:16px 0;color:var(--on-surface,#1a1b20);font:inherit}
      *{box-sizing:border-box}[hidden]{display:none!important}.frame{border:1px solid var(--outline-variant,#c4c6d0);border-radius:16px;overflow:hidden;background:var(--surface,#f9f9ff)}
      .heading{display:flex;align-items:center;gap:12px;padding:12px 14px;font-size:.82rem;line-height:1.5}.label{flex:1;overflow-wrap:anywhere;font-weight:600}
      a{color:var(--primary,#445e91);text-underline-offset:3px}.external{flex-shrink:0;min-height:44px;display:inline-flex;align-items:center}
      .canvas{height:240px;isolation:isolate;background:var(--map-background,#e9e7ec);color:#1a1b20;font:14px/1.5 system-ui,sans-serif}
      :host([editable]) .canvas{height:300px;cursor:crosshair}.status,.hint{padding:9px 14px;font-size:.78rem;line-height:1.6;margin:0}.status:empty{display:none}.hint{color:var(--on-surface-variant,#44474f)}
      .tools,.coordinate-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px}.tools button{flex:1}.tools [data-action=finish]{flex-basis:100%}
      button,input{font:inherit;font-size:.82rem;color:inherit}button{min-height:44px;border:1px solid var(--outline-variant,#c4c6d0);border-radius:12px;padding:8px 12px;background:transparent;cursor:pointer}
      button[aria-pressed=true]{background:var(--primary-container,#d8e2ff);color:var(--on-primary-container,#2b4678);border-color:currentColor;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px;font-weight:650}button:disabled{opacity:.5;cursor:not-allowed}
      button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--primary,#445e91);outline-offset:2px}
      .annotation-list{padding:0 14px}.annotation-row{display:flex;gap:8px;margin-top:8px}.annotation-row>button:first-child{flex:1;text-align:left}.vertices{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.vertices button{min-width:44px}.selection{margin:12px 14px 0;font-size:.8rem}.selection button{margin-top:8px}
      .precise{margin:12px 14px}.precise summary{min-height:44px;display:list-item;padding:10px 0;cursor:pointer;font-size:.82rem}.coordinates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px}.coordinates label{font-size:.8rem;min-width:0}.coordinates input{display:block;width:100%;min-height:44px;margin-top:6px;border:1px solid var(--outline,#75777f);border-radius:8px;padding:8px;background:var(--surface,#f9f9ff)}.coordinate-actions{padding:0}.coordinate-actions button{flex:1}
      .leaflet-control-zoom a,.leaflet-touch .leaflet-bar a{width:44px;height:44px;line-height:44px;color:#1a1b20;background:#fff}.leaflet-control-attribution{font:10px/1.5 system-ui,sans-serif;max-width:100%;color:#333}.leaflet-control-attribution a{color:#0f448e}
      .pin{display:grid;place-items:center;width:24px;height:24px;background:var(--map-ink,#0f448e);color:white;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px #0005;font:650 11px/1 system-ui,sans-serif}.pin>span{transform:rotate(45deg)}
      .vertex{display:grid;place-items:center;width:24px;height:24px;background:var(--map-ink,#0f448e);color:white;border:2px solid white;border-radius:50%;font:600 12px/1 system-ui,sans-serif;box-shadow:0 2px 6px #0003}
      .location-marker:is([data-selected=true],:focus-visible)::after{content:"";position:absolute;inset:-6px;border:2px solid #1a1b20;outline:2px solid white;border-radius:50%;pointer-events:none}
      @media(max-width:360px){.coordinates{grid-template-columns:1fr}.tools,.coordinate-actions{gap:6px}.tools button{padding-inline:8px}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
      @media(forced-colors:active){.pin,.vertex{background:Highlight;color:HighlightText;border-color:Canvas;forced-color-adjust:none}.frame{border-color:CanvasText}button[aria-pressed=true]{border:3px double Highlight}.location-marker:is([data-selected=true],:focus-visible)::after{border-color:CanvasText;outline-color:Canvas}.location-outline{stroke:Canvas;forced-color-adjust:none}.location-path,.location-area{stroke:CanvasText;forced-color-adjust:none}}
    </style><div class="frame"><div class="heading"><span class="label"></span><a class="external" target="_blank" rel="noopener noreferrer"></a></div>${
      editable
        ? `<div class="tools" role="group" aria-label="标注类型">${Object.entries(
            mapAnnotationLabels,
          )
            .map(
              ([type, label]) =>
                `<button type="button" data-mode="${type}" aria-pressed="${type === this.mode}">${label}</button>`,
            )
            .join(
              "",
            )}<button type="button" data-action="finish" hidden>完成绘制</button></div><p class="hint" role="status"></p>`
        : ""
    }<div class="canvas" role="region"></div><p class="status" role="status"></p>${editable ? `<div class="annotation-list" role="group" aria-label="地图标注"></div><div class="selection"></div><details class="precise"><summary>输入坐标</summary><div class="coordinates"><label>纬度<input name="latitude" type="number" min="-90" max="90" step="any" required></label><label>经度<input name="longitude" type="number" min="-180" max="180" step="any" required></label></div><div class="coordinate-actions"><button type="button" data-action="add-coordinate">添加点位</button><button type="button" data-action="update-coordinate" hidden>更新所选点</button></div></details>` : ""}</div>`;
    this.updateText();
    this.updateControls();
    const styles = new Promise<void>((resolve) => {
      const link = this.root.querySelector("link")!;
      link.onload = () => resolve();
      link.onerror = () => resolve();
    });
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.observer?.disconnect();
      void styles.then(() => {
        if (this.isConnected && !this.map) this.initialize();
      });
    });
    this.observer.observe(this);
  }
  disconnectedCallback() {
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.observer?.disconnect();
      this.observer = undefined;
      this.resize?.disconnect();
      clearTimeout(this.fallbackTimer);
      this.map?.remove();
      this.map = undefined;
      this.layers = undefined;
    });
  }
  attributeChangedCallback(
    name: string,
    previous: string | null,
    next: string | null,
  ) {
    if (previous === next) return;
    this.updateText();
    if (
      name === "label" ||
      ((name === "latitude" || name === "longitude") &&
        this.hasAttribute("annotations"))
    )
      return;
    this.updateControls();
    this.updatePosition(!this.localChange);
  }
  private updateText() {
    const label = this.getAttribute("label") || "地图";
    const text = this.root.querySelector(".label");
    if (text) text.textContent = label;
    this.root
      .querySelector(".canvas")
      ?.setAttribute(
        "aria-label",
        this.hasAttribute("editable")
          ? `${label}，点击选点绘制位置、路径或范围，也可使用下方坐标输入`
          : `${label}地图`,
      );
    const link = this.root.querySelector<HTMLAnchorElement>(".external");
    const marks = this.annotations,
      point = marks[0]?.coordinates[0];
    if (link) {
      link.hidden = !point;
      link.textContent =
        marks.length === 1 && marks[0].type === "point"
          ? "打开地图 ↗"
          : "查看首个点 ↗";
      if (point)
        link.href = `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=15/${point.latitude}/${point.longitude}`;
    }
  }
  private updateControls() {
    if (!this.root.querySelector(".tools")) return;
    const marks = this.annotations;
    if (this.active !== undefined && !marks[this.active])
      this.active = undefined;
    const active = this.active === undefined ? undefined : marks[this.active];
    if (
      !active ||
      this.selectedPoint === undefined ||
      !active.coordinates[this.selectedPoint]
    )
      this.selectedPoint = undefined;
    this.root
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.mode === this.mode),
        ),
      );
    const finish = this.root.querySelector<HTMLButtonElement>(
      '[data-action="finish"]',
    )!;
    finish.hidden = this.mode === "point";
    finish.disabled = !active || !completeMapAnnotation(active);
    finish.textContent = `完成${mapAnnotationLabels[this.mode]}`;
    const count = active?.coordinates.length ?? 0;
    this.root.querySelector(".hint")!.textContent =
      this.mode === "point"
        ? "点击地图添加位置，可添加多个位置。拖动标记可调整坐标。"
        : `依次点击地图选点，至少 ${mapMinimumPoints[this.mode]} 个${this.mode === "area" ? "不共线的" : "不同"}点${this.mode === "area" ? "围成范围" : "连成路径"}。${count ? `已选 ${count} 个点，完成后可继续添加其他标注。` : ""}`;
    this.root.querySelector(".annotation-list")!.innerHTML = marks
      .map(
        (mark, index) =>
          `<div class="annotation-row"><button type="button" data-select="${index}" aria-pressed="${index === this.active}">${mapAnnotationLabels[mark.type]} ${index + 1}${mark.type === "point" ? "" : ` · ${mark.coordinates.length} 个点`}${completeMapAnnotation(mark) ? "" : " · 未完成"}</button><button type="button" data-remove="${index}" aria-label="删除${mapAnnotationLabels[mark.type]} ${index + 1}">删除</button></div>`,
      )
      .join("");
    this.root.querySelector(".selection")!.innerHTML = active
      ? `<div>选中${mapAnnotationLabels[active.type]} ${this.active! + 1}${this.selectedPoint === undefined ? "" : `，第 ${this.selectedPoint + 1} 个点`}</div><div class="vertices" role="group" aria-label="选取顶点">${active.coordinates.map((_, index) => `<button type="button" data-point="${index}" aria-label="选择第 ${index + 1} 个点" aria-pressed="${index === this.selectedPoint}">${index + 1}</button>`).join("")}</div>${this.selectedPoint === undefined ? "" : '<button type="button" data-action="remove-point">删除所选点</button>'}`
      : "";
    const point =
      this.selectedPoint === undefined
        ? undefined
        : active?.coordinates[this.selectedPoint];
    for (const name of ["latitude", "longitude"] as const)
      this.root.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value =
        point ? String(point[name]) : "";
    this.root.querySelector<HTMLButtonElement>(
      '[data-action="update-coordinate"]',
    )!.hidden = !point;
    this.updateMarkerSelection();
  }
  private updateMarkerSelection() {
    this.root
      .querySelectorAll<HTMLElement>(".location-marker")
      .forEach((marker) => {
        marker.dataset.selected = String(
          Number(marker.dataset.annotation) === this.active &&
            Number(marker.dataset.point) === this.selectedPoint,
        );
      });
  }
  private controlClick(event: Event) {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button || button.disabled) return;
    const marks = this.annotations;
    if (button.dataset.mode) {
      this.mode = button.dataset.mode as MapAnnotation["type"];
      this.drawing = true;
      this.active = undefined;
      this.selectedPoint = undefined;
    } else if (button.dataset.select !== undefined) {
      this.active = Number(button.dataset.select);
      this.mode = marks[this.active].type;
      this.drawing = false;
      this.selectedPoint = marks[this.active].coordinates.length - 1;
    } else if (button.dataset.point !== undefined)
      this.selectedPoint = Number(button.dataset.point);
    else if (button.dataset.remove !== undefined) {
      marks.splice(Number(button.dataset.remove), 1);
      this.active = undefined;
      this.selectedPoint = undefined;
      this.commit(marks);
      this.root
        .querySelector<HTMLButtonElement>(`[data-mode="${this.mode}"]`)
        ?.focus();
      return;
    } else if (button.dataset.action === "finish") {
      this.drawing = false;
      this.active = undefined;
      this.selectedPoint = undefined;
      this.root
        .querySelector<HTMLButtonElement>(`[data-mode="${this.mode}"]`)
        ?.focus();
    } else if (
      button.dataset.action === "remove-point" &&
      this.active !== undefined &&
      this.selectedPoint !== undefined
    ) {
      marks[this.active].coordinates.splice(this.selectedPoint, 1);
      if (!marks[this.active].coordinates.length) {
        marks.splice(this.active, 1);
        this.active = undefined;
      }
      this.selectedPoint = undefined;
      this.commit(marks);
      this.root
        .querySelector<HTMLButtonElement>(`[data-mode="${this.mode}"]`)
        ?.focus();
      return;
    } else if (
      button.dataset.action === "add-coordinate" ||
      button.dataset.action === "update-coordinate"
    ) {
      this.enterCoordinate(button.dataset.action === "update-coordinate");
      return;
    } else return;
    this.updateControls();
    for (const key of ["select", "point"] as const) {
      if (button.dataset[key] !== undefined)
        this.root
          .querySelector<HTMLButtonElement>(
            `[data-${key}="${button.dataset[key]}"]`,
          )
          ?.focus({ preventScroll: true });
    }
  }
  private enterCoordinate(update: boolean) {
    const lat = this.root.querySelector<HTMLInputElement>('[name="latitude"]')!,
      lng = this.root.querySelector<HTMLInputElement>('[name="longitude"]')!;
    if (!lat.reportValidity() || !lng.reportValidity()) return;
    const point = { latitude: Number(lat.value), longitude: Number(lng.value) };
    if (
      update &&
      this.active !== undefined &&
      this.selectedPoint !== undefined
    ) {
      const marks = this.annotations;
      marks[this.active].coordinates[this.selectedPoint] = point;
      this.commit(marks);
    } else this.addPoint(point);
    this.map?.panTo([point.latitude, point.longitude], { animate: false });
  }
  private addPoint(point: MapCoordinate) {
    this.drawing = true;
    const marks = this.annotations;
    if (this.mode === "point" || this.active === undefined) {
      if (marks.length >= MAX_MAP_ANNOTATIONS)
        return this.message(`每张地图最多添加 ${MAX_MAP_ANNOTATIONS} 组标注`);
      marks.push({ type: this.mode, coordinates: [point] });
      this.active = marks.length - 1;
    } else {
      if (marks[this.active].coordinates.length >= MAX_MAP_POINTS)
        return this.message(`每组标注最多添加 ${MAX_MAP_POINTS} 个点`);
      marks[this.active].coordinates.push(point);
    }
    this.selectedPoint = marks[this.active].coordinates.length - 1;
    this.commit(marks);
  }
  private message(text: string) {
    const status = this.root.querySelector(".status");
    if (status) status.textContent = text;
  }
  private commit(annotations: MapAnnotation[]) {
    this.localChange = true;
    this.setAttribute("annotations", JSON.stringify(annotations));
    this.localChange = false;
    this.updateControls();
    this.dispatchEvent(
      new CustomEvent("mapchange", { bubbles: true, detail: { annotations } }),
    );
  }
  private initialize() {
    const editable = this.hasAttribute("editable");
    const centerLat = Number(this.getAttribute("center-lat")),
      centerLng = Number(this.getAttribute("center-lng"));
    const center: L.LatLngTuple =
      this.hasAttribute("center-lat") && validCoordinates(centerLat, centerLng)
        ? [centerLat, centerLng]
        : [35, 105];
    this.map = L.map(this.root.querySelector<HTMLElement>(".canvas")!, {
      scrollWheelZoom: false,
      dragging: editable || !matchMedia("(pointer:coarse)").matches,
      zoomControl: true,
      attributionControl: true,
    }).setView(center, this.hasAttribute("center-lat") ? 14 : 4);
    this.layers = L.layerGroup().addTo(this.map);
    this.map.attributionControl.setPrefix(false);
    if (!navigator.onLine) this.message("地图暂不可用");
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        referrerPolicy: "strict-origin-when-cross-origin",
        keepBuffer: 0,
      },
    ).addTo(this.map);
    this.fallbackTimer = setTimeout(
      () => this.message("地图暂不可用，可稍后重试"),
      12000,
    );
    tiles.on("tileload", () => {
      clearTimeout(this.fallbackTimer);
      this.message("");
    });
    tiles.on("tileerror", () => this.message("地图暂不可用，可打开地图查看"));
    this.root
      .querySelector(".leaflet-control-zoom-in")
      ?.setAttribute("aria-label", "放大地图");
    this.root
      .querySelector(".leaflet-control-zoom-out")
      ?.setAttribute("aria-label", "缩小地图");
    if (editable)
      this.map.on("click", (event: L.LeafletMouseEvent) =>
        this.addPoint({
          latitude: Number(
            Math.max(-90, Math.min(90, event.latlng.lat)).toFixed(6),
          ),
          longitude: Number(event.latlng.wrap().lng.toFixed(6)),
        }),
      );
    this.updatePosition(true);
    let width = this.clientWidth;
    this.resize = new ResizeObserver(() => {
      this.map?.invalidateSize({ pan: false });
      if (width !== this.clientWidth) {
        width = this.clientWidth;
        this.updatePosition(true);
      }
    });
    this.resize.observe(this);
  }
  private updatePosition(fit: boolean) {
    if (!this.map || !this.layers) return;
    this.layers.clearLayers();
    const allPoints: L.LatLngTuple[] = [];
    this.annotations.forEach((mark, index) => {
      const points: L.LatLngTuple[] = mark.coordinates.map((point) => [
        point.latitude,
        point.longitude,
      ]);
      allPoints.push(...points);
      if (mark.type !== "point" && points.length > 1) {
        const polygon = mark.type === "area" && completeMapAnnotation(mark);
        const draw = (options: L.PolylineOptions) =>
          polygon ? L.polygon(points, options) : L.polyline(points, options);
        // The basemap stays light in both themes. A white casing and dark stroke
        // remain distinguishable over light streets and dark map features.
        draw({
          color: "#fff",
          weight: 7,
          opacity: 1,
          fill: false,
          interactive: false,
          className: "location-outline",
        }).addTo(this.layers!);
        const options = {
          color: MAP_INK,
          weight: 3,
          fillOpacity: 0.16,
          dashArray: !completeMapAnnotation(mark)
            ? "4 4"
            : polygon
              ? "8 5"
              : undefined,
          className: mark.type === "area" ? "location-area" : "location-path",
        };
        draw(options).addTo(this.layers!);
      }
      points.forEach((point, pointIndex) => {
        const label = `${mapAnnotationLabels[mark.type]} ${index + 1}，第 ${pointIndex + 1} 个点`;
        const marker = L.marker(point, {
          draggable: this.hasAttribute("editable"),
          title: label,
          alt: label,
          icon: L.divIcon({
            html:
              mark.type === "point"
                ? `<span class="pin"><span>${index + 1}</span></span>`
                : `<span class="vertex">${pointIndex + 1}</span>`,
            className: "location-marker",
            iconSize: [24, 28],
            iconAnchor: [12, mark.type === "point" ? 26 : 12],
          }),
        }).addTo(this.layers!);
        const element = marker.getElement();
        if (element) {
          element.dataset.annotation = String(index);
          element.dataset.point = String(pointIndex);
        }
        if (this.hasAttribute("editable")) {
          marker.on("click", () => {
            if (this.drawing && this.mode !== "point") {
              if (
                this.mode === "area" &&
                this.active === index &&
                pointIndex === 0 &&
                completeMapAnnotation(mark)
              ) {
                this.drawing = false;
                this.active = undefined;
                this.selectedPoint = undefined;
                this.updateControls();
              } else this.addPoint(mark.coordinates[pointIndex]);
              return;
            }
            this.active = index;
            this.mode = mark.type;
            this.selectedPoint = pointIndex;
            this.updateControls();
          });
          marker.on("dragend", () => {
            const next = this.annotations,
              position = marker.getLatLng();
            next[index].coordinates[pointIndex] = {
              latitude: Number(
                Math.max(-90, Math.min(90, position.lat)).toFixed(6),
              ),
              longitude: Number(position.wrap().lng.toFixed(6)),
            };
            this.active = index;
            this.mode = mark.type;
            this.selectedPoint = pointIndex;
            this.commit(next);
          });
        }
      });
    });
    this.updateMarkerSelection();
    if (fit && allPoints.length)
      this.map.fitBounds(L.latLngBounds(allPoints), {
        padding: [28, 28],
        maxZoom: 15,
        animate: false,
      });
    else if (!allPoints.length) {
      const lat = this.getAttribute("center-lat"),
        lng = this.getAttribute("center-lng");
      if (lat && lng && validCoordinates(Number(lat), Number(lng)))
        this.map.setView([Number(lat), Number(lng)], 14, { animate: false });
    }
  }
}
customElements.define("firelink-map", LocationMap);

/** Keep maps and video playback intact when unrelated text fields change. */
export function updatePreview(host: Element, html: string) {
  const previous = Array.from(host.querySelectorAll("firelink-map, video"));
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("firelink-map, video").forEach((next) => {
    const index = previous.findIndex((old) => old.outerHTML === next.outerHTML);
    if (index >= 0) next.replaceWith(previous.splice(index, 1)[0]);
  });
  host.replaceChildren(template.content);
}
