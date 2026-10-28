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
