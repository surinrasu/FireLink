import * as L from "leaflet";
import {
  mainlandRegions,
  municipalityCodes,
  regionPath,
  regionSelection,
  regionLabel,
  isCompleteRegion,
  type RegionNode,
} from "../../shared/regions";
import type { Incident } from "../../shared/organizer";
import type { LocationResult } from "../../shared/locations";
import { lookupLocations } from "./locations";
import { h, icon, select, searchField, errorText } from "./ui";

export function mountIncidentLocation(host: HTMLElement, initial?: Incident) {
  let path = regionSelection(initial?.region ?? "");
  let point: LocationResult | undefined;
  let confirmed = false;
  let map: L.Map | undefined;
  let resize: ResizeObserver | undefined;
  let programmatic = false;
  let disposed = false;
  let revision = 0;
  let request: AbortController | undefined;
  let reverseTimer: ReturnType<typeof setTimeout> | undefined;
  host.innerHTML = `<fieldset class="incident-regions"><legend>所在地区</legend><div class="region-selects">${select("incident-province", "省 / 直辖市", [["", "请选择省 / 直辖市"]], "", "required")}${select("incident-city", "城市", [["", "请选择城市"]], "", "required disabled")}${select("incident-district", "区 / 县", [["", "请选择区 / 县"]], "", "required disabled")}</div></fieldset><section class="incident-location-picker" hidden aria-label="确认事件地址"><div class="location-search">${searchField("incident-address-search", "搜索地址", { placeholder: "搜索街道或建筑" })}<button type="button" class="border" id="incident-search">${icon("search")}搜索</button></div><p class="location-message" role="status" aria-live="polite"></p><button type="button" class="border" id="incident-locate-retry" hidden>重新定位地区</button><ul class="location-results" aria-label="地址搜索结果" hidden></ul><div class="location-map-frame" hidden><div class="location-map" role="region" aria-label="事件位置地图，可拖动地图或使用方向键选点"></div><span class="location-center-pin" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 1a9 9 0 0 0-9 9c0 7 9 14 9 14s9-7 9-14a9 9 0 0 0-9-9Z" fill="currentColor" stroke="white" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="white"/></svg></span></div><p class="location-address" role="status" aria-live="polite"></p><button type="button" class="border" id="incident-confirm-location" hidden>确认此位置</button><p class="location-attribution">地址搜索 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · Nominatim</p></section>`;
  const province = host.querySelector<HTMLSelectElement>("#incident-province")!;
  const city = host.querySelector<HTMLSelectElement>("#incident-city")!;
  const district = host.querySelector<HTMLSelectElement>("#incident-district")!;
  const section = host.querySelector<HTMLElement>(".incident-location-picker")!;
  const message = host.querySelector<HTMLElement>(".location-message")!;
  const address = host.querySelector<HTMLElement>(".location-address")!;
  const frame = host.querySelector<HTMLElement>(".location-map-frame")!;
  const canvas = host.querySelector<HTMLElement>(".location-map")!;
  const search = host.querySelector<HTMLInputElement>(
    "#incident-address-search",
  )!;
  const searchButton =
    host.querySelector<HTMLButtonElement>("#incident-search")!;
  const results = host.querySelector<HTMLUListElement>(".location-results")!;
  const retry = host.querySelector<HTMLButtonElement>(
    "#incident-locate-retry",
  )!;
  const confirm = host.querySelector<HTMLButtonElement>(
    "#incident-confirm-location",
  )!;
  const setOptions = (
    field: HTMLSelectElement,
    nodes: RegionNode[],
    selected = "",
  ) => {
    const placeholder = field.options[0]?.textContent ?? "请选择";
    field.innerHTML = `<option value="">${h(placeholder)}</option>${nodes.map((node) => `<option value="${h(node.code)}" ${node.code === selected ? "selected" : ""}>${h(node.name)}</option>`).join("")}`;
    field.disabled = !nodes.length;
  };
  function renderRegions() {
    const municipal = municipalityCodes.has(path[0]?.code);
    setOptions(province, mainlandRegions, path[0]?.code);
    setOptions(city, path[0]?.children ?? [], path[1]?.code);
    city.closest<HTMLElement>(".field")!.hidden = municipal;
    city.disabled = municipal || !path[0];
    city.required = !municipal;
    setOptions(
      district,
      municipal
        ? (path[0]?.children ?? []).flatMap((node) => node.children ?? [])
        : (path[1]?.children ?? []),
      path[2]?.code,
    );
    section.hidden = !isCompleteRegion(path);
  }
  function cancelLookup() {
    revision++;
    request?.abort();
    clearTimeout(reverseTimer);
    searchButton.disabled = false;
  }
  function updateAddress() {
    address.textContent = point
      ? `${confirmed ? "已确认：" : "当前选点："}${point.address || "地图中心位置"}`
      : "";
    confirm.hidden = !point;
    confirm.disabled = confirmed;
    confirm.textContent = confirmed ? "已确认位置" : "确认此位置";
  }
  function showPoint(next: LocationResult, saved = false, region = false) {
    point = next;
    confirmed = saved;
    frame.hidden = false;
    if (!map) {
      map = L.map(canvas, {
        scrollWheelZoom: false,
        dragging: true,
        keyboard: true,
        zoomControl: true,
        attributionControl: true,
        inertia: false,
      });
      map.attributionControl.setPrefix(false);
      const tiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
          referrerPolicy: "strict-origin-when-cross-origin",
          keepBuffer: 0,
        },
      ).addTo(map);
      tiles.on("tileerror", () => {
        message.textContent = "地图暂不可用，可先搜索地址，或稍后重试。";
      });
      canvas
        .querySelector(".leaflet-control-zoom-in")
        ?.setAttribute("aria-label", "放大地图");
      canvas
        .querySelector(".leaflet-control-zoom-out")
        ?.setAttribute("aria-label", "缩小地图");
      map.on("moveend", () => {
        if (programmatic || !map || disposed) return;
        const center = map.getCenter().wrap();
        if (
          point &&
          Math.abs(center.lat - point.latitude) < 0.0000001 &&
          Math.abs(center.lng - point.longitude) < 0.0000001
        )
          return;
        cancelLookup();
        const turn = revision;
        point = {
          latitude: Number(center.lat.toFixed(6)),
          longitude: Number(center.lng.toFixed(6)),
          name: "",
          address: "",
        };
        confirmed = false;
        updateAddress();
        message.textContent = "正在查找当前选点的地址…";
        reverseTimer = setTimeout(async () => {
          request = new AbortController();
          const selected = point!;
          try {
            const places = await lookupLocations(
              {
                kind: "reverse",
                latitude: selected.latitude,
                longitude: selected.longitude,
              },
              request.signal,
            );
            if (disposed || turn !== revision) return;
            // Reverse geocoding names the selected point; it must never snap the map to a nearby feature.
            point = {
              ...selected,
              name: places[0]?.name ?? "",
              address: places[0]?.address ?? "",
            };
            message.textContent = places.length
              ? ""
              : "此处暂无地址名称，可按地图确认位置。";
            updateAddress();
          } catch (error) {
            if (!disposed && turn === revision)
              message.textContent = `${errorText(error)}仍可按地图确认位置。`;
          }
        }, 700);
      });
      resize = new ResizeObserver(() => map?.invalidateSize({ pan: false }));
      resize.observe(canvas);
    }
    programmatic = true;
    map.setView([next.latitude, next.longitude], region ? 12 : 16, {
      animate: false,
    });
    programmatic = false;
    updateAddress();
  }
  function resetMap() {
    resize?.disconnect();
    map?.remove();
    map = undefined;
    frame.hidden = true;
    point = undefined;
    confirmed = false;
    updateAddress();
  }
  async function locateRegion() {
    cancelLookup();
    const turn = revision;
    retry.hidden = true;
    message.textContent = "正在定位所选地区…";
    request = new AbortController();
    try {
      const places = await lookupLocations(
        { kind: "region", regionCode: path.at(-1)!.code },
        request.signal,
      );
      if (disposed || turn !== revision) return;
      if (!places.length)
        throw new Error("未找到该地区，可搜索附近的街道或建筑定位。");
      showPoint(places[0], false, true);
      message.textContent = "";
    } catch (error) {
      if (!disposed && turn === revision) {
        message.textContent = errorText(error);
        retry.hidden = false;
      }
    }
  }
  for (const field of [province, city, district])
    field.addEventListener("change", () => {
      cancelLookup();
      path = field.value
        ? regionPath(field.value)
        : path.slice(0, field === province ? 0 : field === city ? 1 : 2);
      if (
        field === province &&
        !municipalityCodes.has(path[0]?.code) &&
        path[0]?.children?.length === 1
      )
        path = regionPath(path[0].children[0].code);
      resetMap();
      results.hidden = true;
      results.replaceChildren();
      search.value = "";
      message.textContent = "";
      renderRegions();
      if (isCompleteRegion(path)) void locateRegion();
    });
  const runSearch = async () => {
    const query = search.value.trim();
    if (!query) {
      search.focus();
      return;
    }
    cancelLookup();
    const turn = revision;
    searchButton.disabled = true;
    request = new AbortController();
    results.hidden = true;
    results.replaceChildren();
    message.textContent = "正在搜索地址…";
    try {
      const places = await lookupLocations(
        { kind: "search", regionCode: path.at(-1)!.code, query },
        request.signal,
      );
      if (disposed || turn !== revision) return;
      message.textContent = places.length
        ? `找到 ${places.length} 个地址，请选择。`
        : "未找到地址，请换个关键词，或拖动地图选点。";
      results.innerHTML = places
        .map(
          (place, index) =>
            `<li><button type="button" class="transparent" data-place="${index}"><strong>${h(place.name)}</strong><span>${h(place.address)}</span></button></li>`,
        )
        .join("");
      results.hidden = !places.length;
      results.querySelectorAll<HTMLButtonElement>("button").forEach((button) =>
        button.addEventListener("click", () => {
          cancelLookup();
          showPoint(places[Number(button.dataset.place)]);
          results.hidden = true;
          retry.hidden = true;
          message.textContent = "";
          confirm.focus();
        }),
      );
    } catch (error) {
      if (!disposed && turn === revision)
        message.textContent = errorText(error);
    } finally {
      if (!disposed && turn === revision) searchButton.disabled = false;
    }
  };
  search.maxLength = 150;
  searchButton.addEventListener("click", () => void runSearch());
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  });
  retry.addEventListener("click", () => void locateRegion());
  confirm.addEventListener("click", () => {
    if (point) {
      confirmed = true;
      updateAddress();
    }
  });
  renderRegions();
  if (initial && isCompleteRegion(path))
    showPoint({ ...initial, name: initial.title }, true);
  const dialog = host.closest("dialog")!;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelLookup();
    resize?.disconnect();
    map?.remove();
    observer.disconnect();
    dialog.removeEventListener("close", onClose);
  }
  const onClose = () => {
    if (!dialog.open || !host.isConnected) dispose();
  };
  const observer = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  observer.observe(dialog, { childList: true });
  dialog.addEventListener("close", onClose);
  return {
    value() {
      if (!isCompleteRegion(path)) throw new Error("请完整选择所在地区。");
      if (!point || !confirmed) throw new Error("请在地图上确认事件位置。");
      return {
        region: regionLabel(path),
        address: point.address,
        latitude: point.latitude,
        longitude: point.longitude,
      };
    },
    dispose,
  };
}
