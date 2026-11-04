import { closeDialog, h, icon, openDialog, searchField } from "./ui";

export interface TaskChoice {
  id: string;
  title: string;
  detail: string;
}

export function openTaskPicker(
  label: string,
  placeholder: string,
  choices: TaskChoice[],
  selected: string,
  onSelect: (choice: TaskChoice) => void,
) {
  const dialog = openDialog(
    `选择${label}`,
    `<div class="task-picker">${searchField("task-picker-search", `搜索${label}`, { placeholder, className: "task-picker-search" })}<p class="help task-picker-status" role="status" aria-live="polite"></p><ul class="task-picker-list" aria-label="${label}列表"></ul></div>`,
  );
  dialog.querySelector(".dialog-header")!.setAttribute("role", "presentation");
  const search = dialog.querySelector<HTMLInputElement>("input")!;
  const list = dialog.querySelector<HTMLUListElement>(".task-picker-list")!;
  const status = dialog.querySelector<HTMLElement>(".task-picker-status")!;
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = choices.filter((choice) =>
      `${choice.title} ${choice.detail}`.toLocaleLowerCase().includes(query),
    );
    status.textContent = matches.length
      ? `共 ${matches.length} ${label === "事件" ? "个事件" : "位负责人"}`
      : query
        ? `没有匹配的${label}，请尝试其他关键词。`
        : `暂无可选${label}。`;
    list.innerHTML = matches
      .map(
        (choice) =>
          `<li><button type="button" class="task-picker-option" data-choice="${h(choice.id)}" aria-pressed="${choice.id === selected}"><span class="task-picker-copy"><span class="task-picker-title">${h(choice.title)}</span><span class="task-picker-detail">${h(choice.detail)}</span></span>${choice.id === selected ? icon("check") : ""}</button></li>`,
      )
      .join("");
    list.scrollTop = 0;
  }
  search.addEventListener("input", render);
  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>(
      "[data-choice]",
    );
    const choice = choices.find((item) => item.id === button?.dataset.choice);
    if (!choice) return;
    onSelect(choice);
    closeDialog();
  });
  const controller = new AbortController();
  dialog.addEventListener("close", () => controller.abort(), { once: true });
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      const buttons = Array.from(
        list.querySelectorAll<HTMLButtonElement>("button"),
      );
      if (event.target === search && event.key === "ArrowDown") {
        if (buttons.length) {
          event.preventDefault();
          buttons[0].focus();
        }
      } else if (list.contains(event.target as Node)) {
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "ArrowDown"
            ? index + 1
            : event.key === "ArrowUp"
              ? index - 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : null;
        if (next !== null) {
          event.preventDefault();
          if (next < 0) search.focus();
          else buttons[Math.min(next, buttons.length - 1)]?.focus();
        }
      }
    },
    { signal: controller.signal },
  );
  render();
  search.focus();
  return dialog;
}
