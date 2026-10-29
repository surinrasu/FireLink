import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { chromium, type Page, type BrowserContext } from "playwright";

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
  "route-loading": async (page) => {
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
      await page.getByRole("button", { name: "外观与阅读设置" }).click();
      await page.getByLabel("文字大小", { exact: true }).selectOption(size);
      await page.getByRole("button", { name: "完成", exact: true }).click();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const actions = await page
          .locator(".editor-footer button")
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
  "publish-readiness": async (page) => {
    await page
      .getByRole("link", { name: "新建任务", exact: true })
      .last()
      .click();
    await page
      .locator("#publish-status")
      .filter({ hasText: "发布还需完成" })
      .waitFor();
    await page.getByRole("button", { name: "发布招募", exact: true }).click();
    assert.equal(
      await page
        .locator("#title")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(
      await page.locator("#summary").getAttribute("aria-invalid"),
      "true",
    );
    await page.getByLabel("任务标题", { exact: true }).fill("准备检查回归");
    await page
      .getByLabel("所属事件", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("一句话介绍任务", { exact: true })
      .fill("整理社区物资");
    const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel("服务开始时间", { exact: true }).fill(`${day}T10:00`);
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T12:00`);
    await page.getByLabel("服务地点", { exact: true }).fill("社区服务中心");
    assert.match(
      await page.locator("#publish-issues").innerText(),
      /不能晚于服务开始时间/,
    );
    await page.getByLabel("报名截止时间", { exact: true }).fill(`${day}T09:00`);
    await page
      .locator("#publish-status")
      .filter({ hasText: "发布准备已完成" })
      .waitFor();
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    await page.getByRole("button", { name: "发布招募", exact: true }).click();
    await page.getByRole("button", { name: "确认发布", exact: true }).click();
    await page
      .getByRole("heading", { name: "准备检查回归", exact: true })
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
    await page.locator("#publish-status").click();
    await page
      .getByRole("link", { name: "请先完成组织认证", exact: true })
      .waitFor();
    await page
      .getByRole("link", {
        name: "请在组织设置中填写至少一种公开联系方式",
        exact: true,
      })
      .waitFor();
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
    await page.getByRole("button", { name: "撤销删除", exact: true }).click();
    await page.getByRole("button", { name: "撤销删除", exact: true }).click();
    assert.deepEqual(await contents(), before);
    assert.equal(
      await page
        .locator('[name="block-text-1"]')
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
    await page.reload();
    await page.locator("#task-form").waitFor();
    assert.deepEqual(await contents(), before);
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
    await page.getByRole("button", { name: "账号菜单" }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("dialog").filter({ hasText: "尚未提交" }).waitFor();
    await page.getByRole("button", { name: "继续处理", exact: true }).click();
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
    await page.getByRole("button", { name: "账号菜单" }).click();
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
