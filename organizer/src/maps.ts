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
import type { LocationResult } from "../../shared/locations";
import { lookupLocations } from "./locations";
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
    "region-code",
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
  private searchRequest?: AbortController;
  private searchResults: LocationResult[] = [];
  constructor() {
    super();
    this.root.addEventListener("click", (event) => this.controlClick(event));
    // Searching must not dirty or submit the enclosing task form.
    this.root.addEventListener("input", (event) => {
      event.stopPropagation();
      if ((event.target as HTMLInputElement).name === "address-search")
        this.cancelSearch();
    });
    this.root.addEventListener("change", (event) => event.stopPropagation());
    this.root.addEventListener("keydown", (event) => {
      if (
        (event as KeyboardEvent).key === "Enter" &&
        event.target instanceof HTMLInputElement
      ) {
        event.preventDefault();
        event.stopPropagation();
        void this.search();
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
      *{box-sizing:border-box}[hidden]{display:none!important}.frame{border:1px solid var(--outline-variant,#c4c6d0);border-radius:var(--radius-field,12px);overflow:hidden;background:var(--surface,#f9f9ff)}
      .heading{display:flex;align-items:center;gap:12px;padding:12px 14px;font-size:.82rem;line-height:1.5}.label{flex:1;overflow-wrap:anywhere;font-weight:600}
      a{color:var(--primary,#445e91);text-underline-offset:3px}.external{flex-shrink:0;min-height:44px;display:inline-flex;align-items:center}
      .canvas{height:240px;isolation:isolate;background:var(--map-background,#e9e7ec);color:#1a1b20;font:14px/1.5 system-ui,sans-serif}
      :host([editable]) .canvas{height:300px;cursor:crosshair}.status,.hint{padding:9px 14px;font-size:.78rem;line-height:1.6;margin:0}.status:empty{display:none}.hint{color:var(--on-surface-variant,#44474f)}
      .tools{display:flex;gap:8px;flex-wrap:wrap;padding:0 14px}.tools button{flex:1}.tools [data-action=finish]{flex-basis:100%}
      button,input{font:inherit;color:inherit}button{min-height:var(--control-height,44px);max-width:100%;font-size:var(--font-control,.9rem);font-weight:var(--weight-control,550);line-height:1.4;border:1px solid var(--outline-variant,#c4c6d0);border-radius:var(--radius-action,999px);padding:8px 16px;background:transparent;cursor:pointer;overflow-wrap:anywhere}
      button[aria-pressed=true]{background:var(--primary,#445e91);color:var(--on-primary,#fff);border-color:var(--primary,#445e91);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px;font-weight:650}button:disabled{opacity:.5;cursor:not-allowed}
      button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:var(--focus-width,3px) solid var(--primary,#445e91);outline-offset:var(--focus-offset,3px)}
      .annotation-list{padding:0 14px}.annotation-row{display:flex;gap:8px;margin-top:8px}.annotation-row>button:first-child{flex:1;text-align:left}.vertices{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.vertices button{min-width:44px}.selection{margin:12px 14px 0;font-size:.8rem}.selection button{margin-top:8px}
      .search{padding:14px}.search label{display:block;font-size:.82rem;margin-bottom:8px}.search-row{display:flex;gap:8px;align-items:center}.search input{min-width:0;flex:1;min-height:var(--field-height,3rem);border:1px solid var(--outline,#75777f);border-radius:var(--radius-field,12px);padding:10px 12px;background:var(--surface,#f9f9ff);caret-color:var(--primary,#445e91)}.search input::placeholder{color:var(--on-surface-variant,#44474f)}
      .search-status,.search-attribution{font-size:.78rem;line-height:1.6;margin:8px 0 0;overflow-wrap:anywhere}.search-status:empty{display:none}.search-results{list-style:none;padding:0;margin:8px 0 0}.search-results button{display:block;width:100%;text-align:left;border-radius:var(--radius-field,12px);margin-top:8px}.search-results strong,.search-results span{display:block}.search-results span{font-size:.8rem;line-height:1.5;margin-top:4px;color:var(--on-surface-variant,#44474f)}button:hover:not(:disabled){background:var(--surface-container-high,#e7e7ef)}button[aria-pressed=true]:hover{background:var(--primary,#445e91)}::selection{background:var(--primary-container,#d8e2ff);color:var(--on-primary-container,#001a41)}
      .leaflet-control-zoom a,.leaflet-touch .leaflet-bar a{width:44px;height:44px;line-height:44px;color:#1a1b20;background:#fff}.leaflet-control-attribution{font:10px/1.5 system-ui,sans-serif;max-width:100%;color:#333}.leaflet-control-attribution a{color:#0f448e}
      .pin{display:grid;place-items:center;width:24px;height:24px;background:var(--map-ink,#0f448e);color:white;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px #0005;font:650 11px/1 system-ui,sans-serif}.pin>span{transform:rotate(45deg)}
      .vertex{display:grid;place-items:center;width:24px;height:24px;background:var(--map-ink,#0f448e);color:white;border:2px solid white;border-radius:50%;font:600 12px/1 system-ui,sans-serif;box-shadow:0 2px 6px #0003}
      .location-marker:is([data-selected=true],:focus-visible)::after{content:"";position:absolute;inset:-6px;border:2px solid #1a1b20;outline:2px solid white;border-radius:50%;pointer-events:none}
      @media(max-width:360px){.tools{gap:6px}.tools button{padding-inline:8px}}
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
    }<div class="canvas" role="region"></div><p class="status" role="status"></p>${editable ? `<div class="search"><label for="address-search">搜索地址</label><div class="search-row"><input id="address-search" name="address-search" type="search" maxlength="150" placeholder="搜索街道或建筑" autocomplete="off"><button type="button" data-action="search">搜索</button></div><p class="search-status" role="status" aria-live="polite"></p><ul class="search-results" aria-label="地址搜索结果" hidden></ul><p class="search-attribution">地址搜索 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · Nominatim</p></div><div class="annotation-list" role="group" aria-label="地图标注"></div><div class="selection"></div>` : ""}</div>`;
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
      this.cancelSearch();
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
    if (name === "region-code" || name.startsWith("center-"))
      this.cancelSearch();
    this.updateText();
    if (
      name === "region-code" ||
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
          ? `${label}，点击选点绘制位置、路径或范围，也可使用下方地址搜索`
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
        ? "点击地图或选择搜索结果添加位置。拖动标记可调整位置。"
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
    if (button.dataset.action === "search") {
      void this.search();
      return;
    }
    if (button.dataset.place !== undefined) {
      const place = this.searchResults[Number(button.dataset.place)];
      if (!place) return;
      if (
        !this.addPoint({ latitude: place.latitude, longitude: place.longitude })
      )
        return;
      this.map?.setView([place.latitude, place.longitude], 16, {
        animate: false,
      });
      this.cancelSearch();
      this.searchMessage(`已选：${place.address}`);
      this.root
        .querySelector<HTMLElement>(".canvas")
        ?.focus({ preventScroll: true });
      return;
    }
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
  private searchMessage(text: string) {
    const status = this.root.querySelector(".search-status");
    if (status) status.textContent = text;
  }
  private cancelSearch() {
    this.searchRequest?.abort();
    this.searchResults = [];
    const results = this.root.querySelector<HTMLElement>(".search-results");
    if (results) {
      results.replaceChildren();
      results.hidden = true;
    }
    const button = this.root.querySelector<HTMLButtonElement>(
      '[data-action="search"]',
    );
    if (button) button.disabled = false;
    this.searchMessage("");
  }
  private async search() {
    const input = this.root.querySelector<HTMLInputElement>(
      '[name="address-search"]',
    );
    const query = input?.value.trim();
    if (!query) {
      input?.focus();
      return;
    }
    this.cancelSearch();
    const request = new AbortController();
    this.searchRequest = request;
    const button = this.root.querySelector<HTMLButtonElement>(
      '[data-action="search"]',
    )!;
    button.disabled = true;
    this.searchMessage("正在搜索地址…");
    try {
      const places = await lookupLocations(
        {
          kind: "search",
          query,
          regionCode: this.getAttribute("region-code") || undefined,
        },
        request.signal,
      );
      if (request.signal.aborted || !this.isConnected) return;
      this.searchResults = places;
      const results = this.root.querySelector<HTMLElement>(".search-results")!;
      results.innerHTML = places
        .map(
          (place, index) =>
            `<li><button type="button" data-place="${index}"><strong>${h(place.name)}</strong><span>${h(place.address)}</span></button></li>`,
        )
        .join("");
      results.hidden = !places.length;
      this.searchMessage(
        places.length
          ? `找到 ${places.length} 个地址，选择后添加点位。`
          : "未找到地址，请换个关键词，或点击地图选点。",
      );
    } catch (error) {
      if (!request.signal.aborted && this.isConnected)
        this.searchMessage(
          error instanceof Error
            ? error.message
            : "搜索暂不可用，请稍后重试或点击地图选点。",
        );
    } finally {
      if (!request.signal.aborted) button.disabled = false;
    }
  }
  private addPoint(point: MapCoordinate) {
    this.drawing = true;
    const marks = this.annotations;
    if (this.mode === "point" || this.active === undefined) {
      if (marks.length >= MAX_MAP_ANNOTATIONS) {
        this.message(`每张地图最多添加 ${MAX_MAP_ANNOTATIONS} 组标注`);
        return false;
      }
      marks.push({ type: this.mode, coordinates: [point] });
      this.active = marks.length - 1;
    } else {
      if (marks[this.active].coordinates.length >= MAX_MAP_POINTS) {
        this.message(`每组标注最多添加 ${MAX_MAP_POINTS} 个点`);
        return false;
      }
      marks[this.active].coordinates.push(point);
    }
    this.selectedPoint = marks[this.active].coordinates.length - 1;
    this.commit(marks);
    return true;
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
