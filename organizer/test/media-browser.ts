import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { isolateLocalDemo } from "./local-demo";
const url = process.env.TEST_URL || "http://127.0.0.1:8787";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.BROWSER_EXECUTABLE ||
    (process.platform === "darwin"
      ? "/Applications/Chrome.app/Contents/MacOS/Chrome"
      : undefined),
});
await mkdir("../.artifacts/organizer", { recursive: true });
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  // Functional checks never prefetch or scan the public OSM tile service.
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
  const response = await page.goto(url);
  assert.match(response!.headers()["x-robots-tag"], /noindex/);
  assert.match(
    (await page.locator('meta[name="robots"]').getAttribute("content")) || "",
    /noindex/,
  );
  assert.match(
    await (await context.request.get(`${url}/robots.txt`)).text(),
    /Disallow: \//,
  );
  await page
    .getByRole("button", { name: "进入演示工作台", exact: true })
    .click();
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  await page.goto(`${url}/#/tasks/new`);
  await page.getByLabel("任务标题", { exact: true }).fill("地图与附件验证");
  await page.locator("#incidentId-picker").click();
  await page.locator(".task-picker-list button").first().click();
  await page.locator("#task-schedule > summary").click();
  await page.getByLabel("地点描述", { exact: true }).fill("社区服务中心");
  await page.locator("#task-details > summary").click();
  await page.getByRole("button", { name: "添加地图", exact: true }).click();
  const map = page.locator("#blocks firelink-map");
  await map.locator(".leaflet-container").waitFor();
  assert.equal(await page.getByLabel("纬度", { exact: true }).inputValue(), "");
  assert.equal(await map.locator(".location-marker").count(), 0);
  await map.locator(".canvas").click({ position: { x: 230, y: 140 } });
  const latitude = await page.getByLabel("纬度", { exact: true }).inputValue();
  assert.ok(Number(latitude) > 20 && Number(latitude) < 40);
  assert.equal(await map.locator(".location-marker").count(), 1);
  const markerBefore = await map
    .locator(".location-marker")
    .getAttribute("style");
  await map.locator(".precise summary").click();
  await page.getByLabel("纬度", { exact: true }).fill("30.275");
  await map.getByRole("button", { name: "更新所选点", exact: true }).click();
  assert.equal(await map.getAttribute("latitude"), "30.275");
  assert.ok(markerBefore);
  await page
    .locator("#live-preview firelink-map")
    .evaluate(
      (el) => ((el as HTMLElement & { preserved: string }).preserved = "yes"),
    );
  await page
    .getByLabel("任务标题", { exact: true })
    .fill("地图与附件验证 · 保存后重开");
  assert.equal(
    await page
      .locator("#live-preview firelink-map")
      .evaluate((el) => (el as HTMLElement & { preserved: string }).preserved),
    "yes",
  );
  await page.getByRole("button", { name: "添加图片", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ced9c5";
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#293524";
    ctx.font = "40px sans-serif";
    ctx.fillText("FireLink · upload test", 80, 195);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const uploadResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/organizer/media") &&
      r.request().method() === "POST",
  );
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
    name: "照片.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  assert.equal((await uploadResponse).status(), 201);
  await page.locator(".media-upload-preview img").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLImageElement>(".media-upload-preview img")!
        .naturalWidth === 640,
  );
  assert.equal(await page.getByLabel("HTTPS 媒体链接").count(), 0);
  await page.getByRole("button", { name: "添加视频", exact: true }).click();
  const videoUpload = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/organizer/media") &&
      r.request().method() === "POST",
  );
  await page
    .locator('input[type="file"][accept^="video/"]')
    .setInputFiles("test/fixtures/clip.webm");
  assert.equal((await videoUpload).status(), 201);
  const video = page.locator(".media-upload-preview video");
  await video.waitFor();
  await video.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    v.muted = true;
    await v.play();
  });
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>(".media-upload-preview video")!
        .currentTime > 0,
  );
  await video.evaluate((el) => (el as HTMLVideoElement).pause());
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
  const session = await (
    await context.request.get(`${url}/api/organizer/auth/session`)
  ).json();
  const org = session.memberships[0].organizationId;
  const ws = await (
    await context.request.get(`${url}/api/organizer/workspace`, {
      headers: { "X-Organization-Id": org },
    })
  ).json();
  const task = ws.tasks.find(
    (t: { title: string }) => t.title === "地图与附件验证 · 保存后重开",
  );
  assert.ok(task);
  assert.equal(
    task.blocks.find((b: { type: string }) => b.type === "map").latitude,
    30.275,
  );
  assert.ok(
    task.blocks
      .find((b: { type: string }) => b.type === "image")
      .url.includes("/api/organizer-media/"),
  );
  await page.goto(`${url}/#/tasks/${task.id}`);
  await page.locator("#task-form").waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: task.title, exact: true }).waitFor();
  await page.locator(".description figure img").waitFor();
  await page.screenshot({
    path: "../.artifacts/organizer/maps-media-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "编辑任务", exact: true }).click();
  await page.locator("#task-form").waitFor();
  await page.locator("#task-details > summary").click();
  await map.getByRole("button", { name: "位置 1", exact: true }).click();
  await map.locator(".precise summary").click();
  assert.equal(
    await page.getByLabel("纬度", { exact: true }).inputValue(),
    "30.275",
  );
  assert.equal(await page.locator(".media-upload-preview img").count(), 1);
  assert.equal(await page.locator(".media-upload-preview video").count(), 1);
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("纬度", { exact: true }).focus();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `overflow at ${width}`,
    );
    if (width === 390)
      await page.screenshot({ path: "../.artifacts/organizer/map-mobile.png" });
  }
  await page.evaluate(() => document.body.classList.add("dark"));
  await page.screenshot({
    path: "../.artifacts/organizer/map-editor-dark.png",
  });
  // Upload failure keeps existing media and permits a retry.
  await context.route("**/api/organizer/media", (route) =>
    route.abort("failed"),
  );
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page
    .locator(".upload-status")
    .filter({ hasText: "上传中断" })
    .waitFor();
  assert.equal(await page.locator(".media-upload-preview img").count(), 1);
  await context.unroute("**/api/organizer/media");
  const retry = page.waitForResponse((r) =>
    r.url().endsWith("/api/organizer/media"),
  );
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  assert.equal((await retry).status(), 201);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto(`${url}/#/incidents`);
  await page
    .locator("firelink-map")
    .first()
    .locator(".status")
    .filter({ hasText: "地图暂不可用" })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Map/media browser checks passed: marking, preview reuse, image/video uploads and playback, save/reopen, retry, 320–1440px, tile failures, noindex.",
  );
} finally {
  await browser.close();
}
