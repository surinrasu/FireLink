import * as L from "leaflet";
import type { Incident } from "../../shared/organizer";
import { validCoordinates } from "../../shared/maps";
import { h } from "./html";
import { icon } from "./ui";

export interface IncidentMapView {
  center: L.LatLngTuple;
  zoom: number;
  selection: string;
  fitted: boolean;
}

export function mountIncidentMap(
  host: HTMLElement,
  incidents: Incident[],
  initialSelection: Set<string> | null,
  onSelect: (id: string) => void,
  savedView: IncidentMapView | undefined,
  onViewChange: (view: IncidentMapView) => void,
) {
  host.innerHTML = `<div class="incident-map-canvas" role="region" aria-label="事件位置地图"></div><div class="incident-map-footer"><p class="incident-map-status" role="status"></p><button type="button" class="transparent incident-map-reset">${icon("center_focus_strong")}<span>回到全部事件</span></button></div>`;
  const canvas = host.querySelector<HTMLElement>(".incident-map-canvas")!;
  const message = host.querySelector<HTMLElement>(".incident-map-status")!;
  const reset = host.querySelector<HTMLButtonElement>(".incident-map-reset")!;
  let selected = initialSelection === null ? null : new Set(initialSelection);
  const selectionKey = () =>
    selected === null ? "all" : JSON.stringify([...selected].sort());
  let selection = selectionKey();
  let fitted = savedView?.selection === selection ? savedView.fitted : true;
  let fitting = false;
  let resizing = false;
  const points = incidents.filter((incident) =>
    validCoordinates(incident.latitude, incident.longitude),
  );
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const map = L.map(canvas, {
    scrollWheelZoom: false,
    zoomAnimation: !reducedMotion,
    fadeAnimation: !reducedMotion,
    markerZoomAnimation: !reducedMotion,
  });
  map.attributionControl.setPrefix(false);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    referrerPolicy: "strict-origin-when-cross-origin",
    keepBuffer: 0,
  });
  let tileMessage = "";
  let needsFit = false;
  let fallback: ReturnType<typeof setTimeout>;
  const targets = () =>
    selected === null
      ? points
      : points.filter((point) => selected!.has(point.id));
  const updateMessage = () => {
    const wanted = selected === null ? incidents.length : selected.size;
    const missing = wanted - targets().length;
    message.textContent = [
      selected?.size === 0 ? "尚未选择事件" : "",
      missing ? `${missing} 个事件暂无有效位置` : "",
      tileMessage,
    ]
      .filter(Boolean)
      .join("；");
    reset.disabled = !targets().length;
    reset.querySelector("span")!.textContent =
      selected === null ? "回到全部事件" : "回到所选事件";
  };
  tiles.on("tileerror", () => {
    clearTimeout(fallback);
    tileMessage = "底图暂不可用，仍可按事件筛选任务";
    updateMessage();
  });
  tiles.on("tileload", () => {
    clearTimeout(fallback);
    tileMessage = "";
    updateMessage();
  });
  tiles.on("loading", () => {
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      tileMessage = "底图加载较慢，仍可按事件筛选任务";
      updateMessage();
    }, 12000);
  });
  tiles.on("load", () => clearTimeout(fallback));
  map.on("movestart", () => {
    if (!fitting && !resizing) fitted = false;
  });
  const saveView = () => {
    const center = map.getCenter();
    onViewChange({
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
      selection,
      fitted,
    });
  };
  map.on("moveend", saveView);
  const fit = () => {
    fitted = true;
    if (!canvas.clientWidth || !canvas.clientHeight) {
      needsFit = true;
      return;
    }
    needsFit = false;
    const locations = targets();
    if (locations.length) {
      fitting = true;
      map.fitBounds(
        L.latLngBounds(
          locations.map((incident) => [incident.latitude, incident.longitude]),
        ),
        {
          padding: [40, 40],
          maxZoom: 11,
          animate: false,
        },
      );
      fitting = false;
    }
  };
  const markers = points.map((incident) => {
    const marker = L.marker([incident.latitude, incident.longitude], {
      title: incident.title,
      alt: incident.title,
      autoPanOnFocus: false,
      icon: L.divIcon({
        className: "incident-map-marker",
        html: '<span class="incident-map-pin" aria-hidden="true"></span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    }).addTo(map);
    marker.bindTooltip(h(incident.title), {
      direction: "top",
      offset: [0, -12],
    });
    marker.on("click", () => onSelect(incident.id));
    return { incident, marker };
  });
  const updateSelection = (next: Set<string> | null, shouldFit = true) => {
    selected = next === null ? null : new Set(next);
    selection = selectionKey();
    for (const { incident, marker } of markers) {
      const element = marker.getElement();
      if (!element) continue;
      const active = selected === null || selected.has(incident.id);
      element.setAttribute("aria-label", incident.title);
      element.setAttribute("aria-pressed", String(active));
      element.classList.toggle("is-muted", !active);
      element.classList.toggle("is-selected", active);
      marker.setZIndexOffset(active ? 1000 : 0);
    }
    updateMessage();
    if (shouldFit) fit();
  };
  if (savedView?.selection === selection) {
    fitting = true;
    map.setView(savedView.center, savedView.zoom, { animate: false });
    fitting = false;
  } else if (targets().length) fit();
  else map.setView([35, 105], 4);
  tiles.addTo(map);
  // Marker DOM is created when the map receives its initial view.
  updateSelection(selected, false);
  for (const { incident, marker } of markers) {
    marker.getElement()?.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        onSelect(incident.id);
      }
    });
  }
  canvas
    .querySelector(".leaflet-control-zoom-in")
    ?.setAttribute("aria-label", "放大地图");
  canvas
    .querySelector(".leaflet-control-zoom-out")
    ?.setAttribute("aria-label", "缩小地图");
  reset.addEventListener("click", fit);
  const resize = new ResizeObserver(() => {
    if (canvas.clientWidth && canvas.clientHeight) {
      resizing = true;
      map.invalidateSize({ pan: false });
      resizing = false;
      if (needsFit || fitted) fit();
    }
  });
  resize.observe(canvas);
  return {
    updateSelection,
    dispose() {
      resize.disconnect();
      clearTimeout(fallback);
      // A debounced resize can emit moveend after Leaflet removes its panes.
      map.off("moveend", saveView);
      map.remove();
    },
  };
}
