import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { chromium, type Page, type BrowserContext } from "playwright";
import type { MapAnnotation, Workspace } from "../../shared/organizer";
import { isolateLocalDemo } from "./local-demo";

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
async function editDraft(page: Page) {
  await page.locator('.sidebar a[href="#/tasks"]').click();
  await page.getByRole("link", { name: "继续编辑" }).first().click();
  await page.locator("#task-form").waitFor();
}
const cases: Record<
  string,
  (page: Page, context: BrowserContext) => Promise<void>
> = {
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page.getByRole("heading", { name: "任务管理", exact: true }).click();
    await menu.waitFor({ state: "hidden" });
    await page.locator('.sidebar a[href="#/settings"]').click();
    await page.getByRole("button", { name: "邀请成员", exact: true }).click();
    const role = page.getByLabel("成员角色", { exact: true });
    await role.click();
    await menu.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").isVisible(), true);
    await role.click();
    await menu.getByRole("option", { name: "任务负责人", exact: true }).click();
    assert.equal(await role.inputValue(), "manager");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.locator('.sidebar a[href="#/tasks/new"]').click();
    await page.locator("#task-form").waitFor();
    const editorIncident = page.getByLabel("所属事件", { exact: true });
    await editorIncident.click();
    await menu
      .getByRole("option", { name: "南京鼓楼区火情", exact: true })
      .click();
    assert.equal(
      await page
        .locator("#task-form")
        .evaluate((form) =>
          new FormData(form as HTMLFormElement).get("incidentId"),
        ),
      "incident-nanjing",
    );
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: "深色", exact: true }).check();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 740 });
    await editorIncident.click();
    await menu.waitFor();
    const bounds = await menu.boundingBox();
    assert.ok(
      bounds &&
        bounds.x >= 0 &&
        bounds.x + bounds.width <= 320 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 740,
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("任务负责人", { exact: true }).click();
    await menu.waitFor();
  },
  "incident-tasks": async (page) => {
    const incidents = () => page.goto(`${base}/#/incidents`);
    const cards = page.locator(".incident-grid > .panel");
    const visibleTasks = page.locator(".task-card:visible");
    await incidents();
    await page
      .getByRole("heading", { name: "活跃事件", exact: true })
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
    assert.equal(await visibleTasks.count(), 4);
    await page.goBack();
    await page
      .getByRole("heading", { name: "活跃事件", exact: true })
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
      initial > 5 && initial < total,
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page
      .getByRole("heading", { name: "任务管理", exact: true })
      .waitFor();
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
    await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
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
  "mobile-actions": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await page.locator("#task-form").waitFor();
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
    await page.getByLabel("任务标题", { exact: true }).fill("地图标注验证");
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("一句话说明志愿者大概要做什么、有什么基本要求")
      .fill("多处位置、路线与活动范围");
    await page.getByLabel("服务地点", { exact: true }).fill("社区服务中心");
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
        "2031-01-01T23:14",
        "2031-01-02T23:14",
      ],
      [
        "2030-12-31T15:30:00Z",
        "2031-01-01T00:00",
        "2031-01-01T23:30",
        "2031-01-02T23:30",
      ],
      [
        "2030-12-31T16:00:00Z",
        "2031-01-01T00:30",
        "2031-01-02T00:00",
        "2031-01-03T00:00",
      ],
    ]) {
      await page.clock.setFixedTime(new Date(now));
      await page.reload();
      await start.waitFor();
      assert.equal(await start.inputValue(), startsAt);
      assert.equal(await deadline.inputValue(), closesAt);
      assert.equal(await end.inputValue(), endsAt);
      assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    }
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
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("一句话说明志愿者大概要做什么、有什么基本要求")
      .fill("整理社区物资");
    await page.getByLabel("服务地点", { exact: true }).fill("社区服务中心");
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
    await start.waitFor();
    assert.equal(
      await start.inputValue(),
      "2031-01-01T00:30",
      "editing must preserve saved times",
    );
    assert.equal(await deadline.inputValue(), "2031-01-02T00:00");
    assert.equal(await end.inputValue(), "2031-01-03T00:00");
    await page.getByRole("link", { name: "返回任务", exact: false }).click();
    await card.locator("h2 a").click();
    await page.getByRole("button", { name: "复制", exact: true }).click();
    await start.waitFor();
    assert.equal(
      await start.inputValue(),
      "2031-01-02T02:00",
      "copies use fresh defaults",
    );
    assert.equal(await deadline.inputValue(), "2031-01-03T01:42");
    assert.equal(await end.inputValue(), "2031-01-04T01:42");
    const timePanel = page
      .locator(".editor-section")
      .filter({ hasText: "时间与地点" });
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
    const publish = page.locator("#publish-task");
    await publish.waitFor();
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (7/11)");
    assert.equal(await page.locator(".publish-readiness").count(), 0);
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    await page.getByLabel("任务标题", { exact: true }).fill("准备检查回归");
    assert.equal(await publish.innerText(), "发布招募 (8/11)");
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("一句话说明志愿者大概要做什么、有什么基本要求", {
        exact: true,
      })
      .fill("整理社区物资");
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("任务开始时间", { exact: true }).fill(`${day}T10:00`);
    await page.getByLabel("任务结束时间", { exact: true }).fill(`${day}T11:00`);
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T12:00`);
    await page.getByLabel("服务地点", { exact: true }).fill("社区服务中心");
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (10/11)");
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
    assert.equal(await publish.innerText(), "发布招募 (10/11)");
    await page.getByLabel("任务标题", { exact: true }).fill("准备检查回归");
    await page.getByLabel("计划招募人数", { exact: true }).fill("0");
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (11/12)");
    await page.getByLabel("计划招募人数", { exact: true }).fill("");
    assert.equal(await publish.isEnabled(), true);
    await page.getByRole("button", { name: "添加图片", exact: true }).click();
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (11/12)");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal(await publish.isEnabled(), true);
    // A completed draft becomes unavailable when its deadline passes, even
    // without another form edit.
    await page.clock.install({ time: new Date(`${day}T08:59:59+08:00`) });
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:01`);
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:00`);
    await page.clock.runFor(1100);
    assert.equal(await publish.isDisabled(), true);
    assert.equal(await publish.innerText(), "发布招募 (10/11)");
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
    assert.equal(await publish.innerText(), "发布招募 (5/11)");
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
  "organization-drafts": async (page) => {
    const settings = () =>
      page.locator('.sidebar a[href="#/settings"]').click();
    await settings();
    await page.getByLabel("组织介绍", { exact: true }).fill("暂存组织介绍");
    await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
    await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
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
    await page.getByRole("button", { name: "添加段落", exact: true }).click();
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

    for (const name of ["小标题", "段落", "图片", "视频", "表格", "地图"]) {
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
      await page
        .getByRole("heading", { name: "工作台", exact: true })
        .waitFor();
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
