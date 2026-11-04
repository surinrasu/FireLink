import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { chromium, type Page, type BrowserContext } from "playwright";
import type {
  Session,
  MapAnnotation,
  TaskState,
  Workspace,
} from "../../shared/organizer";
import { isolateLocalDemo } from "./local-demo";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.TEST_URL || "http://127.0.0.1:8787/mng-dash";
let executablePath = process.env.BROWSER_EXECUTABLE;
if (!executablePath && process.platform === "darwin") {
  const chrome = "/Applications/Chrome.app/Contents/MacOS/Chrome";
  try {
    await access(chrome);
    executablePath = chrome;
  } catch {
    /* bundled Chromium */
  }
}
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const selected = process.env.UX_CASE?.split(",");
async function reviewFields(page: Page) {
  const details = page.locator("#review-fields");
  if (
    (await details.count()) &&
    !(await details.evaluate((e) => (e as HTMLDetailsElement).open))
  )
    await details.locator("summary").click();
}
async function review(page: Page) {
  await page.locator('.sidebar a[href="#/applications"]').click();
  await page.locator("#review-form").waitFor();
}
async function expandEditorSection(page: Page, id: string) {
  const section = page.locator(`#${id}`);
  await section.waitFor();
  if (!(await section.evaluate((e) => (e as HTMLDetailsElement).open)))
    await section.locator(":scope > summary").click();
}
async function editDraft(page: Page) {
  await page.locator('.sidebar a[href="#/tasks"]').click();
  await page.getByRole("link", { name: "继续编辑" }).first().click();
  await page.locator("#task-form").waitFor();
}
async function selectDashboardEvents(page: Page, names: string[]) {
  const options = page.locator(".dashboard-event-option");
  for (let index = 0; index < (await options.count()); index++) {
    const option = options.nth(index);
    const wanted = names.includes(await option.locator("span").innerText());
    if (((await option.getAttribute("aria-pressed")) === "true") !== wanted)
      await option.click();
  }
}
const cases: Record<
  string,
  (page: Page, context: BrowserContext) => Promise<void>
> = {
  "component-consistency": async (page) => {
    const appearance = (selector: string, colors = false) =>
      page
        .locator(selector)
        .first()
        .evaluate((element, colors) => {
          const style = getComputedStyle(element);
          return {
            font: style.fontSize,
            weight: style.fontWeight,
            lineHeight: style.lineHeight,
            padding: style.padding,
            radius: style.borderRadius,
            gap: style.gap,
            height: element.getBoundingClientRect().height,
            ...(colors
              ? {
                  color: style.color,
                  background: style.backgroundColor,
                  border: style.borderColor,
                }
              : {}),
          };
        }, colors);
    assert.deepEqual(
      await appearance(".page-actions a.button:not(.border)"),
      await appearance("#dashboard-map-toggle"),
      "action links and buttons share the same dimensions and typography",
    );
    await page.locator(".dashboard-event-option").first().click();
    await page.mouse.move(0, 0);
    const eventSelected = await appearance(
      '.dashboard-event-option[aria-pressed="true"]',
      true,
    );
    const eventUnselected = await appearance(
      '.dashboard-event-option[aria-pressed="false"]',
      true,
    );

    const fieldAppearance = (selector: string) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          font: style.fontSize,
          radius: style.borderRadius,
          height: element.getBoundingClientRect().height,
        };
      });
    const aligned = async (selector: string) => {
      const fields = await page
        .locator(selector)
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()),
        );
      assert.equal(fields.length, 2);
      assert.ok(Math.abs(fields[0].top - fields[1].top) < 1);
      assert.ok(Math.abs(fields[0].bottom - fields[1].bottom) < 1);
    };
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.locator("#task-search").waitFor();
    await aligned("#task-search, #incident-filter");
    const search = await fieldAppearance("#task-search");
    await page.locator('.sidebar a[href="#/applications"]').click();
    await page.locator("#application-search").waitFor();
    await aligned("#application-task, #application-search");
    assert.deepEqual(await fieldAppearance("#application-search"), search);
    await page.locator('.sidebar a[href="#/tasks/new"]').click();
    await page.locator(".requirement-option").first().waitFor();
    assert.deepEqual(
      await appearance(".requirement-option > input:checked + span", true),
      eventSelected,
      "event and requirement selections have the same selected appearance",
    );
    assert.deepEqual(
      await appearance(
        ".requirement-option > input:not(:checked) + span",
        true,
      ),
      eventUnselected,
      "event and requirement selections have the same unselected appearance",
    );
    await page.locator("#incidentId-picker").click();
    await page.locator("#task-picker-search").waitFor();
    assert.deepEqual(await fieldAppearance("#task-picker-search"), search);
    await page.keyboard.press("Escape");
  },
  "enlarged-text-layout": async (page) => {
    for (const [route, ready] of [
      ["dashboard", "#dashboard-sort"],
      ["tasks", "#task-search"],
      ["applications", "#application-search"],
    ]) {
      await page.goto(`${base}#/${route}`);
      await page.locator(ready).waitFor();
      for (const fontSize of [16, 18, 32]) {
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = `${size}px`;
        }, fontSize);
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const failures = await page.evaluate(() => {
            const failures: string[] = [];
            for (const element of document.querySelectorAll<HTMLElement>(
              ".dashboard-sort button, .dashboard-event-actions button, .mobile-nav a, .mobile-nav button, .toolbar input, .toolbar select",
            )) {
              const box = element.getBoundingClientRect();
              if (!box.width || !box.height) continue;
              const label =
                element.getAttribute("aria-label") || element.textContent;
              if (box.left < -1 || box.right > innerWidth + 1)
                failures.push(`${label}: outside viewport`);
              if (element.matches("input, select")) {
                const field = element
                  .closest(".field")!
                  .getBoundingClientRect();
                if (box.left < field.left - 1 || box.right > field.right + 1)
                  failures.push(`${label}: outside field`);
                continue;
              }
              const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
              );
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (
                  !node.textContent?.trim() ||
                  node.parentElement?.closest("i")
                )
                  continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const text of range.getClientRects()) {
                  if (
                    text.left < box.left - 1 ||
                    text.right > box.right + 1 ||
                    text.top < box.top - 1 ||
                    text.bottom > box.bottom + 1
                  )
                    failures.push(`${label}: clipped or overlapping label`);
                }
              }
            }
            const nav = document
              .querySelector(".mobile-nav")!
              .getBoundingClientRect();
            const padding = parseFloat(
              getComputedStyle(document.querySelector("main")!).paddingBottom,
            );
            if (nav.height && padding < nav.height + 8)
              failures.push("navigation covers the end of the content");
            return failures;
          });
          assert.deepEqual(
            failures,
            [],
            `${route}: ${width}px / ${fontSize}px text`,
          );
          if (
            (fontSize === 32 && width <= 390) ||
            (fontSize === 16 && width === 1440)
          ) {
            await page.locator(ready).scrollIntoViewIfNeeded();
            await page.screenshot({
              path: `../.artifacts/organizer/ux/text-layout-${route}-${width}-${fontSize}.png`,
            });
          }
        }
      }
      await page.setViewportSize({ width: 320, height: 900 });
      if (route === "dashboard") {
        const radios = page.locator("#dashboard-sort button");
        await radios.first().click();
        await page.keyboard.press("ArrowDown");
        assert.equal(await radios.nth(1).getAttribute("aria-checked"), "true");
        assert.equal(
          await radios.nth(1).evaluate((el) => el === document.activeElement),
          true,
        );
      } else {
        await page.locator(ready).fill("安置");
        await page.locator(ready).press("Enter");
        await page.waitForURL(/q=/);
        assert.equal(await page.locator(ready).inputValue(), "安置");
      }
    }
    await page.locator('.mobile-nav button[data-action="more"]').click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
  },
  "expired-applications": async (page) => {
    const endpoint = (path: string) =>
      new URL(`/api/organizer${path}`, base).href;
    const session: Session = await (
      await page.request.get(endpoint("/auth/session"))
    ).json();
    const headers = {
      "X-Organization-Id": session.memberships[0].organizationId,
      "X-FireLink-Request": "organizer",
    };
    const workspace: Workspace = await (
      await page.request.get(endpoint("/workspace"), { headers })
    ).json();
    const task = workspace.tasks.find((item) => item.pending > 0)!;
    const remaining =
      workspace.tasks.reduce((sum, item) => sum + item.pending, 0) -
      task.pending;
    const update = await page.request.put(endpoint(`/tasks/${task.id}`), {
      headers,
      data: {
        ...task,
        startsAt: "2000-01-01T00:00:00.000Z",
        endsAt: "2000-01-02T00:00:00.000Z",
        deadline: "2000-01-01T00:00:00.000Z",
      },
    });
    assert.equal(update.status(), 200, await update.text());
    await page.locator('.sidebar a[href="#/applications"]').click();
    await page
      .locator(".filter-chips a")
      .filter({ hasText: `已过期 ${task.pending}` })
      .click();
    await page
      .getByText("任务已结束，报名未获确认，已自动过期。", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".application-row").count(), task.pending);
    assert.equal(
      await page
        .locator('.sidebar a[href="#/applications"] .count')
        .innerText(),
      String(remaining),
    );
    assert.equal(await page.locator("#review-form").count(), 0);
    assert.equal(await page.locator(".contact-row").count(), 0);
    assert.match(
      await page.locator("#review-detail .review-heading .status").innerText(),
      /已过期/,
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/expired-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator(".application-row").first().click();
    await page
      .getByText("任务已结束，报名未获确认，已自动过期。", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#review-form").count(), 0);
    assert.equal(await page.locator(".contact-row").count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  },
  "task-pickers": async (page) => {
    let original: Workspace;
    let emptyChoices = false;
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data: Workspace = await response.json();
      original = structuredClone(data);
      const member = data.members[0];
      data.incidents.push(
        ...Array.from({ length: 40 }, (_, index) => ({
          ...data.incidents[0],
          id: `extra-incident-${index}`,
          title: `社区支援事件 ${index + 1}：这是一条用于验证长名称显示的事件`,
        })),
      );
      data.members.push(
        ...Array.from({ length: 40 }, (_, index) => ({
          ...member,
          id: `extra-member-${index}`,
          name: `任务负责人 ${index + 1}`,
          email: `manager${index + 1}@example.invalid`,
          role: "manager" as const,
        })),
        { ...member, id: "inactive-member", name: "停用人员", active: false },
        {
          ...member,
          id: "review-only-member",
          name: "仅审核人员",
          role: "reviewer",
        },
      );
      if (emptyChoices) {
        data.incidents = [];
        data.members = [];
      }
      await route.fulfill({ response, json: data });
    });
    await page.locator('.sidebar a[href="#/tasks/new"]').click();
    await page.locator("#task-form").waitFor();
    const eventButton = page.locator("#incidentId-picker");
    const ownerButton = page.locator("#ownerId-picker");
    const dialog = page.getByRole("dialog");
    const options = page.locator(".task-picker-list button");
    assert.equal(
      await page
        .getByRole("button", { name: "待选择事件", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.locator(".page-heading #save-status").innerText(),
      "自动保存已启用",
    );
    assert.equal(await page.locator(".editor-footer #save-status").count(), 0);
    const checkPickerAlignment = async () => {
      assert.equal(
        await page.locator(".editor-picker-button").evaluateAll((buttons) =>
          buttons.every((button) => {
            const icon = button.querySelector("i")!.getBoundingClientRect();
            const label = button.querySelector(".editor-picker-value")!;
            const text = label.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return (
              Math.abs(
                (icon.left + text.right) / 2 - (box.left + box.right) / 2,
              ) < 1 &&
              Math.abs(
                (icon.top + icon.bottom) / 2 - (text.top + text.bottom) / 2,
              ) < 1 &&
              getComputedStyle(label).whiteSpace === "nowrap" &&
              box.height ===
                document.querySelector("#preview-task")!.getBoundingClientRect()
                  .height
            );
          }),
        ),
        true,
        "Picker icons and single-line labels are centered like the preview button",
      );
    };
    await checkPickerAlignment();
    assert.equal(await page.locator(".editor-section select").count(), 0);
    assert.equal(
      await eventButton.locator("..").getAttribute("class"),
      "editor-pickers",
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/task-pickers-desktop.png",
    });
    await eventButton.click();
    const eventSearch = page.getByRole("searchbox", { name: "搜索事件" });
    assert.equal(
      await eventSearch.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(await options.count(), original!.incidents.length + 40);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    assert.ok(
      await page
        .locator(".task-picker-list")
        .evaluate((el) => el.scrollTop > 0),
    );
    await eventSearch.fill(" 江苏省 ");
    assert.equal(await options.count(), 1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#incidentId").inputValue(),
      "incident-nanjing",
    );
    assert.match(await eventButton.innerText(), /南京鼓楼区火情/);
    assert.equal(
      await page
        .getByRole("button", { name: "南京鼓楼区火情", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await eventButton.evaluate((el) => el === document.activeElement),
      true,
    );
    await eventButton.click();
    assert.equal(await eventSearch.inputValue(), "");
    assert.match(
      await page
        .locator('.task-picker-option[aria-pressed="true"]')
        .innerText(),
      /南京鼓楼区火情/,
    );
    await eventSearch.fill("不存在的事件关键词");
    assert.equal(await options.count(), 0);
    assert.match(await dialog.innerText(), /没有匹配的事件/);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#incidentId").inputValue(),
      "incident-nanjing",
    );
    await ownerButton.click();
    const ownerSearch = page.getByRole("searchbox", { name: "搜索负责人" });
    assert.equal(
      await options.count(),
      original!.members.filter((m) => m.active && m.role !== "reviewer")
        .length + 40,
    );
    assert.equal(
      await options.filter({ hasText: /停用人员|仅审核人员/ }).count(),
      0,
    );
    await ownerSearch.fill(" MANAGER40@EXAMPLE.INVALID ");
    assert.equal(await options.count(), 1);
    await options.first().click();
    assert.equal(
      await page.locator("#ownerId").inputValue(),
      "extra-member-39",
    );
    assert.match(await ownerButton.innerText(), /任务负责人 40/);
    await ownerButton.click();
    await ownerSearch.fill(original!.members[0].name);
    await options.first().click();
    await page
      .getByLabel("任务标题", { exact: true })
      .fill("底栏选择器保存验证");
    await page
      .getByLabel("工作内容与能力要求摘要")
      .fill("选择事件和负责人后保存草稿");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    await page.getByRole("link", { name: "返回任务" }).click();
    await page
      .locator(".task-card")
      .filter({ hasText: "底栏选择器保存验证" })
      .getByRole("link", { name: "继续编辑" })
      .click();
    await eventButton.waitFor();
    await page.reload();
    await eventButton.waitFor();
    assert.equal(
      await page.locator("#incidentId").inputValue(),
      "incident-nanjing",
    );
    assert.equal(
      await page.locator("#ownerId").inputValue(),
      original!.members[0].id,
    );
    assert.match(await eventButton.innerText(), /南京鼓楼区火情/);
    await eventButton.click();
    assert.deepEqual(
      (
        await new AxeBuilder({ page })
          .include("#dialog")
          .include(".editor-footer")
          .analyze()
      ).violations,
      [],
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/task-picker-dialog-desktop.png",
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await checkPickerAlignment();
      await eventButton.click();
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds &&
          bounds.x >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 844,
      );
      assert.equal(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.screenshot({
        path: `../.artifacts/organizer/ux/task-picker-dialog-${width}.png`,
      });
      assert.equal(
        (await new AxeBuilder({ page }).include("#dialog").analyze()).violations
          .length,
        0,
      );
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: `../.artifacts/organizer/ux/task-pickers-${width}.png`,
      });
    }
    emptyChoices = true;
    await page.goto(`${base}/#/tasks/new`);
    await page
      .getByRole("heading", { name: "新建任务", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "待选择事件", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "待选择负责人", exact: true })
        .count(),
      1,
    );
    await eventButton.click();
    assert.match(await dialog.innerText(), /暂无可选事件/);
    await page.keyboard.press("Escape");
    await ownerButton.click();
    assert.match(await dialog.innerText(), /暂无可选负责人/);
    await page.keyboard.press("Escape");
    await page.getByLabel("任务标题", { exact: true }).fill("未选择事件");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.getByRole("dialog", { name: "选择事件" }).waitFor();
    assert.match(
      await page.locator("#save-status").innerText(),
      /请先选择事件/,
    );
    assert.equal(await page.locator("#publish-task").isDisabled(), true);
  },
  "select-menus": async (page) => {
    const menu = page.locator(".select-popover:popover-open");
    const organization = page.getByRole("combobox", {
      name: "切换组织",
      exact: true,
    });
    await organization.click();
    await menu.waitFor();
    assert.equal(await organization.getAttribute("aria-expanded"), "true");
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    assert.equal(
      await organization.evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    const incident = page.getByLabel("所属事件", { exact: true });
    await incident.click();
    await menu
      .getByRole("option", { name: "南京鼓楼区火情", exact: true })
      .click();
    assert.equal(await incident.inputValue(), "incident-nanjing");
    assert.equal(await page.locator(".task-card:visible").count(), 2);
    await page.keyboard.press("Space");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await incident.inputValue(), "incident-hangzhou");
    assert.equal(await page.locator(".task-card:visible").count(), 4);
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(await incident.inputValue(), "incident-hangzhou");
    await incident.click();
    await page.getByRole("heading", { name: "任务", exact: true }).click();
    await menu.waitFor({ state: "hidden" });
    await page.locator('.sidebar a[href="#/settings"]').click();
    await page.getByRole("button", { name: "邀请成员", exact: true }).click();
    const role = page.getByLabel("成员角色", { exact: true });
    await role.click();
    await menu.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await role.click();
    await menu.getByRole("option", { name: "任务管理员", exact: true }).click();
    assert.equal(await role.inputValue(), "manager");
    await page.getByRole("button", { name: "取消", exact: true }).click();
  },
  "incident-tasks": async (page) => {
    const incidents = () => page.goto(`${base}/#/incidents`);
    const cards = page.locator(".incident-grid > .panel");
    const visibleTasks = page.locator(".task-card:visible");
    await incidents();
    await page
      .getByRole("heading", { name: "事件", exact: true, level: 1 })
      .waitFor();
    assert.deepEqual(
      await cards.locator(".incident-header h2").allTextContents(),
      ["杭州西湖区火情", "南京鼓楼区火情"],
    );
    assert.equal(await cards.locator(".incident-header p").count(), 0);
    for (const [index, count] of [4, 2].entries()) {
      const card = cards.nth(index);
      assert.equal(await card.locator(".task-row").count(), 2);
      assert.equal(
        await card.locator(".panel-header h3").textContent(),
        `${count} 个当前组织关联任务`,
      );
      assert.equal(
        await card.locator("firelink-map .label").textContent(),
        index ? "江苏省 南京市 鼓楼区" : "浙江省 杭州市 西湖区",
      );
    }
    await page.screenshot({
      path: "../.artifacts/organizer/ux/incident-tasks-desktop.png",
      fullPage: true,
    });
    await cards.first().getByRole("link", { name: "显示全部" }).click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("所属事件", { exact: true }).inputValue(),
      "incident-hangzhou",
    );
    assert.equal(await visibleTasks.count(), 4);
    assert.ok(
      (await visibleTasks.locator(".task-event").allTextContents()).every(
        (title) => title.includes("杭州西湖区火情"),
      ),
    );
    await page.reload();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(await visibleTasks.count(), 4);
    await page.getByRole("link", { name: "草稿 1", exact: true }).click();
    await page
      .locator(".filter-chips a.active")
      .filter({ hasText: "草稿" })
      .waitFor();
    assert.equal(await visibleTasks.count(), 1);
    assert.equal(
      await page.getByLabel("所属事件", { exact: true }).inputValue(),
      "incident-hangzhou",
    );
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption("incident-nanjing");
    await page
      .getByRole("heading", { name: "无匹配任务", exact: true })
      .waitFor();
    assert.equal(await visibleTasks.count(), 0);
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.getByRole("link", { name: "全部任务 6", exact: true }).waitFor();
    assert.equal(await visibleTasks.count(), 6);
    assert.equal(
      await page.getByLabel("所属事件", { exact: true }).inputValue(),
      "",
    );
    await incidents();
    await cards.nth(1).getByRole("link", { name: "显示全部" }).click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(await visibleTasks.count(), 2);
    assert.ok(
      (await visibleTasks.locator(".task-event").allTextContents()).every(
        (title) => title.includes("南京鼓楼区火情"),
      ),
    );
    await page
      .getByRole("searchbox", { name: "搜索任务", exact: true })
      .fill("信息登记");
    assert.equal(await visibleTasks.count(), 1);
    await page
      .getByRole("searchbox", { name: "搜索任务", exact: true })
      .fill("");
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption("incident-hangzhou");
    await page.reload();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(await visibleTasks.count(), 4);
    await incidents();
    await cards.first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "../.artifacts/organizer/ux/incident-tasks-mobile.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 740 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await cards.first().getByRole("link", { name: "显示全部" }).click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    assert.equal(await visibleTasks.count(), 4);
    await page.goBack();
    await page
      .getByRole("heading", { name: "事件", exact: true, level: 1 })
      .waitFor();
  },
  "account-preferences": async (page) => {
    const theme = page.getByRole("button", { name: "主题", exact: true });
    const text = page.getByRole("button", { name: "文字大小", exact: true });
    const account = page.getByRole("link", {
      name: "当前账户设置",
      exact: true,
    });
    assert.equal(await page.locator('.topbar a[href="#/notices"]').count(), 0);
    await theme.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("radio", { name: "跟随系统", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator("body")
        .evaluate((element) => element.classList.contains("dark")),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await theme.evaluate((element) => element === document.activeElement),
      true,
    );
    await text.click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.reload();
    await account.waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          document.body.classList.contains("dark") &&
          document.documentElement.classList.contains("large-text"),
      ),
      true,
    );
    await account.click();
    const current = page.locator("#current-member");
    await current.waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await current.locator('[data-action="member"]').isDisabled(),
      true,
    );
    assert.equal(
      await page.getByText("阅读与显示", { exact: true }).count(),
      0,
    );
    const focusedAndVisible = async () => {
      await page.waitForFunction(
        () => {
          const member = document.querySelector("#current-member");
          const rect = member?.getBoundingClientRect();
          const nav = document
            .querySelector(".mobile-nav")
            ?.getBoundingClientRect();
          return (
            member === document.activeElement &&
            rect &&
            rect.top >= 0 &&
            rect.bottom <= (nav?.height ? nav.top : innerHeight)
          );
        },
        undefined,
        { timeout: 5000 },
      );
    };
    await focusedAndVisible();
    await page.screenshot({
      path: "../.artifacts/organizer/ux/account-settings-desktop.png",
    });
    for (const width of [834, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await account.click();
      await focusedAndVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    }
    await page.screenshot({
      path: "../.artifacts/organizer/ux/account-settings-mobile.png",
    });
    await theme.click();
    await page.getByRole("radio", { name: "浅色", exact: true }).check();
    await page.screenshot({
      path: "../.artifacts/organizer/ux/theme-menu-mobile.png",
    });
    await text.click();
    assert.equal(await page.locator("#preference-theme").isVisible(), false);
    assert.equal(
      await page
        .getByRole("radio", { name: "更大字号", exact: true })
        .isChecked(),
      true,
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/text-menu-mobile.png",
    });
    await page.keyboard.press("Escape");
    await account.click();
    // Repeated avatar navigation stays on the same form and preserves unsaved edits.
    await page.getByLabel("组织介绍", { exact: true }).fill("暂存的组织介绍");
    await account.click();
    await focusedAndVisible();
    assert.equal(
      await page.getByLabel("组织介绍", { exact: true }).inputValue(),
      "暂存的组织介绍",
    );
    await current
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await page.getByRole("button", { name: "继续处理", exact: true }).click();
    assert.equal(
      await current
        .getByRole("button", { name: "退出登录", exact: true })
        .isEnabled(),
      true,
    );
    await current
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await page.getByRole("button", { name: "放弃并退出", exact: true }).click();
    await page
      .getByRole("heading", { name: "组织者登录", exact: true })
      .waitFor();
    await theme.click();
    assert.equal(
      await page.getByRole("radio", { name: "浅色", exact: true }).isChecked(),
      true,
    );
  },
  "hct-theme": async (page, context) => {
    const menu = page.locator("#preference-theme");
    const wheel = page.getByRole("slider", { name: "主题色相", exact: true });
    const open = () =>
      page.getByRole("button", { name: "主题", exact: true }).click();
    const hue = () => wheel.getAttribute("aria-valuenow");
    const primary = () =>
      page
        .locator("body")
        .evaluate((e) =>
          getComputedStyle(e).getPropertyValue("--primary").trim(),
        );
    await open();
    assert.equal(await hue(), "266");
    assert.equal(
      await wheel.getAttribute("aria-valuetext"),
      "靛青色系，266 度",
    );
    await wheel.focus();
    await page.keyboard.press("End");
    assert.equal(await hue(), "359");
    await page.keyboard.press("ArrowRight");
    assert.equal(await hue(), "359");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowLeft");
    assert.equal(await hue(), "0");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("PageUp");
    assert.equal(await hue(), "25");
    assert.equal(
      await menu.locator('[data-hue="25"]').getAttribute("aria-pressed"),
      "true",
    );
    const red = await primary();
    const bounds = (await wheel.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 12);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - 12,
      bounds.y + bounds.height / 2,
    );
    assert.equal(await hue(), "90");
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height - 12,
    );
    await page.mouse.up();
    assert.equal(await hue(), "180");
    assert.notEqual(await primary(), red);
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    assert.equal(await hue(), "180");
    await page.keyboard.press("Escape");
    await page.reload();
    await open();
    assert.equal(await hue(), "180");
    assert.equal(
      await page.getByRole("radio", { name: "深色", exact: true }).isChecked(),
      true,
    );
    await page.getByRole("radio", { name: "跟随系统", exact: true }).check();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(
        (mode) => document.body.classList.contains(mode),
        colorScheme,
      );
      assert.equal(await hue(), "180");
      assert.equal(
        await page.locator('meta[name="theme-color"]').getAttribute("content"),
        await page
          .locator("body")
          .evaluate((e) =>
            getComputedStyle(e).getPropertyValue("--background").trim(),
          ),
      );
    }
    await page.getByRole("button", { name: "恢复默认色", exact: true }).click();
    assert.equal(await hue(), "266");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 740 });
    await open();
    // Popover toggle events (which position it) are queued after the click.
    await page.waitForFunction(() => {
      const bounds = document
        .querySelector("#preference-theme")!
        .getBoundingClientRect();
      return (
        bounds.x >= 0 &&
        bounds.right <= innerWidth &&
        bounds.y >= 0 &&
        bounds.bottom <= innerHeight
      );
    });
    const mobile = (await menu.boundingBox())!;
    assert.ok(
      mobile.x >= 0 &&
        mobile.x + mobile.width <= 320 &&
        mobile.y >= 0 &&
        mobile.y + mobile.height <= 740,
      JSON.stringify(mobile),
    );
    assert.equal(
      await menu.evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const ring = (await wheel.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: ring.x + ring.width / 2, y: ring.y + 12 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: ring.x + ring.width - 12, y: ring.y + ring.height / 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    assert.equal(await hue(), "90");
    await page.getByRole("button", { name: "恢复默认色", exact: true }).click();
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await page.screenshot({
      path: "../.artifacts/organizer/ux/hct-picker-mobile.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => localStorage.setItem("firelink:hue", "invalid"));
    await page.reload();
    await open();
    assert.equal(await hue(), "266");
    // Quota failures can block writes while reads remain available.
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };
    });
    await wheel.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await page.locator('.sidebar a[href="#/settings"]').click();
    await page
      .getByRole("heading", { name: "组织设置", exact: true })
      .waitFor();
    await open();
    assert.equal(await hue(), "265");
    // Denied storage still permits changing appearance within this session.
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException("Denied");
      };
      Storage.prototype.setItem = () => {
        throw new DOMException("Denied");
      };
    });
    await page.reload();
    await open();
    await wheel.focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await hue(), "265");
    await page.getByRole("radio", { name: "浅色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    await page.locator('.sidebar a[href="#/settings"]').click();
    await page
      .getByRole("heading", { name: "组织设置", exact: true })
      .waitFor();
    await open();
    assert.equal(await hue(), "265");
    assert.equal(
      await page.getByRole("radio", { name: "浅色", exact: true }).isChecked(),
      true,
    );
  },
  "dashboard-events": async (page) => {
    let removeSelected = false;
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data: Workspace = await response.json();
      const sample = data.tasks.find((task) => task.state === "open")!;
      const [first, second] = data.incidents;
      data.incidents.push(
        {
          ...first,
          id: "pending-event",
          title: "报名截止但仍待审核的事件",
          status: "closed",
        },
        { ...first, id: "draft-event", title: "尚未开始招募的事件" },
        { ...first, id: "unrelated-event", title: "没有可见任务的事件" },
      );
      data.tasks = [
        {
          ...sample,
          id: "event-task-a",
          title: "杭州待审任务",
          incidentId: first.id,
          incidentTitle: first.title,
          pending: 8,
          updatedAt: "2026-01-03",
          deadline: "2099-01-03",
        },
        {
          ...sample,
          id: "event-task-b",
          title: "南京招募任务",
          incidentId: second.id,
          incidentTitle: second.title,
          pending: 0,
          updatedAt: "2026-01-02",
          deadline: "2099-01-01",
        },
        {
          ...sample,
          id: "event-task-c",
          title: "截止后待审任务",
          incidentId: "pending-event",
          incidentTitle: "报名截止但仍待审核的事件",
          state: "closed",
          pending: 1,
          updatedAt: "2026-01-01",
          deadline: "",
        },
        {
          ...sample,
          id: "event-task-d",
          title: "草稿任务",
          incidentId: "draft-event",
          incidentTitle: "尚未开始招募的事件",
          state: "draft",
          pending: 0,
        },
      ];
      if (removeSelected)
        data.tasks = data.tasks.filter((task) => task.incidentId !== first.id);
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    const toggle = page.locator("#dashboard-map-toggle");
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const chip = (name: string) =>
      page
        .locator(".dashboard-event-list")
        .getByRole("button", { name, exact: true });
    const titles = async () => {
      while (await page.locator("#dashboard-more").isVisible())
        await page.locator("#dashboard-more").click();
      return page.locator("#dashboard-tasks .task-info > a").allTextContents();
    };
    assert.equal(await chip("没有可见任务的事件").count(), 0);
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      4,
    );
    assert.equal(
      await page.locator("#dashboard-events-title").innerText(),
      "活跃事件",
    );
    const allEvents = page
      .locator(".dashboard-events")
      .getByRole("link", { name: "全部事件", exact: true });
    await allEvents.click();
    await page
      .getByRole("heading", { name: "事件", exact: true, level: 1 })
      .waitFor();
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await toggle.waitFor();
    assert.deepEqual(await titles(), [
      "杭州待审任务",
      "南京招募任务",
      "截止后待审任务",
    ]);
    await chip("南京鼓楼区火情").click();
    assert.equal(
      await chip("南京鼓楼区火情").getAttribute("aria-pressed"),
      "false",
    );
    assert.deepEqual(await titles(), ["杭州待审任务", "截止后待审任务"]);
    await selectDashboardEvents(page, ["南京鼓楼区火情"]);
    assert.deepEqual(
      await titles(),
      ["南京招募任务"],
      "other events' pending applications must not hide this open task",
    );
    assert.equal(
      await page.locator("#dashboard-tasks .task-incident").count(),
      0,
    );
    await chip("杭州西湖区火情").click();
    assert.deepEqual(await titles(), ["杭州待审任务", "南京招募任务"]);
    assert.equal(
      await page.locator("#dashboard-tasks .task-incident").count(),
      2,
    );
    await page
      .getByRole("radio", { name: "按距截止时间", exact: true })
      .click();
    assert.deepEqual(await titles(), ["南京招募任务", "杭州待审任务"]);
    const contained = await page
      .locator(".incident-map-marker.is-selected")
      .evaluateAll((markers) => {
        const map = document
          .querySelector(".incident-map-canvas")!
          .getBoundingClientRect();
        return markers.every((marker) => {
          const box = marker.getBoundingClientRect();
          return (
            box.left >= map.left &&
            box.right <= map.right &&
            box.top >= map.top &&
            box.bottom <= map.bottom
          );
        });
      });
    assert.equal(contained, true, "fit the complete selection inside the map");
    await toggle.click();
    await page.getByRole("link", { name: "南京招募任务", exact: true }).click();
    await page
      .getByRole("heading", { name: "南京招募任务", exact: true })
      .waitFor();
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await toggle.waitFor();
    assert.equal(
      await chip("杭州西湖区火情").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await chip("南京鼓楼区火情").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .getByRole("radio", { name: "按距截止时间", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      4,
    );
    await selectDashboardEvents(page, []);
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      0,
    );
    await page
      .getByRole("heading", { name: "请选择事件", exact: true })
      .waitFor();
    assert.equal(await page.locator("#dashboard-tasks .task-row").count(), 0);
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await page
      .getByRole("heading", { name: "请选择事件", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      0,
    );
    await selectDashboardEvents(page, ["尚未开始招募的事件"]);
    await page
      .getByRole("heading", { name: "所选事件暂无需要关注的任务", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "查看全部事件的任务", exact: true })
      .click();
    assert.deepEqual(await titles(), [
      "南京招募任务",
      "杭州待审任务",
      "截止后待审任务",
    ]);
    await selectDashboardEvents(page, ["杭州西湖区火情"]);
    removeSelected = true;
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await toggle.waitFor();
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      3,
      "discard choices no longer accessible",
    );
    assert.deepEqual(await titles(), ["南京招募任务", "截止后待审任务"]);
  },
  "dashboard-event-defaults": async (page) => {
    const scenarios: { states: TaskState[]; selected: boolean }[] = [
      { states: ["draft"], selected: true },
      { states: ["open"], selected: true },
      { states: ["paused"], selected: true },
      { states: ["closed"], selected: false },
      { states: ["archived"], selected: false },
      { states: ["closed", "draft"], selected: false },
      { states: ["closed", "open"], selected: true },
      { states: ["archived", "paused"], selected: true },
    ];
    let allEnded = false;
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data: Workspace = await response.json();
      const sample = data.tasks[0];
      data.incidents = scenarios.map((scenario, index) => ({
        ...data.incidents[0],
        id: `default-event-${index}`,
        title: scenario.states.join(" + "),
      }));
      data.tasks = scenarios.flatMap((scenario, index) =>
        scenario.states.map((state, taskIndex) => ({
          ...sample,
          id: `default-task-${index}-${taskIndex}`,
          incidentId: data.incidents[index].id,
          incidentTitle: data.incidents[index].title,
          state: allEnded ? "closed" : state,
          pending: 0,
        })),
      );
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    const panel = page.locator(".dashboard-events");
    await panel.waitFor();
    const selection = () =>
      page
        .locator(".dashboard-event-option")
        .evaluateAll((options) =>
          options.map(
            (option) => option.getAttribute("aria-pressed") === "true",
          ),
        );
    assert.deepEqual(
      await selection(),
      scenarios.map((scenario) => scenario.selected),
    );
    assert.equal((await selection()).filter(Boolean).length, 5);
    assert.equal(
      await page.locator(".incident-map-marker.is-selected").count(),
      5,
    );
    const revisit = async () => {
      await page.locator('.sidebar a[href="#/tasks"]').click();
      await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
      await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
      await panel.waitFor();
    };
    allEnded = true;
    await revisit();
    assert.deepEqual(
      await selection(),
      scenarios.map(() => false),
    );
    assert.equal(
      (await selection()).filter(Boolean).length,
      0,
      "no default matches must not select all",
    );
    assert.equal(
      await page.locator(".incident-map-marker.is-selected").count(),
      0,
    );
    await page
      .locator('.dashboard-event-option[value="default-event-3"]')
      .click();
    await revisit();
    assert.equal((await selection()).filter(Boolean).length, 1);
    assert.deepEqual(
      await selection(),
      scenarios.map((_, index) => index === 3),
      "manual choices survive navigation",
    );
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await revisit();
    assert.deepEqual(
      await selection(),
      scenarios.map(() => true),
    );
    assert.equal((await selection()).filter(Boolean).length, 8);
  },
  "dashboard-map-responsive": async (page) => {
    const toggle = page.locator("#dashboard-map-toggle");
    const canvas = page.locator(".incident-map-canvas");
    const expanded = (value: boolean) =>
      page.waitForFunction(
        (expected) =>
          document
            .querySelector("#dashboard-map-toggle")
            ?.getAttribute("aria-expanded") === String(expected),
        value,
      );
    await expanded(true);
    assert.equal(
      await canvas
        .locator(".leaflet-tile")
        .first()
        .evaluate((element) => getComputedStyle(element).borderRadius),
      "0px",
    );
    assert.equal(
      await canvas
        .locator(".leaflet-control-attribution")
        .evaluate((element) => {
          const attribution = element.getBoundingClientRect();
          const frame = element
            .closest(".incident-map-canvas")!
            .getBoundingClientRect();
          return (
            attribution.top >= frame.top && attribution.bottom <= frame.bottom
          );
        }),
      true,
      "map attribution stays inside the visible map",
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/events-desktop.png",
    });
    await page.setViewportSize({ width: 900, height: 1000 });
    await expanded(false);
    await page.setViewportSize({ width: 1440, height: 600 });
    await expanded(false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expanded(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expanded(false);
    assert.equal(
      await canvas.count(),
      0,
      "the collapsed map is initialized only on demand",
    );
    await page
      .locator(".dashboard-event-list")
      .getByRole("button", { name: "南京鼓楼区火情", exact: true })
      .click();
    await page.screenshot({
      path: "../.artifacts/organizer/ux/events-mobile.png",
    });
    await toggle.click();
    await expanded(true);
    await page.locator(".incident-map-marker.is-selected").waitFor();
    const centered = () =>
      page.waitForFunction(() => {
        const map = document
          .querySelector(".incident-map-canvas")!
          .getBoundingClientRect();
        const pin = document
          .querySelector(".incident-map-marker.is-selected")!
          .getBoundingClientRect();
        return (
          Math.abs(pin.x + pin.width / 2 - map.x - map.width / 2) < 3 &&
          Math.abs(pin.y + pin.height / 2 - map.y - map.height / 2) < 3
        );
      });
    await centered();
    const marker = page.locator(".incident-map-marker.is-selected");
    const before = await marker.boundingBox();
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (x) =>
        document
          .querySelector(".incident-map-marker.is-selected")!
          .getBoundingClientRect().x <
        x - 10,
      before!.x,
    );
    await page.waitForFunction(
      () => !document.querySelector(".incident-map-canvas .leaflet-pan-anim"),
    );
    const moved = await marker.boundingBox();
    await page
      .getByRole("radio", { name: "按待审核人数", exact: true })
      .click();
    const afterSort = await marker.boundingBox();
    assert.ok(
      Math.abs(moved!.x - afterSort!.x) < 1,
      "sorting must not move the map camera",
    );
    await page
      .getByRole("button", { name: "回到所选事件", exact: true })
      .click();
    await centered();
    // Keyboard activation of a map marker shares the event filter selection.
    await marker.focus();
    await page.keyboard.press("Space");
    assert.equal(
      await page
        .locator(".dashboard-event-list")
        .getByRole("button", { name: "杭州西湖区火情", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await page.locator('.incident-map-marker[aria-pressed="true"]').count(),
      0,
    );
    await page
      .getByRole("heading", { name: "请选择事件", exact: true })
      .waitFor();
    await toggle.click();
    await page
      .locator(".dashboard-event-list")
      .getByRole("button", { name: "南京鼓楼区火情", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expanded(false);
    await toggle.click();
    await centered();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    const axe = await new AxeBuilder({ page })
      .include(".dashboard-events")
      .analyze();
    assert.deepEqual(axe.violations, []);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/events-small-expanded.png",
      fullPage: true,
    });
    await page.waitForFunction(() => {
      const frame = document
        .querySelector(".incident-map-canvas")!
        .getBoundingClientRect();
      return [...document.querySelectorAll(".incident-map-marker")].every(
        (marker) => {
          const box = marker.getBoundingClientRect();
          return (
            box.left >= frame.left &&
            box.right <= frame.right &&
            box.top >= frame.top &&
            box.bottom <= frame.bottom
          );
        },
      );
    });
  },
  "dashboard-events-many": async (page, context) => {
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data: Workspace = await response.json();
      const sample = data.tasks.find((task) => task.state === "open")!;
      data.incidents = Array.from({ length: 18 }, (_, i) => ({
        ...data.incidents[0],
        id: `incident-${i}`,
        title: `社区支援事件 ${i + 1}：长名称显示和事件筛选`,
        latitude: i === 17 ? NaN : 30 + i / 10,
      }));
      data.tasks = data.incidents.map((incident, i) => ({
        ...sample,
        id: `task-${i}`,
        incidentId: incident.id,
        incidentTitle: incident.title,
      }));
      await route.fulfill({ response, json: data });
    });
    await context.route("https://tile.openstreetmap.org/**", (route) =>
      route.abort(),
    );
    await page.reload();
    await page.locator("#dashboard-event-search").waitFor();
    const rows = page.locator(".dashboard-event-option:visible");
    assert.equal(await rows.count(), 5);
    await page
      .getByRole("button", { name: "更多事件（13）", exact: true })
      .click();
    assert.equal(await rows.count(), 18);
    await selectDashboardEvents(page, [
      "社区支援事件 18：长名称显示和事件筛选",
    ]);
    await page.getByRole("button", { name: "收起事件", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "搜索事件", exact: true })
      .fill("事件 18：");
    assert.equal(await rows.count(), 1);
    assert.equal(await rows.getAttribute("aria-pressed"), "true");
    await page
      .getByRole("searchbox", { name: "搜索事件", exact: true })
      .fill("");
    assert.equal(
      await rows.count(),
      6,
      "selected events stay visible beyond the collapsed preview",
    );
    assert.match(
      await page.locator(".incident-map-status").innerText(),
      /1 个事件暂无有效位置/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "回到所选事件", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await page.locator("#dashboard-tasks .task-row").count(), 1);
    await page
      .getByRole("searchbox", { name: "搜索事件", exact: true })
      .fill("无匹配");
    await page
      .getByText("没有匹配的事件，请换个关键词。", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    assert.equal(
      await page
        .locator('.dashboard-event-option[aria-pressed="true"]')
        .count(),
      18,
    );
    await page
      .getByRole("searchbox", { name: "搜索事件", exact: true })
      .fill("");
    await page
      .locator(".incident-map-status")
      .filter({ hasText: "底图暂不可用" })
      .waitFor();
    await rows.first().click();
    assert.equal(
      await page.locator("#dashboard-task-results").innerText(),
      "所选事件有 17 个需要关注的任务",
      "tile failures do not block filtering",
    );
  },
  "dashboard-fill": async (page) => {
    let mode = "pending";
    const total = 40;
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data = (await response.json()) as Workspace;
      const task = data.tasks.find((task) => task.state === "open")!;
      data.tasks =
        mode === "empty"
          ? []
          : Array.from({ length: total }, (_, i) => ({
              ...task,
              id: `viewport-task-${i}`,
              title: `关注任务 ${i + 1} · 社区物资整理与配送协调`,
              pending: mode === "pending" ? i + 1 : 0,
              updatedAt: new Date(Date.UTC(2026, 0, total - i)).toISOString(),
              deadline: new Date(Date.UTC(2099, 0, i + 1)).toISOString(),
            }));
      await route.fulfill({ response, json: data });
    });
    const rows = page.locator("#dashboard-tasks .task-row");
    const titles = page.locator("#dashboard-tasks .task-info > a");
    const filled = () =>
      page.waitForFunction(() => {
        const list = document.querySelector("#dashboard-tasks");
        const nav = document
          .querySelector(".mobile-nav")
          ?.getBoundingClientRect();
        const bottom = nav?.height ? nav.top : innerHeight;
        return !!list && list.getBoundingClientRect().bottom >= bottom;
      });
    await page.reload();
    await filled();
    const initial = await rows.count();
    assert.ok(
      initial > 0 && initial < total,
      "fill the viewport without a fixed five-row cap or rendering everything",
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/dashboard-fill-desktop.png",
    });
    await page.setViewportSize({ width: 1440, height: 1400 });
    await filled();
    assert.ok(
      (await rows.count()) > initial,
      "a taller window should show more tasks",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("radio", { name: "按待审核人数", exact: true })
      .click();
    await filled();
    assert.match(await titles.first().innerText(), /^关注任务 40 ·/);
    assert.ok(
      (await rows.count()) < total,
      "sorting resets progressive rendering",
    );
    const beforeMore = await rows.count();
    await page
      .locator("#dashboard-more")
      .evaluate((element) =>
        (element as HTMLElement).focus({ preventScroll: true }),
      );
    await page.keyboard.press("Enter");
    assert.ok(
      (await rows.count()) > beforeMore,
      "keyboard users can reveal another screen of tasks",
    );
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.matches("#dashboard-tasks .task-info > a"),
      ),
      true,
    );
    while ((await rows.count()) < total) {
      const before = await rows.count();
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll("#dashboard-tasks .task-row").length >
          count,
        before,
      );
    }
    assert.equal(await rows.count(), total);
    assert.equal(new Set(await titles.allTextContents()).size, total);
    assert.match(await titles.last().innerText(), /^关注任务 1 ·/);
    assert.equal(await page.locator("#dashboard-more").isVisible(), false);
    await page
      .getByRole("radio", { name: "按距截止时间", exact: true })
      .click();
    await filled();
    assert.match(await titles.first().innerText(), /^关注任务 1 ·/);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.reload();
    await filled();
    assert.ok((await rows.count()) < total);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/dashboard-fill-mobile.png",
    });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "标准字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await filled();
    mode = "open";
    await page.reload();
    await filled();
    assert.equal(await rows.getByRole("link", { name: /份待审核/ }).count(), 0);
    mode = "empty";
    await page.reload();
    await page
      .getByRole("heading", { name: "暂无任务", exact: true })
      .waitFor();
    assert.equal(await rows.count(), 0);
    assert.equal(await page.locator("#dashboard-more").isVisible(), false);
    await page.getByRole("link", { name: "全部任务", exact: false }).click();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
  },
  "date-years": async (page) => {
    // Beijing has entered 2027 while UTC is still in 2026.
    await page.clock.setFixedTime(new Date("2026-12-31T16:00:00Z"));
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const deadlines = [
        "2026-12-31T15:59:00Z",
        "2026-12-31T16:01:00Z",
        "2027-12-31T16:00:00Z",
      ];
      deadlines.forEach((deadline, i) => (data.tasks[i].deadline = deadline));
      await route.fulfill({ response, json: data });
    });
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.locator(".task-card").first().waitFor();
    const deadlines = await page.locator(".task-deadline").allTextContents();
    assert.match(deadlines[0], /2026年/);
    assert.doesNotMatch(deadlines[1], /年/);
    assert.match(deadlines[2], /2028年/);
    await page.setViewportSize({ width: 320, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  },
  "route-loading": async (page) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/organizer/workspace", async (route) => {
      await gate;
      await route.continue();
    });
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page
      .getByRole("status")
      .filter({ hasText: "正在加载页面" })
      .waitFor();
    assert.equal(await page.locator("#app").getAttribute("aria-busy"), "true");
    const progress = page.locator(".route-status");
    const aligned = () =>
      page.waitForFunction(
        () => {
          const bar = document
            .querySelector(".route-status")!
            .getBoundingClientRect();
          const header = document
            .querySelector(".topbar")!
            .getBoundingClientRect();
          return (
            bar.height === 3 &&
            bar.top === Math.max(0, header.bottom) &&
            bar.left === header.left &&
            bar.right === innerWidth
          );
        },
        undefined,
        { timeout: 5000 },
      );
    await aligned();
    assert.equal(
      await progress.locator(".sr-only").textContent(),
      "正在加载页面…",
    );
    const initialTransform = await progress.evaluate(
      (element) => getComputedStyle(element, "::before").transform,
    );
    await page.waitForFunction(
      (initial) =>
        getComputedStyle(document.querySelector(".route-status")!, "::before")
          .transform !== initial,
      initialTransform,
    );
    await page.waitForFunction(() => {
      const bar = document.querySelector(".route-status")!;
      const x = new DOMMatrixReadOnly(
        getComputedStyle(bar, "::before").transform,
      ).m41;
      return x > 0 && x < bar.clientWidth / 2;
    });
    await page.screenshot({
      path: "../.artifacts/organizer/ux/route-loading-desktop.png",
    });
    await page.setViewportSize({ width: 834, height: 1000 });
    await aligned();
    await page.setViewportSize({ width: 390, height: 844 });
    await aligned();
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await progress.evaluate(
        (element) => getComputedStyle(element, "::before").animationName,
      ),
      "none",
    );
    await page.screenshot({
      path: "../.artifacts/organizer/ux/route-loading-mobile.png",
    });
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForFunction(
      () =>
        document.querySelector(".route-status")!.getBoundingClientRect().top ===
        0,
    );
    await aligned();
    await page.emulateMedia({
      reducedMotion: "no-preference",
      forcedColors: "active",
    });
    assert.equal(
      await progress.evaluate(
        (element) => getComputedStyle(element, "::before").forcedColorAdjust,
      ),
      "none",
    );
    await page.emulateMedia({ forcedColors: "none" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    release();
    await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
    await page.locator(".route-status").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#app").getAttribute("aria-busy"), null);
    await page.unroute("**/api/organizer/workspace");
    await page.route("**/api/organizer/workspace", (route) =>
      route.fulfill({ status: 503, json: { error: "暂时无法连接" } }),
    );
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await page.getByRole("heading", { name: "暂时无法打开此页面" }).waitFor();
    assert.equal(await page.locator("#app").getAttribute("aria-busy"), null);
    assert.equal(await page.locator(".route-status").isVisible(), false);
    await page.unroute("**/api/organizer/workspace");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("heading", { name: "开始", exact: true }).waitFor();
  },
  "clear-filters": async (page) => {
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page.locator(".task-card").first().waitFor();
    const count = await page.locator(".task-card").count();
    await page
      .getByRole("searchbox", { name: "搜索任务", exact: true })
      .fill("没有这项任务XYZ");
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    assert.equal(await page.locator(".task-card:visible").count(), count);
    assert.equal(await page.locator("#task-search").inputValue(), "");
    await page
      .locator('.filter-chips a[href="#/tasks?state=archived"]')
      .click();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.locator(".task-card").first().waitFor();
    assert.equal(await page.locator(".task-card:visible").count(), count);
  },
  "task-filter-state": async (page) => {
    await page.locator('.sidebar a[href="#/tasks"]').click();
    const search = page.getByRole("searchbox", {
      name: "搜索任务",
      exact: true,
    });
    await search.fill("物资");
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption("incident-hangzhou");
    await page.locator(".filter-chips a").filter({ hasText: "招募中" }).click();
    await page.locator('.filter-chips a.active[href*="state=open"]').waitFor();
    await page.waitForFunction(
      () =>
        location.hash.includes("state=open") &&
        document.querySelector<HTMLInputElement>("#task-search")?.value ===
          "物资",
    );
    assert.equal(
      await page.getByLabel("所属事件", { exact: true }).inputValue(),
      "incident-hangzhou",
    );
    assert.equal(await page.locator(".task-card:visible").count(), 2);
    await page.reload();
    await search.waitFor();
    assert.equal(await search.inputValue(), "物资");
    assert.equal(await page.locator(".task-card:visible").count(), 2);
    await page.locator(".task-card:visible h2 a").first().click();
    await page.locator("#task-search").waitFor({ state: "hidden" });
    await page.goBack();
    await search.waitFor();
    assert.equal(await search.inputValue(), "物资");
    assert.equal(await page.locator(".task-card:visible").count(), 2);
    await search.fill('没有这项任务 & "XYZ"');
    await page.locator(".filter-chips a").filter({ hasText: "草稿" }).click();
    await page.locator('.filter-chips a.active[href*="state=draft"]').waitFor();
    await page.getByRole("button", { name: "清除筛选", exact: true }).waitFor();
    assert.equal(await search.inputValue(), '没有这项任务 & "XYZ"');
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.locator(".task-card").first().waitFor();
    assert.equal(await search.inputValue(), "");
    assert.equal(
      await page.getByLabel("所属事件", { exact: true }).inputValue(),
      "",
    );
    assert.equal(await page.locator(".task-card:visible").count(), 6);
  },
  "dashboard-deadlines": async (page) => {
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data = (await response.json()) as Workspace;
      data.tasks = data.tasks
        .filter((task) => task.state === "open")
        .map((task, index) => ({
          ...task,
          title: `截止检查 ${index + 1}`,
          deadline: ["", "2099-01-03T10:30:00Z", "2099-01-02T10:30:00Z"][index],
          pending: 1,
        }));
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    await page
      .getByRole("radio", { name: "按距截止时间", exact: true })
      .click();
    const rows = page.locator("#dashboard-tasks .task-row");
    while (await page.locator("#dashboard-more").isVisible())
      await page.locator("#dashboard-more").click();
    assert.deepEqual(await rows.locator(".task-info > a").allTextContents(), [
      "截止检查 3",
      "截止检查 2",
      "截止检查 1",
    ]);
    assert.match(
      await rows.first().locator(".task-deadline").innerText(),
      /2099年1月2日.*18:30.*截止/,
    );
    assert.equal(
      await rows.last().locator(".task-deadline").innerText(),
      "未设置截止时间",
    );
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    assert.equal(
      await rows.locator(".task-deadline").evaluateAll((elements) =>
        elements.every((el) => {
          const bounds = el.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            el.scrollWidth <= el.clientWidth
          );
        }),
      ),
      true,
    );
  },
  "mobile-editor-focus": async (page) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await page.locator("#task-form").waitFor();
    await expandEditorSection(page, "task-schedule");
    await expandEditorSection(page, "task-details");
    await page.evaluate(() => document.fonts.ready);
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 740, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page
          .locator(
            ".editor-section, #task-form input, #task-form select, #task-form textarea",
          )
          .evaluateAll((elements) =>
            elements.every((el) => {
              const box = el.getBoundingClientRect();
              return box.left >= 0 && box.right <= innerWidth;
            }),
          ),
        true,
        `${viewport.width}px: editor fields and panels fit`,
      );
      await page.locator("#title").focus();
      for (const id of [
        "title",
        "summary",
        "incidentId-picker",
        "ownerId-picker",
      ]) {
        await page.locator(`#${id}`).focus();
        await page.waitForFunction((id) => {
          const field = document.getElementById(id)!;
          const box = field.getBoundingClientRect();
          const footer = document
            .querySelector(".editor-footer")!
            .getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return (
            document.activeElement === field &&
            box.top >= 0 &&
            box.bottom <=
              (field.closest(".editor-footer")
                ? innerHeight
                : Math.min(footer.top, innerHeight)) &&
            (hit === field || field.contains(hit))
          );
        }, id);
      }
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator("#ownerId-picker").focus();
    await page.screenshot({
      path: "../.artifacts/organizer/ux/mobile-editor-focus-viewport.png",
    });
  },
  "mobile-review-layout": async (page) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole("button", { name: "文字大小", exact: true }).click();
    await page.getByRole("radio", { name: "更大字号", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.locator('.mobile-nav a[href="#/applications"]').click();
    await page.locator(".application-row").first().click();
    await page.locator("#review-form").waitFor();
    assert.equal(
      await page
        .getByRole("heading", { level: 1, name: "报名审核", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: "刷新", exact: true }).count(),
      0,
    );
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const headings = await new AxeBuilder({ page })
      .withRules(["page-has-heading-one"])
      .analyze();
    assert.deepEqual(headings.violations, []);
    assert.equal(
      await page.locator(".review-actions button").evaluateAll((buttons) =>
        buttons.every((button) => {
          const box = button.getBoundingClientRect();
          const text = Array.from(button.childNodes).filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
          return (
            box.left >= 0 &&
            box.right <= innerWidth &&
            button.scrollWidth <= button.clientWidth &&
            text.every((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              return range.getClientRects().length === 1;
            })
          );
        }),
      ),
      true,
      "review decisions remain whole labels at 320px with large text",
    );
    await page.locator(".review-actions").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "../.artifacts/organizer/ux/mobile-review-actions-viewport.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(
      await page
        .getByRole("heading", { level: 1, name: "报名审核", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByRole("button", { name: "刷新", exact: true }).isVisible(),
      true,
    );
  },
  "mobile-actions": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await page.locator("#task-form").waitFor();
    await expandEditorSection(page, "task-schedule");
    await expandEditorSection(page, "task-details");
    for (const size of ["normal", "large"]) {
      await page.getByRole("button", { name: "文字大小", exact: true }).click();
      await page
        .getByRole("radio", {
          name: size === "large" ? "更大字号" : "标准字号",
          exact: true,
        })
        .check();
      await page.keyboard.press("Escape");
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const actions = await page
          .locator(
            ".editor-footer button, .block-history button, .block-add-actions button",
          )
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect();
              const text = Array.from(button.childNodes).filter(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              );
              return {
                inside: box.left >= 0 && box.right <= innerWidth,
                wraps: text.some((node) => {
                  const range = document.createRange();
                  range.selectNodeContents(node);
                  return range.getClientRects().length > 1;
                }),
                fits: button.scrollWidth <= button.clientWidth,
              };
            }),
          );
        assert.equal(
          actions.every((a) => a.inside && !a.wraps && a.fits),
          true,
          `${width}px ${size}: action labels must fit`,
        );
      }
    }
    await page
      .getByRole("group", { name: "添加内容", exact: true })
      .scrollIntoViewIfNeeded();
  },
  "continuous-review": async (page) => {
    await review(page);
    const reviewedName = await page
      .locator(".application-row strong")
      .nth(1)
      .innerText();
    await page.locator(".application-row").nth(1).click();
    await page
      .getByRole("heading", { name: reviewedName, exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator("#review-fields")
        .evaluate((e) => (e as HTMLDetailsElement).open),
      false,
    );
    await page.locator(".review-task-context summary").click();
    await page.locator('.review-task-context a[href^="#/tasks/"]').waitFor();
    assert.match(
      await page.locator(".review-task-context").innerText(),
      /服务时间：/,
    );
    await page.getByRole("button", { name: "通过并通知", exact: true }).click();
    await page
      .getByRole("button", { name: "确认通过并通知", exact: true })
      .click();
    await page
      .locator(".review-outcome")
      .filter({ hasText: reviewedName })
      .waitFor();
    await page.getByRole("link", { name: "审核下一份", exact: true }).click();
    await page.locator("#review-form").waitFor();
    assert.notEqual(
      await page.locator(".review-heading h2").innerText(),
      reviewedName,
    );
    await page.getByRole("link", { name: "查看审核结果", exact: true }).click();
    await page
      .getByRole("heading", { name: reviewedName, exact: true })
      .waitFor();
    await page.locator(".contact-row").first().waitFor();
  },
  "map-annotations": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await expandEditorSection(page, "task-schedule");
    await expandEditorSection(page, "task-details");
    await page.getByLabel("任务标题", { exact: true }).fill("地图标注验证");
    await page.locator("#incidentId-picker").click();
    await page.locator(".task-picker-list button").first().click();
    await page
      .getByLabel("工作内容与能力要求摘要")
      .fill("多处位置、路线与活动范围");
    await page.getByLabel("地点描述", { exact: true }).fill("社区服务中心");
    await page.getByRole("button", { name: "添加地图", exact: true }).click();
    const map = page.locator("#blocks firelink-map");
    await map.locator(".leaflet-container").waitFor();
    const annotations = async () =>
      JSON.parse(
        (await map.getAttribute("annotations")) || "[]",
      ) as MapAnnotation[];
    const clickPoint = async (x: number, y: number) => {
      const bounds = (await map.locator(".canvas").boundingBox())!;
      await map
        .locator(".canvas")
        .click({ position: { x: bounds.width * x, y: bounds.height * y } });
    };
    await clickPoint(0.3, 0.35);
    await clickPoint(0.65, 0.35);
    assert.equal((await annotations()).length, 2);
    await map.getByRole("button", { name: "路径", exact: true }).click();
    // Existing locations can also be selected as vertices of a new route.
    await map.locator(".location-marker").first().click();
    assert.equal(
      await map
        .getByRole("button", { name: "完成路径", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await page.locator("#publish-task").isDisabled(), true);
    await clickPoint(0.4, 0.8);
    await clickPoint(0.7, 0.7);
    await map.getByRole("button", { name: "完成路径", exact: true }).click();
    assert.equal(await map.locator(".location-path").count(), 1);
    await map.getByRole("button", { name: "范围", exact: true }).click();
    await clickPoint(0.65, 0.12);
    await clickPoint(0.85, 0.25);
    assert.equal(
      await map
        .getByRole("button", { name: "完成范围", exact: true })
        .isDisabled(),
      true,
    );
    await clickPoint(0.8, 0.5);
    await map.getByRole("button", { name: "完成范围", exact: true }).click();
    assert.equal(await map.locator(".location-area").count(), 1);
    assert.equal(await page.locator("#publish-task").isEnabled(), true);
    assert.deepEqual(
      (await annotations()).map((mark) => mark.type),
      ["point", "point", "path", "area"],
    );
    const beforeDelete = await annotations();
    await map.getByRole("button", { name: "删除范围 4", exact: true }).click();
    assert.equal((await annotations()).length, 3);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual(await annotations(), beforeDelete);
    await map.locator(".canvas").scrollIntoViewIfNeeded();
    const marker = (await map
      .locator(".location-marker")
      .nth(1)
      .boundingBox())!;
    const beforeDrag = (await annotations())[1].coordinates[0];
    await page.mouse.move(
      marker.x + marker.width / 2,
      marker.y + marker.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      marker.x + marker.width / 2 + 24,
      marker.y + marker.height / 2 + 20,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.notDeepEqual((await annotations())[1].coordinates[0], beforeDrag);
    await map
      .getByRole("button", { name: "路径 3 · 3 个点", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await map.evaluate(
        (element) =>
          (element.shadowRoot?.activeElement as HTMLElement)?.dataset.select,
      ),
      "2",
    );
    await map
      .getByRole("button", { name: "选择第 2 个点", exact: true })
      .click();
    const beforePointDelete = await annotations();
    await map.getByRole("button", { name: "删除所选点", exact: true }).click();
    assert.equal((await annotations())[2].coordinates.length, 2);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual(await annotations(), beforePointDelete);
    await map
      .getByRole("button", { name: "路径 3 · 3 个点", exact: true })
      .click();
    await map
      .getByRole("button", { name: "选择第 2 个点", exact: true })
      .click();
    await map.locator(".precise summary").click();
    await map.getByLabel("纬度", { exact: true }).fill("30.275");
    await map.getByRole("button", { name: "更新所选点", exact: true }).click();
    assert.equal((await annotations())[2].coordinates[1].latitude, 30.275);
    await map.locator(".precise summary").click();
    await map.getByRole("button", { name: "完成路径", exact: true }).click();
    const expected = await annotations();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    await map.screenshot({
      path: "../.artifacts/organizer/ux/map-annotations-desktop.png",
    });
    await page.locator('.sidebar a[href="#/tasks"]').click();
    await page
      .locator(".task-card")
      .filter({
        has: page.getByRole("heading", { name: "地图标注验证", exact: true }),
      })
      .getByRole("link", { name: "继续编辑", exact: true })
      .click();
    await expandEditorSection(page, "task-details");
    await map.waitFor();
    assert.deepEqual(await annotations(), expected);
    await page.setViewportSize({ width: 320, height: 844 });
    await map.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const root = document.querySelector("#blocks firelink-map")?.shadowRoot;
      const bounds = root?.querySelector(".canvas")?.getBoundingClientRect();
      const markers = root?.querySelectorAll(".location-marker");
      return (
        bounds &&
        markers?.length &&
        Array.from(markers).every((marker) => {
          const point = marker.getBoundingClientRect();
          return (
            point.left >= bounds.left &&
            point.right <= bounds.right &&
            point.top >= bounds.top &&
            point.bottom <= bounds.bottom
          );
        })
      );
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await map.screenshot({
      path: "../.artifacts/organizer/ux/map-annotations-mobile.png",
    });
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await map.screenshot({
      path: "../.artifacts/organizer/ux/map-annotations-dark.png",
    });
    await page.getByRole("button", { name: "发布招募", exact: true }).click();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await page
      .getByRole("heading", { name: "地图标注验证", level: 1, exact: true })
      .waitFor();
    const preview = page.locator(".description firelink-map");
    await preview.scrollIntoViewIfNeeded();
    await preview.locator(".location-path").waitFor();
    assert.equal(await preview.locator(".location-area").count(), 1);
    assert.equal(await preview.locator(".location-marker").count(), 8);
  },
  "task-time-defaults": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    const start = page.getByLabel("任务开始时间", { exact: true });
    const end = page.getByLabel("任务结束时间", { exact: true });
    const deadline = page.getByLabel("报名截止时间", { exact: true });
    for (const [now, startsAt, closesAt, endsAt] of [
      [
        "2030-12-31T15:14:25Z",
        "2030-12-31T23:30",
        "2030-12-31T23:24",
        "2031-01-01T12:00",
      ],
      [
        "2030-12-31T15:15:00Z",
        "2030-12-31T23:30",
        "2030-12-31T23:25",
        "2031-01-01T12:00",
      ],
      [
        "2030-12-31T15:15:01Z",
        "2030-12-31T23:45",
        "2030-12-31T23:25",
        "2031-01-01T12:00",
      ],
      [
        "2030-12-31T15:30:00Z",
        "2030-12-31T23:45",
        "2030-12-31T23:40",
        "2031-01-01T12:00",
      ],
      [
        "2030-12-31T15:59:59Z",
        "2031-01-01T00:15",
        "2031-01-01T00:09",
        "2031-01-01T12:00",
      ],
      [
        "2030-12-31T16:00:00Z",
        "2031-01-01T00:15",
        "2031-01-01T00:10",
        "2031-01-01T12:00",
      ],
    ]) {
      await page.clock.setFixedTime(new Date(now));
      await page.reload();
      await expandEditorSection(page, "task-schedule");
      await start.waitFor();
      assert.equal(await start.inputValue(), startsAt);
      assert.equal(await deadline.inputValue(), closesAt);
      assert.equal(await end.inputValue(), endsAt);
      assert.ok(
        Date.parse(`${startsAt}:00+08:00`) - Date.parse(now) >= 15 * 60000,
      );
      assert.ok(
        Date.parse(`${endsAt}:00+08:00`) - Date.parse(now) >= 12 * 3600000,
      );
      assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    }
    assert.equal(await page.getByLabel("人数上限", { exact: true }).count(), 1);
    assert.equal(await page.locator("#location-help").count(), 0);
    assert.equal(
      await page
        .getByText("只选择判断志愿者是否适合本任务所需的资料。", {
          exact: true,
        })
        .count(),
      0,
    );
    await expandEditorSection(page, "task-details");
    assert.equal(
      await page.getByRole("heading", { name: /详细信息/ }).count(),
      1,
    );
    assert.equal(await page.getByLabel("文本内容", { exact: true }).count(), 1);
    assert.match(
      await page.locator("#live-preview").innerText(),
      /任务开始（北京时间）/,
    );
    assert.match(
      await page.locator("#live-preview").innerText(),
      /任务结束（北京时间）/,
    );
    await page
      .getByLabel("任务标题", { exact: true })
      .fill("任务时间默认值验证");
    await page.locator("#incidentId-picker").click();
    await page.locator(".task-picker-list button").first().click();
    await page.getByLabel("工作内容与能力要求摘要").fill("整理社区物资");
    await page.getByLabel("地点描述", { exact: true }).fill("社区服务中心");
    assert.equal(
      await page
        .getByRole("button", { name: "发布招募", exact: true })
        .isEnabled(),
      true,
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    await page.locator('.sidebar a[href="#/tasks"]').click();
    const card = page.locator(".task-card").filter({
      has: page.getByRole("heading", {
        name: "任务时间默认值验证",
        exact: true,
      }),
    });
    await page.clock.setFixedTime(new Date("2031-01-01T17:42:00Z"));
    await card.getByRole("link", { name: "继续编辑", exact: true }).click();
    await expandEditorSection(page, "task-schedule");
    await start.waitFor();
    assert.equal(
      await start.inputValue(),
      "2031-01-01T00:15",
      "editing must preserve saved times",
    );
    assert.equal(await deadline.inputValue(), "2031-01-01T00:10");
    assert.equal(await end.inputValue(), "2031-01-01T12:00");
    await page.getByRole("link", { name: "返回任务", exact: false }).click();
    await card.locator("h2 a").click();
    await page.getByRole("button", { name: "复制", exact: true }).click();
    await expandEditorSection(page, "task-schedule");
    await start.waitFor();
    assert.equal(
      await start.inputValue(),
      "2031-01-02T02:00",
      "copies use fresh defaults",
    );
    assert.equal(await deadline.inputValue(), "2031-01-02T01:52");
    assert.equal(await end.inputValue(), "2031-01-02T14:00");
    const timePanel = page
      .locator(".editor-section")
      .filter({ hasText: "时间 地点及人数" });
    await timePanel.screenshot({
      path: "../.artifacts/organizer/ux/task-times-desktop.png",
    });
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await timePanel.screenshot({
      path: "../.artifacts/organizer/ux/task-times-mobile.png",
    });
  },
  "publish-readiness": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await expandEditorSection(page, "task-schedule");
    await expandEditorSection(page, "task-details");
    const publish = page.locator("#publish-task");
    await publish.waitFor();
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (7/9)");
    assert.equal(await page.locator(".publish-readiness").count(), 0);
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    await page.getByLabel("任务标题", { exact: true }).fill("准备检查回归");
    assert.equal(await publish.innerText(), "发布招募 (8/9)");
    await page
      .getByLabel("工作内容与能力要求摘要", { exact: true })
      .fill("整理社区物资");
    assert.equal(await publish.innerText(), "发布招募 (9/9)");
    assert.equal(await publish.isDisabled(), true);
    assert.match((await publish.getAttribute("title")) || "", /请选择事件/);
    await page.locator("#incidentId-picker").click();
    await page.locator(".task-picker-list button").first().click();
    await page
      .getByLabel("工作内容与能力要求摘要", {
        exact: true,
      })
      .fill("整理社区物资");
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("任务开始时间", { exact: true }).fill(`${day}T10:00`);
    await page.getByLabel("任务结束时间", { exact: true }).fill(`${day}T11:00`);
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T12:00`);
    assert.equal(
      await page.getByLabel("地点描述", { exact: true }).inputValue(),
      "",
    );
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (8/9)");
    assert.match(
      await page.locator("#deadline-publish-error").innerText(),
      /不能晚于任务结束时间/,
    );
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T10:30`);
    assert.equal(await publish.isEnabled(), true);
    assert.equal(await publish.innerText(), "发布招募");
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    await page.getByLabel("任务标题", { exact: true }).fill("");
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (8/9)");
    await page.getByLabel("任务标题", { exact: true }).fill("准备检查回归");
    await page.getByLabel("人数上限", { exact: true }).fill("0");
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (9/10)");
    await page.getByLabel("人数上限", { exact: true }).fill("");
    assert.equal(await publish.isEnabled(), true);
    await page.getByRole("button", { name: "添加图片", exact: true }).click();
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (9/10)");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await publish.isEnabled(), true);
    // A completed draft becomes unavailable when its deadline passes, even
    // without another form edit.
    await page.clock.install({ time: new Date(`${day}T08:59:59+08:00`) });
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:01`);
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:00`);
    await page.clock.runFor(1100);
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (8/9)");
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:30`);
    assert.equal(await publish.isEnabled(), true);
    await page.getByRole("button", { name: "发布招募", exact: true }).click();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await page.locator("#task-form").waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "准备检查回归", exact: true, level: 1 })
      .waitFor();
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.organization.verified = false;
      data.organization.contacts = [];
      await route.fulfill({ response, json: data });
    });
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .first()
      .click();
    await publish.waitFor();
    assert.equal(await publish.innerText(), "发布招募 (5/9)");
    assert.equal(await publish.isDisabled(), true);
    assert.match(
      (await publish.getAttribute("title")) || "",
      /请先完成组织认证/,
    );
    assert.match(
      (await publish.getAttribute("title")) || "",
      /至少一种公开联系方式/,
    );
  },
  "publish-missing-owner": async (page) => {
    await page.route("**/api/organizer/workspace", async (route) => {
      const response = await route.fetch();
      const data: Workspace = await response.json();
      data.members = [];
      await route.fulfill({ response, json: data });
    });
    await page.locator('.sidebar a[href="#/tasks/new"]').click();
    const publish = page.locator("#publish-task");
    await page.getByLabel("任务标题", { exact: true }).fill("负责人必填检查");
    await page
      .getByLabel("工作内容与能力要求摘要", { exact: true })
      .fill("检查发布条件");
    assert.equal(await publish.innerText(), "发布招募 (9/9)");
    assert.equal(await publish.isDisabled(), true);
    assert.match((await publish.getAttribute("title")) || "", /请选择事件/);
    assert.match((await publish.getAttribute("title")) || "", /请选择负责人/);
    await page.locator("#incidentId-picker").click();
    await page.locator(".task-picker-list button").first().click();
    assert.equal(await publish.innerText(), "发布招募 (9/9)");
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.getAttribute("title"), "请选择负责人");
  },
  "organization-drafts": async (page) => {
    const settings = () =>
      page.locator('.sidebar a[href="#/settings"]').click();
    await settings();
    await page.getByLabel("组织介绍", { exact: true }).fill("暂存组织介绍");
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await page.getByRole("heading", { name: "开始", exact: true }).waitFor();
    await settings();
    await page
      .locator("#organization-draft-status")
      .filter({ hasText: "未保存" })
      .waitFor();
    assert.equal(
      await page.getByLabel("组织介绍", { exact: true }).inputValue(),
      "暂存组织介绍",
    );
    await page
      .getByRole("button", { name: "保存组织资料", exact: true })
      .click();
    await page
      .locator("#organization-draft-status")
      .filter({ hasText: /^$/ })
      .waitFor({ state: "attached" });
    await page.reload();
    await page
      .getByRole("heading", { name: "组织设置", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("组织介绍", { exact: true }).inputValue(),
      "暂存组织介绍",
    );
  },
  "block-undo": async (page) => {
    await editDraft(page);
    await expandEditorSection(page, "task-details");
    const undo = page.getByRole("button", { name: "撤销", exact: true });
    const redo = page.getByRole("button", { name: "重做", exact: true });
    assert.equal(await undo.isDisabled(), true);
    assert.equal(await redo.isDisabled(), true);
    const contents = () =>
      page
        .locator('#blocks [name^="block-text-"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLInputElement).value),
        );
    const before = await contents();
    await page
      .getByRole("button", { name: "删除第 2 段", exact: true })
      .click();
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    assert.equal((await contents()).length, before.length - 1);
    await page
      .getByRole("button", { name: "删除第 1 段", exact: true })
      .click();
    await undo.click();
    await undo.click();
    assert.deepEqual(await contents(), before);
    assert.equal(await undo.isDisabled(), true);
    await redo.click();
    await redo.click();
    assert.equal((await contents()).length, before.length - 2);
    assert.equal(await redo.isDisabled(), true);
    await undo.click();
    await undo.click();
    assert.deepEqual(await contents(), before);
    assert.equal(
      await page.getByText("本次编辑可撤销", { exact: false }).count(),
      0,
    );

    // A new change after undo starts a new branch and drops the redo history.
    await page.getByRole("button", { name: "添加文本", exact: true }).click();
    assert.equal(await redo.isDisabled(), true);
    const added = page.locator('#blocks [name^="block-text-"]').last();
    await added.pressSequentially("新增的段落");
    await undo.click();
    assert.equal(await added.inputValue(), "");
    await redo.click();
    assert.equal(await added.inputValue(), "新增的段落");
    await page
      .getByRole("button", {
        name: `上移第 ${before.length + 1} 段`,
        exact: true,
      })
      .click();
    assert.equal((await contents())[before.length - 1], "新增的段落");
    await undo.click();
    assert.equal((await contents())[before.length], "新增的段落");
    await undo.click();
    await undo.click();
    assert.deepEqual(await contents(), before);

    for (const name of ["小标题", "文本", "图片", "视频", "表格", "地图"]) {
      await page
        .getByRole("button", { name: `添加${name}`, exact: true })
        .click();
      const block = page.locator(".block-editor").last();
      assert.match(await block.locator("strong").innerText(), new RegExp(name));
      await undo.click();
      assert.deepEqual(await contents(), before);
      await redo.click();
      assert.equal((await contents()).length, before.length + 1);
      await undo.click();
    }
    assert.equal(
      await page
        .locator("#redo-block")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    await page.reload();
    await page.locator("#task-form").waitFor();
    await expandEditorSection(page, "task-details");
    assert.deepEqual(await contents(), before);
    assert.equal(await undo.isDisabled(), true);
    assert.equal(await redo.isDisabled(), true);
  },
  "review-drafts": async (page) => {
    await review(page);
    const first = await page
      .locator(".application-row")
      .first()
      .getAttribute("href");
    const firstName = await page
      .locator(".application-row strong")
      .first()
      .innerText();
    const secondName = await page
      .locator(".application-row strong")
      .nth(1)
      .innerText();
    await reviewFields(page);
    await page
      .getByLabel("给志愿者的回应", { exact: true })
      .fill("请确认服务时间。");
    await page.getByLabel("内部备注（不发送给志愿者）").fill("等待同事核对。");
    await page
      .locator("#review-draft-status")
      .filter({ hasText: "未提交" })
      .waitFor();
    await page.locator(".application-row").nth(1).click();
    await page
      .getByRole("heading", { name: secondName, exact: true })
      .waitFor();
    await reviewFields(page);
    assert.equal(await page.locator("#response").inputValue(), "");
    await page.locator(`.application-row[href="${first}"]`).click();
    await page.getByRole("heading", { name: firstName, exact: true }).waitFor();
    await reviewFields(page);
    assert.equal(
      await page.locator("#response").inputValue(),
      "请确认服务时间。",
    );
    assert.equal(await page.locator("#note").inputValue(), "等待同事核对。");
    await page.getByRole("link", { name: "当前账户设置" }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("dialog").filter({ hasText: "尚未提交" }).waitFor();
    await page.getByRole("button", { name: "继续处理", exact: true }).click();
    await review(page);
    await page.locator(`.application-row[href="${first}"]`).click();
    await reviewFields(page);
    assert.equal(await page.locator("#note").inputValue(), "等待同事核对。");
    await page.getByRole("button", { name: "通过并通知", exact: true }).click();
    assert.equal(
      await page.getByLabel("发送给志愿者的回应").inputValue(),
      "请确认服务时间。",
    );
    await page
      .getByRole("button", { name: "确认通过并通知", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.locator(".filter-chips a").filter({ hasText: "已通过" }).click();
    await page.locator(".contact-row").first().waitFor();
    await page.getByRole("link", { name: "当前账户设置" }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("heading", { name: "组织者登录" }).waitFor();
  },
};
try {
  await mkdir("../.artifacts/organizer/ux", { recursive: true });
  for (const [name, run] of Object.entries(cases)) {
    if (selected && !selected.includes(name)) continue;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      locale: "zh-CN",
    });
    await context.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    const page = await context.newPage();
    await isolateLocalDemo(context, base);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(base);
      await page
        .getByRole("button", { name: "进入演示工作台", exact: true })
        .click();
      await page.getByRole("heading", { name: "开始", exact: true }).waitFor();
      await run(page, context);
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: `../.artifacts/organizer/ux/${name}.png`,
        fullPage: true,
      });
      console.log(`PASS ${name}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
