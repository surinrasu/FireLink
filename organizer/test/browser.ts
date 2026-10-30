import assert from "node:assert/strict";
import { mkdir, access } from "node:fs/promises";
import { chromium } from "playwright";
import { isolateLocalDemo } from "./local-demo";
const url = process.env.TEST_URL || "http://127.0.0.1:8787";
let executablePath = process.env.BROWSER_EXECUTABLE;
if (!executablePath && process.platform === "darwin") {
  const chrome = "/Applications/Chrome.app/Contents/MacOS/Chrome";
  try {
    await access(chrome);
    executablePath = chrome;
  } catch {
    /* use Playwright's installed Chromium */
  }
}
await mkdir("../.artifacts/organizer", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  // Keep automated page traversal off the community tile service.
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
  await isolateLocalDemo(context, url);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("heading", { name: "组织者登录" }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/desktop-login.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "进入演示工作台", exact: true })
    .click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/desktop-dashboard.png",
    fullPage: true,
  });
  assert.equal(await page.locator(".metric").count(), 0);
  assert.equal(
    await page.locator('.sidebar a[href="#/tasks"] .count').textContent(),
    "6",
  );
  await page.getByRole("link", { name: "草稿 1", exact: true }).click();
  await page.getByRole("heading", { name: "任务管理", exact: true }).waitFor();
  assert.equal(await page.locator(".task-card").count(), 1);
  assert.equal(await page.locator(".task-card .status-draft").count(), 1);
  // Give each ordering a distinct result, including a task with no deadline.
  await page.route(
    "**/api/organizer/workspace",
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const dates = ["2026-01-03", "2026-01-01", "2026-01-02"];
      const deadlines = ["", "2099-01-02", "2099-01-01"];
      const pending = [1, 3, 2];
      data.tasks
        .filter((task: { state: string }) => task.state === "open")
        .forEach(
          (
            task: { updatedAt: string; deadline: string; pending: number },
            index: number,
          ) => {
            task.updatedAt = dates[index];
            task.deadline = deadlines[index];
            task.pending = pending[index];
          },
        );
      await route.fulfill({ response, json: data });
    },
    { times: 1 },
  );
  await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  const taskTitles = () =>
    page.locator("#dashboard-tasks .task-info > a").allTextContents();
  assert.deepEqual(await taskTitles(), [
    "安置点物资整理",
    "临时服务点信息登记",
    "物资运输协助",
  ]);
  await page.getByRole("radio", { name: "按待审核人数", exact: true }).click();
  assert.deepEqual(await taskTitles(), [
    "物资运输协助",
    "临时服务点信息登记",
    "安置点物资整理",
  ]);
  await page.getByRole("radio", { name: "按距截止时间", exact: true }).click();
  assert.deepEqual(await taskTitles(), [
    "临时服务点信息登记",
    "物资运输协助",
    "安置点物资整理",
  ]);
  await page.getByRole("radio", { name: "按最近更新", exact: true }).click();
  assert.deepEqual(await taskTitles(), [
    "安置点物资整理",
    "临时服务点信息登记",
    "物资运输协助",
  ]);
  await page.locator('.sidebar a[href="#/applications"]').click();
  await page.getByRole("heading", { name: "联系方式", exact: true }).waitFor();
  assert.equal(await page.locator(".contact-row").count(), 0);
  await page.screenshot({
    path: "../.artifacts/organizer/desktop-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "通过并通知", exact: true }).click();
  await page
    .getByRole("button", { name: "确认通过并通知", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.locator(".filter-chips a").filter({ hasText: "已通过" }).click();
  await page.locator(".contact-row").first().waitFor();
  await page.locator('.sidebar a[href="#/tasks"]').click();
  await page.getByRole("heading", { name: "任务管理", exact: true }).waitFor();
  await page
    .getByRole("searchbox", { name: "搜索任务", exact: true })
    .fill("运输");
  assert.equal(await page.locator(".task-card:visible").count(), 1);
  await page
    .getByRole("link", { name: "新建任务", exact: true })
    .last()
    .click();
  await page
    .getByLabel("任务标题", { exact: true })
    .fill("浏览器验证 · 社区物资整理");
  await page.getByLabel("所属事件", { exact: true }).selectOption({ index: 1 });
  await page
    .getByLabel("一句话说明志愿者大概要做什么、有什么基本要求")
    .fill("协助社区清点和分类物资，招募 3 位志愿者。");
  const start = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const deadline = new Date(Date.now() + 3 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.getByLabel("任务开始时间", { exact: true }).fill(`${start}T09:00`);
  await page.getByLabel("任务结束时间", { exact: true }).fill(`${start}T13:00`);
  await page
    .getByLabel("报名截止时间", { exact: true })
    .fill(`${deadline}T18:00`);
  await page.getByLabel("计划招募人数", { exact: true }).fill("3");
  await page.getByLabel("服务地点", { exact: true }).fill("西湖区社区服务中心");
  await page
    .getByLabel("段落内容", { exact: true })
    .fill("按类别清点物资，做好登记。具体安排由双方沟通确认。");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/desktop-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "发布招募", exact: true }).click();
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await page
    .getByRole("heading", { name: "浏览器验证 · 社区物资整理", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "暂停招募", exact: true }).click();
  await page.getByRole("button", { name: "确认暂停招募", exact: true }).click();
  await page.getByRole("button", { name: "恢复招募", exact: true }).waitFor();
  await page.locator('.sidebar a[href="#/settings"]').click();
  await page.getByRole("heading", { name: "组织设置", exact: true }).waitFor();
  await page.getByRole("button", { name: "邀请成员", exact: true }).click();
  const reviewerEmail = `browser-${crypto.randomUUID()}@example.invalid`;
  await page.getByLabel("受邀成员邮箱").fill(reviewerEmail);
  await page.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  await page.getByRole("heading", { name: "邀请链接已生成" }).waitFor();
  const invitationURL = await page
    .getByLabel("邀请链接", { exact: true })
    .inputValue();
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  reviewer.on("pageerror", (error) => errors.push(error.message));
  await reviewer.goto(invitationURL);
  await reviewer.getByLabel("你的姓名", { exact: true }).fill("浏览器审核员");
  await reviewer
    .getByLabel("密码（至少 12 个字符）", { exact: true })
    .fill("browser-test-password-2026");
  await reviewer.getByRole("button", { name: "接受邀请并进入" }).click();
  await reviewer
    .getByRole("heading", { name: "工作台", exact: true })
    .waitFor();
  assert.equal(
    await reviewer.getByRole("link", { name: "新建任务", exact: true }).count(),
    0,
  );
  await reviewer.getByRole("link", { name: "当前账户设置" }).click();
  await reviewer.locator("#current-member").waitFor();
  assert.equal(
    await reviewer
      .locator('#current-member [data-action="member"]')
      .isDisabled(),
    true,
  );
  assert.equal(await reviewer.getByRole("dialog").count(), 0);
  await reviewer.getByRole("button", { name: "退出登录", exact: true }).click();
  await reviewer.getByLabel("登录邮箱", { exact: true }).fill(reviewerEmail);
  await reviewer
    .getByLabel("密码", { exact: true })
    .fill("browser-test-password-2026");
  await reviewer.getByRole("button", { name: "登录工作台" }).click();
  await reviewer
    .getByRole("heading", { name: "工作台", exact: true })
    .waitFor();
  await reviewerContext.close();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "编辑浏览器审核员的权限", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "成员权限 · 浏览器审核员", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator('.sidebar a[href="#/incidents"]').click();
  await page.getByRole("heading", { name: "活跃事件", exact: true }).waitFor();
  await page.locator('.sidebar a[href="#/notices"]').click();
  await page
    .getByRole("heading", { name: "已发送通知", exact: true })
    .waitFor();
  assert.ok((await page.locator(".notice").count()) > 0);
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "文字大小", exact: true }).click();
  await page.getByRole("radio", { name: "更大字号", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.locator('.sidebar .side-link[href="#/dashboard"]').click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/dark-large-text.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile must not overflow horizontally",
  );
  await page.screenshot({
    path: "../.artifacts/organizer/mobile-dashboard.png",
    fullPage: true,
  });
  await page.locator('.mobile-nav a[href="#/applications"]').click();
  await page.locator(".application-row").first().waitFor();
  await page.locator(".application-row").first().click();
  await page.getByRole("link", { name: "返回报名列表" }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/mobile-review.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile review must not overflow",
  );
  await page.getByRole("link", { name: "返回报名列表" }).click();
  await page.locator(".application-row").first().waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "320px large text layout must fit",
  );
  await page.goto(`${url}/#/dashboard`);
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "320px dashboard controls must fit with large text",
  );
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto(`${url}/#/dashboard`);
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/tablet-dashboard.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Tablet layout must fit",
  );
  await context.setOffline(true);
  await page.locator("#connection").waitFor({ state: "visible" });
  await context.setOffline(false);
  await page.locator("#connection").waitFor({ state: "hidden" });
  await page.keyboard.press("Tab");
  assert.ok(
    await page.evaluate(() => document.activeElement !== document.body),
    "Keyboard focus must be available",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: dashboard sorting, draft entry, task count, review, contact disclosure, task creation/publication, invitations, notices, 320/390/834/1440px layouts, dark mode, larger text, offline recovery.",
  );
} finally {
  await browser.close();
}
