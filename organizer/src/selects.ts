const menu = document.createElement("div");
menu.id = "select-options";
menu.className = "select-popover";
menu.setAttribute("popover", "manual");
menu.setAttribute("role", "listbox");

let current: HTMLSelectElement | null = null;
let active = -1;
let query = "";
let typedAt = 0;

const available = (option: HTMLOptionElement | undefined) =>
  !!option &&
  !option.disabled &&
  !option.hidden &&
  !(
    option.parentElement instanceof HTMLOptGroupElement &&
    option.parentElement.disabled
  );

function close() {
  current?.setAttribute("aria-expanded", "false");
  current?.removeAttribute("aria-activedescendant");
  current = null;
  query = "";
  if (menu.matches(":popover-open")) menu.hidePopover();
}

function position() {
  if (!current || !menu.matches(":popover-open")) return;
  const bounds = current.getBoundingClientRect();
  if (bounds.bottom <= 0 || bounds.top >= innerHeight) return close();
  const below = innerHeight - bounds.bottom - 14;
  const above = bounds.top - 14;
  menu.style.width = `${Math.min(Math.max(bounds.width, Number(current.dataset.menuWidth) || 180), innerWidth - 16)}px`;
  menu.style.maxHeight = `${Math.max(44, Math.min(360, Math.max(below, above)))}px`;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, below >= height || below >= above ? bounds.bottom + 6 : bounds.top - height - 6)}px`;
}

function highlight(index: number) {
  if (!current || !available(current.options[index])) return;
  active = index;
  menu.querySelectorAll<HTMLElement>("[role=option]").forEach((item) => {
    item.classList.toggle("active", Number(item.dataset.index) === index);
  });
  const item = menu.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (item) {
    current.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }
}

function open(select: HTMLSelectElement, keyboard = false) {
  close();
  current = select;
  menu.classList.toggle("keyboard", keyboard);
  const label =
    select.getAttribute("aria-label") ||
    Array.from(select.labels || [])
      .map((item) => item.textContent?.trim())
      .join(" ");
  menu.setAttribute("aria-label", `${label || "选择"}选项`);
  menu.replaceChildren();
  Array.from(select.options).forEach((option, index) => {
    if (option.hidden) return;
    const item = document.createElement("div");
    item.id = `select-option-${index}`;
    item.className = "select-option";
    item.dataset.index = String(index);
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.selected));
    item.setAttribute("aria-disabled", String(!available(option)));
    const text = document.createElement("span");
    text.textContent = option.label;
    item.append(text);
    if (option.selected) {
      const check = document.createElement("i");
      check.setAttribute("aria-hidden", "true");
      check.textContent = "check";
      item.append(check);
    }
    menu.append(item);
  });
  (select.closest("dialog") || document.body).append(menu);
  select.setAttribute("aria-expanded", "true");
  select.focus({ preventScroll: true });
  menu.showPopover();
  position();
  const index = available(select.options[select.selectedIndex])
    ? select.selectedIndex
    : Array.from(select.options).findIndex(available);
  if (index >= 0) highlight(index);
}

function choose(index: number) {
  const select = current;
  if (!select || !available(select.options[index])) return;
  const changed = select.selectedIndex !== index;
  select.selectedIndex = index;
  close();
  select.focus({ preventScroll: true });
  if (changed) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function enhance() {
  document
    .querySelectorAll<HTMLSelectElement>("select:not([data-custom-select])")
    .forEach((select) => {
      if (select.multiple || select.size > 1) return;
      select.dataset.customSelect = "";
      select.setAttribute("aria-haspopup", "listbox");
      select.setAttribute("aria-expanded", "false");
      select.setAttribute("aria-controls", menu.id);
      const arrow = document.createElement("i");
      arrow.className = "select-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "expand_more";
      select.parentElement?.append(arrow);
    });
  if (current && (!current.isConnected || current.matches(":disabled")))
    close();
}

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    target instanceof HTMLSelectElement &&
    target.hasAttribute("data-custom-select") &&
    !target.matches(":disabled") &&
    event.button === 0
  ) {
    event.preventDefault();
    if (current === target) close();
    else open(target);
  } else if (menu.contains(target)) {
    event.preventDefault();
  } else if (current) close();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    target instanceof HTMLSelectElement &&
    target.hasAttribute("data-custom-select")
  ) {
    event.preventDefault();
    // Keyboard and assistive-technology activation may not dispatch pointer events.
    if (event.detail === 0 && !target.matches(":disabled")) {
      if (current === target) close();
      else open(target);
    }
  }
  const item = target.closest<HTMLElement>(".select-option");
  if (item && menu.contains(item)) choose(Number(item.dataset.index));
});

document.addEventListener("keydown", (event) => {
  const select = event.target;
  if (
    !(select instanceof HTMLSelectElement) ||
    !select.hasAttribute("data-custom-select") ||
    select.matches(":disabled")
  )
    return;
  if (event.key === "Tab") {
    if (current === select && active >= 0) choose(active);
    else close();
    return;
  }
  if (event.key === "Escape") {
    if (current === select) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (current === select) choose(active);
    else open(select, true);
    return;
  }
  const navigation = ["ArrowDown", "ArrowUp", "Home", "End"];
  const typing =
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (!navigation.includes(event.key) && !typing) return;
  event.preventDefault();
  if (current !== select) open(select, true);
  menu.classList.add("keyboard");
  const indices = Array.from(select.options).flatMap((option, index) =>
    available(option) ? [index] : [],
  );
  if (!indices.length) return;
  if (typing) {
    const now = Date.now();
    query = now - typedAt < 700 ? query + event.key : event.key;
    typedAt = now;
    const match = indices.find((index) =>
      select.options[index].label
        .toLocaleLowerCase()
        .startsWith(query.toLocaleLowerCase()),
    );
    if (match !== undefined) highlight(match);
  } else {
    const index = indices.indexOf(active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? indices.length - 1
          : Math.max(
              0,
              Math.min(
                indices.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );
    highlight(indices[next]);
  }
});

menu.addEventListener("toggle", () => {
  if (!menu.matches(":popover-open")) close();
});
window.addEventListener("resize", position);
window.addEventListener(
  "scroll",
  (event) => {
    if (event.target !== menu) position();
  },
  true,
);
new MutationObserver(enhance).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled"],
});
enhance();
