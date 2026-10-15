import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const out = new URL("./.artifacts/browser/", import.meta.url);
const screenshotPath = (name: string) => fileURLToPath(new URL(name, out));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.DEMO_BROWSER
    ? { executablePath: process.env.DEMO_BROWSER }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
});
const errors: string[] = [];
const external: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== "127.0.0.1")
    external.push(r.url());
});
const base = `http://127.0.0.1:${process.env.DEMO_PORT || 4173}`;
const ready = async () => {
  await page
    .locator("#screen-cover")
    .waitFor({ state: "hidden", timeout: 60000 });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLImageElement>("#screen")?.naturalWidth ===
      1080,
  );
  assert.equal(await page.locator("#screen").isVisible(), true);
  assert.equal(await page.locator("#screen-preview").isVisible(), false);
};
const holdActivation = async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/demo/scene",
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  return release;
};
const loading = async (scene: string, theme: string) => {
  await page.waitForFunction((filename) => {
    const preview = document.querySelector<HTMLImageElement>("#preview-light");
    return (
      preview?.complete &&
      preview.naturalWidth === 1080 &&
      preview.currentSrc.endsWith(filename)
    );
  }, `/screenshots/${scene}-${theme}.png`);
  assert.equal(await page.locator("#screen-cover").isVisible(), true);
  assert.equal(await page.locator("#screen-preview").isVisible(), true);
  assert.equal(await page.locator("#screen").isVisible(), false);
  assert.equal(
    await page.getByRole("button", { name: "返回", exact: true }).isDisabled(),
    true,
  );
};
try {
  // Ignore a manual preference saved by older versions of the presentation.
  await page.addInitScript(() =>
    localStorage.setItem("firelink-theme", "dark"),
  );
  const start = await holdActivation();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await loading("welcome", "light");
  await page.screenshot({
    path: screenshotPath("loading-light.png"),
    fullPage: true,
  });
  start();
  await ready();
  await page.screenshot({
    path: screenshotPath("desktop-light.png"),
    fullPage: true,
  });
  assert.equal(await page.locator("body").getAttribute("class"), "light");
  assert.equal(
    await page.locator("#theme, #fullscreen, .brand img").count(),
    0,
  );
  assert.equal(await page.locator(".story > .brand").textContent(), "FireLink");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const next = await holdActivation();
  await page.keyboard.press("ArrowRight");
  await page.waitForURL("**/#discover");
  await loading("discover", "light");
  next();
  await ready();
  assert.equal(
    await page.locator("#headline").textContent(),
    "哪里需要帮助，一眼看清。",
  );
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForURL("**/#task");
  await ready();
  // Click the actual Android contact button via normalized screen coordinates.
  const screen = await page.locator("#screen").boundingBox();
  assert.ok(screen);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/demo/input") && r.status() === 200,
    ),
    page.mouse.click(
      screen.x + screen.width * 0.15,
      screen.y + screen.height * 0.91,
    ),
  ]);
  await page.waitForResponse(
    (r) => r.url().includes("/api/demo/frame") && r.status() === 200,
  );
  await page.screenshot({
    path: screenshotPath("live-contact-sheet.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "重置本页", exact: true }).click();
  await ready();
  // System preference changes must update both the deck and the AVD.
  const dark = await holdActivation();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.body.classList.contains("dark"));
  await loading("task", "dark");
  await page.screenshot({
    path: screenshotPath("loading-dark.png"),
    fullPage: true,
  });
  dark();
  await ready();
  assert.equal(await page.locator("body").getAttribute("class"), "dark");
  assert.equal(
    (await (await page.request.get(base + "/api/demo/status")).json()).theme,
    "dark",
  );
  await page.screenshot({
    path: screenshotPath("desktop-dark.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "FireLink 演示首页", exact: true })
    .click();
  await page.waitForURL("**/#welcome");
  await ready();
  await page.screenshot({
    path: screenshotPath("home-dark.png"),
    fullPage: true,
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `horizontal overflow at ${width}`,
    );
    await page.screenshot({
      path: screenshotPath(`responsive-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.body.classList.contains("light"));
  await ready();
  assert.equal(
    (await (await page.request.get(base + "/api/demo/status")).json()).theme,
    "light",
  );
  await page.route(
    "**/api/demo/scene",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "验证加载失败后的重试" }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "重置本页", exact: true }).click();
  await page.getByRole("button", { name: "重新连接", exact: true }).waitFor();
  await loading("welcome", "light");
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await ready();
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(external.length, 0, external.join("\n"));
  console.log(
    "PASS 浏览器：逐页截图加载遮罩、深浅截图、失败重试、实时画面切换、键盘翻页、实时点击、重置、系统主题、1440/768/390/320 布局、零外网请求、零脚本错误。",
  );
} finally {
  await browser.close();
}
