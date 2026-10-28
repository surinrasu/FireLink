import * as L from "leaflet";
import { h } from "./html";

export function validCoordinates(
  latitude: unknown,
  longitude: unknown,
): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
export function mapPreview(
  latitude?: number,
  longitude?: number,
  label = "位置",
  extra = "",
) {
  if (!validCoordinates(latitude, longitude) && !extra.includes("editable"))
    return '<p class="muted">未标记位置</p>';
  const coordinates = validCoordinates(latitude, longitude)
    ? `latitude="${latitude}" longitude="${longitude}"`
    : "";
  return `<firelink-map ${coordinates} label="${h(label)}" ${extra}></firelink-map>`;
}

class LocationMap extends HTMLElement {
  static observedAttributes = [
    "latitude",
    "longitude",
    "label",
    "center-lat",
    "center-lng",
  ];
  private map?: L.Map;
  private marker?: L.Marker;
  private observer?: IntersectionObserver;
  private resize?: ResizeObserver;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private root = this.attachShadow({ mode: "open" });
  private get coordinates(): [number, number] | undefined {
    const lat = this.getAttribute("latitude"),
      lng = this.getAttribute("longitude");
    return lat?.trim() &&
      lng?.trim() &&
      validCoordinates(Number(lat), Number(lng))
      ? [Number(lat), Number(lng)]
      : undefined;
  }
  connectedCallback() {
    if (this.map || this.observer) return;
    this.root.innerHTML = `<link rel="stylesheet" href="/assets/leaflet.css"><style>
      :host{display:block;min-width:0;margin:16px 0;color:var(--on-surface,#242722);font:inherit}
      *{box-sizing:border-box}[hidden]{display:none!important}.frame{border:1px solid var(--outline-variant,#d5d9ce);border-radius:16px;overflow:hidden;background:var(--surface,#fbf8f4)}
      .heading{display:flex;align-items:center;gap:12px;padding:12px 14px;font-size:.82rem;line-height:1.5}.label{flex:1;overflow-wrap:anywhere;font-weight:600}
      a{color:var(--primary,#93462e);text-underline-offset:3px}.external{flex-shrink:0;min-height:24px;display:inline-flex;align-items:center}
      .canvas{height:240px;isolation:isolate;background:#e7e9df;color:#232923;font:14px/1.5 system-ui,sans-serif}
      :host([editable]) .canvas{height:280px;cursor:crosshair}.status{padding:9px 14px;font-size:.78rem;line-height:1.5;margin:0}.status:empty{display:none}
      .leaflet-control-zoom a,.leaflet-touch .leaflet-bar a{width:44px;height:44px;line-height:44px;color:#263026;background:#fff}.leaflet-control-attribution{font:10px/1.5 system-ui,sans-serif;max-width:100%;color:#333}.leaflet-control-attribution a{color:#265a52}
      .pin{width:24px;height:24px;background:#a3452d;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px #0005}.pin:after{content:"";display:block;width:6px;height:6px;background:#fff;border-radius:50%;margin:6px}
      @media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
      @media(forced-colors:active){.pin{background:Highlight;border-color:CanvasText}.frame{border-color:CanvasText}}
    </style><div class="frame"><div class="heading"><span class="label"></span><a class="external" target="_blank" rel="noopener noreferrer">打开地图 ↗</a></div><div class="canvas" role="region"></div><p class="status" role="status"></p></div>`;
    this.updateText();
    const styles = new Promise<void>((resolve) => {
      const link = this.root.querySelector("link")!;
      link.onload = () => resolve();
      link.onerror = () => resolve();
    });
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this.observer?.disconnect();
        void styles.then(() => {
          if (this.isConnected && !this.map) this.initialize();
        });
      },
      { rootMargin: "0px" },
    );
    this.observer.observe(this);
  }
  disconnectedCallback() {
    // Preserve instances moved into a freshly rendered preview in the same turn.
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.observer?.disconnect();
      this.observer = undefined;
      this.resize?.disconnect();
      clearTimeout(this.fallbackTimer);
      this.map?.remove();
      this.map = undefined;
      this.marker = undefined;
    });
  }
  attributeChangedCallback(
    name: string,
    previous: string | null,
    next: string | null,
  ) {
    if (previous === next) return;
    this.updateText();
    if (name !== "label") this.updatePosition();
  }
  private updateText() {
    const label = this.getAttribute("label") || "位置";
    const text = this.root.querySelector(".label");
    if (text) text.textContent = label;
    this.root
      .querySelector(".canvas")
      ?.setAttribute(
        "aria-label",
        this.hasAttribute("editable")
          ? `${label}，点击地图标记，可用下方经纬度输入精确位置`
          : `${label}地图`,
      );
    const link = this.root.querySelector<HTMLAnchorElement>(".external");
    if (link) {
      link.hidden = !this.coordinates;
      if (this.coordinates) {
        const [lat, lng] = this.coordinates;
        link.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;
      }
    }
  }
  private initialize() {
    const editable = this.hasAttribute("editable");
    const centerLat = Number(this.getAttribute("center-lat")),
      centerLng = Number(this.getAttribute("center-lng"));
    const center: [number, number] | undefined =
      this.hasAttribute("center-lat") && validCoordinates(centerLat, centerLng)
        ? [centerLat, centerLng]
        : undefined;
    const position = this.coordinates || center || [35, 105];
    this.map = L.map(this.root.querySelector<HTMLElement>(".canvas")!, {
      scrollWheelZoom: false,
      dragging: editable || !matchMedia("(pointer:coarse)").matches,
      zoomControl: true,
      attributionControl: true,
    }).setView(position, this.coordinates || center ? 14 : 4);
    this.map.attributionControl.setPrefix(false);
    const status = this.root.querySelector<HTMLElement>(".status")!;
    const hint = editable ? "点击地图标记位置" : "";
    status.textContent = navigator.onLine ? hint : "地图暂不可用";
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
    this.fallbackTimer = setTimeout(() => {
      status.textContent = "地图暂不可用，可稍后重试";
    }, 12000);
    tiles.on("tileload", () => {
      clearTimeout(this.fallbackTimer);
      status.textContent = hint;
    });
    tiles.on("tileerror", () => {
      status.textContent = "地图暂不可用，可打开地图查看";
    });
    this.root
      .querySelector(".leaflet-control-zoom-in")
      ?.setAttribute("aria-label", "放大地图");
    this.root
      .querySelector(".leaflet-control-zoom-out")
      ?.setAttribute("aria-label", "缩小地图");
    if (editable)
      this.map.on("click", (e: L.LeafletMouseEvent) => this.choose(e.latlng));
    this.updatePosition();
    this.resize = new ResizeObserver(() =>
      this.map?.invalidateSize({ pan: false }),
    );
    this.resize.observe(this);
  }
  private choose(point: L.LatLng) {
    const latitude = Number(Math.max(-90, Math.min(90, point.lat)).toFixed(6));
    const longitude = Number(point.wrap().lng.toFixed(6));
    this.setAttribute("latitude", String(latitude));
    this.setAttribute("longitude", String(longitude));
    this.dispatchEvent(
      new CustomEvent("locationchange", {
        bubbles: true,
        detail: { latitude, longitude },
      }),
    );
  }
  private updatePosition() {
    if (!this.map) return;
    const point = this.coordinates;
    if (!point) {
      this.marker?.remove();
      this.marker = undefined;
      const lat = this.getAttribute("center-lat"),
        lng = this.getAttribute("center-lng");
      if (lat && lng && validCoordinates(Number(lat), Number(lng)))
        this.map.setView([Number(lat), Number(lng)], 14, { animate: false });
      return;
    }
    if (!this.marker) {
      this.marker = L.marker(point, {
        draggable: this.hasAttribute("editable"),
        title: "标记位置",
        alt: "标记位置",
        icon: L.divIcon({
          html: '<div class="pin"></div>',
          className: "location-marker",
          iconSize: [28, 34],
          iconAnchor: [12, 29],
        }),
      }).addTo(this.map);
      this.marker.on("dragend", () => this.choose(this.marker!.getLatLng()));
    } else this.marker.setLatLng(point);
    this.map.panTo(point, { animate: false });
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
