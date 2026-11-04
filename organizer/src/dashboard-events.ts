import type { Incident, Workspace } from "../../shared/organizer";
import { h } from "./html";
import { icon, searchField } from "./ui";
import { mountIncidentMap, type IncidentMapView } from "./incident-map";

export interface DashboardState {
  // null means all events; an empty set is an explicit selection of none.
  selected: Set<string> | null;
  selectionMode: "default" | "manual";
  sort: "updated" | "pending" | "deadline";
  mapExpanded?: boolean;
  mapView?: IncidentMapView;
  query: string;
  showAll: boolean;
}

// Keep navigation context separate for each account and organization.
const states = new Map<string, DashboardState>();
export function dashboardState(key: string): DashboardState {
  let state = states.get(key);
  if (!state) {
    state = {
      selected: null,
      selectionMode: "default",
      sort: "updated",
      query: "",
      showAll: false,
    };
    states.set(key, state);
  }
  return state;
}

export function dashboardIncidents(workspace: Workspace): Incident[] {
  const ids = new Set(workspace.tasks.map((task) => task.incidentId));
  return workspace.incidents.filter((incident) => ids.has(incident.id));
}

const previewCount = 5;

export function eventFilterMarkup(workspace: Workspace, state: DashboardState) {
  const incidents = dashboardIncidents(workspace);
  const available = new Set(incidents.map((incident) => incident.id));
  const previous = state.selected;
  if (state.selectionMode === "manual" && previous) {
    state.selected = new Set([...previous].filter((id) => available.has(id)));
    if (previous.size && !state.selected.size) state.selectionMode = "default";
  }
  if (state.selectionMode === "default") {
    const ended = new Set<string>();
    const ongoing = new Set<string>();
    for (const task of workspace.tasks) {
      if (task.state === "closed" || task.state === "archived")
        ended.add(task.incidentId);
      if (task.state === "open" || task.state === "paused" || task.pending > 0)
        ongoing.add(task.incidentId);
    }
    state.selected = new Set(
      [...available].filter((id) => !ended.has(id) || ongoing.has(id)),
    );
  }
  if (state.selected?.size === available.size) state.selected = null;
  const next = state.selected;
  if (
    previous === null || next === null
      ? previous !== next
      : previous.size !== next.size || [...previous].some((id) => !next.has(id))
  )
    state.mapView = undefined;
  if (!incidents.length) return "";
  if (incidents.length <= previewCount) state.query = "";
  return `<section class="panel dashboard-events" aria-labelledby="dashboard-events-title">
    <div class="panel-header"><div class="dashboard-event-heading"><h2 id="dashboard-events-title">活跃事件</h2><a href="#/incidents">全部事件 ${icon("arrow_forward")}</a></div><div class="dashboard-event-actions"><button type="button" class="border" id="dashboard-events-clear">${icon("restart_alt")}<span>清除筛选</span></button><button type="button" class="border" id="dashboard-map-toggle" aria-expanded="false" aria-controls="dashboard-event-map">${icon("map")}<span>显示地图</span></button></div></div>
    <div class="dashboard-event-layout">
      <div class="dashboard-event-picker">
        ${incidents.length > previewCount ? searchField("dashboard-event-search", "搜索事件", { value: state.query, className: "event-search" }) : ""}
        <div class="dashboard-event-list" role="group" aria-label="按事件筛选任务">
          ${incidents.map((incident) => `<button type="button" class="multi-select-option dashboard-event-option" value="${h(incident.id)}" aria-pressed="${state.selected === null || state.selected.has(incident.id)}" aria-controls="dashboard-tasks"><span>${h(incident.title)}</span></button>`).join("")}
        </div>
        <p class="muted event-search-empty" hidden>没有匹配的事件，请换个关键词。</p>
        <button type="button" class="transparent" id="dashboard-events-more" aria-expanded="false" ${incidents.length <= previewCount ? "hidden" : ""}>更多事件</button>
      </div>
      <div id="dashboard-event-map" class="dashboard-event-map" hidden></div>
    </div>
  </section>`;
}

export function attachEventFilter(
  root: HTMLElement,
  incidents: Incident[],
  state: DashboardState,
  onChange: () => void,
) {
  const panel = root.querySelector<HTMLElement>(".dashboard-events");
  if (!panel) return () => {};
  const layout = panel.querySelector<HTMLElement>(".dashboard-event-layout")!;
  const host = panel.querySelector<HTMLElement>("#dashboard-event-map")!;
  const toggle = panel.querySelector<HTMLButtonElement>(
    "#dashboard-map-toggle",
  )!;
  const clear = panel.querySelector<HTMLButtonElement>(
    "#dashboard-events-clear",
  )!;
  const more = panel.querySelector<HTMLButtonElement>(
    "#dashboard-events-more",
  )!;
  const search = panel.querySelector<HTMLInputElement>(
    "#dashboard-event-search",
  );
  const options = Array.from(
    panel.querySelectorAll<HTMLButtonElement>(".dashboard-event-option"),
  );
  let map: ReturnType<typeof mountIncidentMap> | undefined;
  let expanded = false;
  let disposed = false;

  const renderOptions = () => {
    const query = state.query.trim().toLocaleLowerCase();
    let matches = 0;
    let hiddenCount = 0;
    options.forEach((option, index) => {
      const selected =
        state.selected === null || state.selected.has(option.value);
      option.setAttribute("aria-pressed", String(selected));
      const matchesQuery = incidents[index].title
        .toLocaleLowerCase()
        .includes(query);
      if (matchesQuery) matches++;
      const collapsed =
        !query &&
        !state.showAll &&
        index >= previewCount &&
        !(state.selected && state.selected.size <= previewCount && selected) &&
        document.activeElement !== option;
      if (collapsed) hiddenCount++;
      option.hidden = !matchesQuery || collapsed;
    });
    panel.querySelector<HTMLElement>(".event-search-empty")!.hidden =
      matches > 0;
    more.hidden =
      !!query ||
      incidents.length <= previewCount ||
      (!state.showAll && !hiddenCount);
    more.textContent = state.showAll
      ? "收起事件"
      : `更多事件（${hiddenCount}）`;
    more.setAttribute("aria-expanded", String(state.showAll));
    clear.disabled = state.selected === null;
  };

  const changed = () => {
    state.mapView = undefined;
    renderOptions();
    map?.updateSelection(state.selected);
    onChange();
  };
  const select = (id: string) => {
    state.selectionMode = "manual";
    state.selected ??= new Set(incidents.map((incident) => incident.id));
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    if (state.selected.size === incidents.length) state.selected = null;
    changed();
  };
  options.forEach((option) => {
    option.addEventListener("click", () => select(option.value));
  });
  const clearSelection = () => {
    state.selectionMode = "manual";
    state.selected = null;
    changed();
    // The clear button becomes disabled; return keyboard focus to the list.
    const target = options.find((option) => !option.hidden) ?? search;
    target?.focus({ preventScroll: true });
  };
  clear.addEventListener("click", clearSelection);
  const clearEmpty = (event: Event) => {
    if (
      (event.target as HTMLElement).closest(
        '[data-action="clear-dashboard-events"]',
      )
    )
      clearSelection();
  };
  root.addEventListener("click", clearEmpty);
  more.addEventListener("click", () => {
    state.showAll = !state.showAll;
    renderOptions();
  });
  search?.addEventListener("input", () => {
    state.query = search.value;
    renderOptions();
  });

  const updateVisibility = () => {
    if (disposed) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const roomy =
      layout.clientWidth >= 45 * rem && window.innerHeight >= 44 * rem;
    expanded = state.mapExpanded ?? roomy;
    layout.dataset.mapOpen = String(expanded);
    host.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.querySelector("span")!.textContent = expanded
      ? "收起地图"
      : "显示地图";
    if (expanded && !map) {
      map = mountIncidentMap(
        host,
        incidents,
        state.selected,
        select,
        state.mapView,
        (view) => {
          state.mapView = view;
        },
      );
    }
  };
  toggle.addEventListener("click", () => {
    state.mapExpanded = !expanded;
    updateVisibility();
  });
  const resize = new ResizeObserver(updateVisibility);
  resize.observe(panel);
  window.addEventListener("resize", updateVisibility);
  renderOptions();
  updateVisibility();
  return () => {
    disposed = true;
    resize.disconnect();
    window.removeEventListener("resize", updateVisibility);
    root.removeEventListener("click", clearEmpty);
    map?.dispose();
  };
}
