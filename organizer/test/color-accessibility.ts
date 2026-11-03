import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Page, type Locator } from "playwright";
import { isolateLocalDemo } from "./local-demo";

// WCAG 1.4.1 also requires visual review: automated contrast checks alone cannot
// establish that a selected state, error, or map remains understandable without hue.
const base = process.env.TEST_URL || "http://127.0.0.1:8787/mng-dash";
const output = "../.artifacts/organizer/color-accessibility";
const baseline = process.env.COLOR_BASELINE === "1";
let executablePath = process.env.BROWSER_EXECUTABLE;
if (!executablePath && process.platform === "darwin") {
  const chrome = "/Applications/Chrome.app/Contents/MacOS/Chrome";
  try {
    await access(chrome);
    executablePath = chrome;
  } catch {
    /* Use bundled Chromium. */
  }
}
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const reports: unknown[] = [];
const failures: unknown[] = [];
function contrast(a: string, b: string) {
  const luminance = (color: string) =>
    (color.match(/[\d.]+/g) || []).slice(0, 3).reduce((sum, value, index) => {
      const v = Number(value) / 255;
      return (
        sum +
        [0.2126, 0.7152, 0.0722][index] *
          (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}
async function selectedIndicator(
  control: Locator,
  kind: "border" | "underline",
) {
  if (baseline) return;
  const style = await control.evaluate((element) => {
    const s = getComputedStyle(element);
    return {
      width: parseFloat(s.borderTopWidth),
      border: s.borderTopColor,
      background: s.backgroundColor,
      text: s.color,
      decoration: s.textDecorationLine,
    };
  });
  if (kind === "border") {
    assert.ok(
      style.width >= 2,
      "Selected item must retain a visible outline without color",
    );
    assert.ok(
      contrast(style.border, style.background) >= 3,
      JSON.stringify(style),
    );
  } else {
    assert.ok(
      style.decoration.includes("underline"),
      "Selected control must retain its underline without color",
    );
    assert.ok(
      contrast(style.text, style.background) >= 3,
      JSON.stringify(style),
    );
  }
}
const scan = async (page: Page, name: string) => {
  const result = await new AxeBuilder({ page })
    .withRules([
      "color-contrast",
      "link-in-text-block",
      "aria-input-field-name",
      "aria-required-attr",
      "aria-valid-attr-value",
    ])
    .analyze();
  const compact = (items: typeof result.violations) =>
    items.map((item) => ({
      rule: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        reason: node.failureSummary,
        checks: [...node.any, ...node.all].map((check) => check.data),
      })),
    }));
  const violations = compact(result.violations);
  // BeerCSS ripple pseudo-elements and floating labels require manual review in
  // axe. Check their computed foreground/background pairs independently as well.
  const controls = await page
    .locator(
      "button:not(.circle), a.button:not(.circle), .field > label, .avatar, .pin > span, .vertex",
    )
    .evaluateAll((elements) => {
      const rgba = (value: string) => {
        const values = value.match(/[\d.]+/g)?.map(Number) || [];
        return [values[0] || 0, values[1] || 0, values[2] || 0, values[3] ?? 1];
      };
      const mix = (foreground: number[], background: number[]) =>
        foreground
          .slice(0, 3)
          .map(
            (value, i) =>
              value * foreground[3] + background[i] * (1 - foreground[3]),
          );
      const luminance = (color: number[]) =>
        color.slice(0, 3).reduce((sum, value, index) => {
          const v = value / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index] *
              (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      return elements.flatMap((element) => {
        if (
          !element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          }) ||
          element.matches(":disabled") ||
          !element.textContent?.trim()
        )
          return [];
        const parents: Element[] = [];
        for (let parent: Element | null = element; parent; ) {
          parents.unshift(parent);
          parent =
            parent.parentElement ||
            (parent.getRootNode() as ShadowRoot).host ||
            null;
        }
        if (
          parents.some((parent) => Number(getComputedStyle(parent).opacity) < 1)
        )
          return [];
        let background = parents.reduce(
          (color, parent) =>
            mix(rgba(getComputedStyle(parent).backgroundColor), color),
          [255, 255, 255],
        );
        if (element.matches('.dashboard-sort > [aria-checked="true"]'))
          background = rgba(
            getComputedStyle(element.parentElement!, "::before")
              .backgroundColor,
          );
        const style = getComputedStyle(element);
        const foreground = mix(rgba(style.color), background);
        const [low, high] = [luminance(foreground), luminance(background)].sort(
          (a, b) => a - b,
        );
        const ratio = (high + 0.05) / (low + 0.05);
        const size = parseFloat(style.fontSize);
        const minimum =
          size >= 24 || (size >= 18.667 && Number(style.fontWeight) >= 700)
            ? 3
            : 4.5;
        return [
          {
            text: element.textContent.trim().slice(0, 60),
            tag: element.tagName,
            foreground,
            background,
            ratio,
            minimum,
          },
        ];
      });
    });
  const controlFailures = controls.filter(
    (control) => control.ratio < control.minimum,
  );
  reports.push({
    name,
    violations,
    controlContrasts: controls,
    manualReview: compact(result.incomplete),
  });
  if (violations.length) failures.push({ name, violations });
  if (controlFailures.length) failures.push({ name, controlFailures });
  console.log(
    `${violations.length || controlFailures.length ? "FAIL" : "PASS"} ${name}: ${result.violations.reduce((sum, item) => sum + item.nodes.length, 0)} axe findings, ${controlFailures.length}/${controls.length} control contrast failures`,
  );
};

try {
  await mkdir(output, { recursive: true });
  for (const theme of ["浅色", "深色"]) {
    const name = theme === "浅色" ? "light" : "dark";
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      locale: "zh-CN",
    });
    await isolateLocalDemo(context, base);
    // Deterministic neutral backdrop; live map imagery still needs visual review.
    await context.route("https://tile.openstreetmap.org/**", (route) =>
      route.fulfill({ status: 204, body: "" }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("radio", { name: theme, exact: true }).check();
    await scan(page, `${name}-appearance`);
    await page.keyboard.press("Escape");
    await scan(page, `${name}-login`);
    await page
      .getByRole("button", { name: "进入演示工作台", exact: true })
      .click();
    await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
    await scan(page, `${name}-dashboard`);
    await page.screenshot({
      path: `${output}/${name}-h266-dashboard.png`,
      fullPage: true,
    });
    const goto = async (route: string, heading: string) => {
      await page.goto(`${base}/#/${route}`);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    };
    await goto("tasks", "任务管理");
    await scan(page, `${name}-tasks`);
    await selectedIndicator(
      page.locator('.sidebar .side-link[aria-current="page"]'),
      "border",
    );
    await selectedIndicator(
      page.locator('.filter-chips [aria-current="true"]'),
      "underline",
    );
    await page.getByLabel("所属事件", { exact: true }).click();
    await page.locator(".select-popover:popover-open").waitFor();
    await scan(page, `${name}-select`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "列表", exact: true }).click();
    await selectedIndicator(
      page.getByRole("button", { name: "列表", exact: true }),
      "underline",
    );
    await scan(page, `${name}-task-list`);
    const cdp = await context.newCDPSession(page);
    if (!baseline) {
      for (const type of [
        "achromatopsia",
        "deuteranopia",
        "protanopia",
        "tritanopia",
      ] as const) {
        await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
        await page.screenshot({
          path: `${output}/${name}-tasks-${type}.png`,
          fullPage: true,
        });
      }
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
    }
    await goto("applications", "报名审核");
    await page.locator("#review-form").waitFor();
    await scan(page, `${name}-applications`);
    await selectedIndicator(
      page.locator('.application-row[aria-current="true"]'),
      "border",
    );
    if (!baseline) {
      await cdp.send("Emulation.setEmulatedVisionDeficiency", {
        type: "achromatopsia",
      });
      await page.screenshot({
        path: `${output}/${name}-review-achromatopsia.png`,
        fullPage: true,
      });
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
    }
    await goto("applications?status=accepted", "已通过报名");
    await page.locator(".contact-row").first().waitFor();
    await scan(page, `${name}-accepted`);
    await goto("incidents", "活跃事件");
    await scan(page, `${name}-incidents`);
    await goto("notices", "已发送通知");
    await scan(page, `${name}-notices`);
    await goto("settings", "组织设置");
    await scan(page, `${name}-settings`);
    await page.getByRole("button", { name: "邀请成员", exact: true }).click();
    await scan(page, `${name}-member-dialog`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await goto("tasks/new", "新建任务");
    await scan(page, `${name}-editor`);
    await page.locator("#task-schedule > summary").click();
    await page
      .getByLabel("报名截止", { exact: false })
      .fill("2020-01-01T12:00");
    await page.locator(".field-error").waitFor();
    await scan(page, `${name}-editor-error`);
    await page.locator("#task-details > summary").click();
    await page.getByRole("button", { name: "添加地图", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1400 });
    const map = page.locator("#blocks firelink-map");
    await map.scrollIntoViewIfNeeded();
    await map.locator(".leaflet-container").waitFor();
    await map.getByRole("button", { name: "路径", exact: true }).click();
    const canvas = map.locator(".canvas");
    await canvas.click({ position: { x: 60, y: 60 } });
    await canvas.click({ position: { x: 140, y: 130 } });
    await map.getByRole("button", { name: "完成路径", exact: true }).click();
    await map.getByRole("button", { name: "范围", exact: true }).click();
    await canvas.click({ position: { x: 260, y: 60 } });
    await canvas.click({ position: { x: 360, y: 160 } });
    await canvas.click({ position: { x: 260, y: 180 } });
    await map.getByRole("button", { name: "完成范围", exact: true }).click();
    await selectedIndicator(
      map.getByRole("button", { name: "范围", exact: true }),
      "underline",
    );
    if (!baseline) {
      const strokes = await map
        .locator(".location-path, .location-area")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const s = getComputedStyle(element);
            return { color: s.stroke, dash: s.strokeDasharray };
          }),
        );
      assert.ok(
        strokes.every(
          (stroke) => contrast(stroke.color, "rgb(255, 255, 255)") >= 3,
        ),
      );
      assert.notEqual(
        strokes[0].dash,
        strokes[1].dash,
        "Path and area must have different line patterns",
      );
      await map
        .getByRole("button", { name: "范围 2 · 3 个点", exact: true })
        .click();
      await map
        .getByRole("button", { name: "选择第 2 个点", exact: true })
        .click();
      const marker = map.locator('.location-marker[data-selected="true"]');
      assert.equal(await marker.count(), 1);
      assert.ok(
        await marker.evaluate(
          (element) =>
            parseFloat(getComputedStyle(element, "::after").borderTopWidth) >=
            2,
        ),
      );
    }
    await scan(page, `${name}-map-editor`);
    await map.screenshot({ path: `${output}/${name}-map.png` });
    if (!baseline) {
      await cdp.send("Emulation.setEmulatedVisionDeficiency", {
        type: "achromatopsia",
      });
      await map.screenshot({ path: `${output}/${name}-map-achromatopsia.png` });
      await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
      // Check the same interface under system contrast settings and on a narrow
      // screen; these do not require a separate application-specific color mode.
      await page.reload();
      await goto("tasks", "任务管理");
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ forcedColors: "active" });
      await scan(page, `${name}-forced-colors`);
      assert.equal(
        await page
          .locator(".filter-chips a.active")
          .evaluate((element) => getComputedStyle(element).borderTopStyle),
        "double",
      );
      await page.screenshot({
        path: `${output}/${name}-forced-colors.png`,
        fullPage: true,
      });
      await page.emulateMedia({ forcedColors: "none", contrast: "more" });
      assert.equal(
        await page.locator("body").evaluate((element) => {
          const s = getComputedStyle(element);
          return (
            s.getPropertyValue("--outline").trim() ===
            s.getPropertyValue("--on-surface").trim()
          );
        }),
        true,
      );
      await scan(page, `${name}-more-contrast`);
      await page.emulateMedia({ contrast: "no-preference" });
      await page.getByRole("button", { name: "文字大小", exact: true }).click();
      await page.getByRole("radio", { name: "更大字号", exact: true }).check();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 320, height: 844 });
      await selectedIndicator(
        page.locator('.mobile-nav [aria-current="page"]'),
        "border",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await scan(page, `${name}-mobile-large`);
      await cdp.send("Emulation.setEmulatedVisionDeficiency", {
        type: "achromatopsia",
      });
      await page.screenshot({
        path: `${output}/${name}-mobile-achromatopsia.png`,
        fullPage: true,
      });
    }
    if (!baseline) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "文字大小", exact: true }).click();
      await page.getByRole("radio", { name: "标准字号", exact: true }).check();
      await page.keyboard.press("Escape");
      for (const hue of [25, 90, 155, 320, 266]) {
        await goto("tasks", "任务管理");
        await page.getByRole("button", { name: "主题", exact: true }).click();
        await page.locator(`.hue-preset[data-hue="${hue}"]`).click();
        assert.equal(
          await page
            .getByRole("slider", { name: "主题色相" })
            .getAttribute("aria-valuenow"),
          String(hue),
        );
        await scan(page, `${name}-h${hue}-picker`);
        await page.screenshot({
          path: `${output}/${name}-h${hue}-picker.png`,
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await scan(page, `${name}-h${hue}-tasks`);
        await selectedIndicator(
          page.locator('.sidebar .side-link[aria-current="page"]'),
          "border",
        );
        await selectedIndicator(
          page.locator('.filter-chips [aria-current="true"]'),
          "underline",
        );
        await goto("applications", "报名审核");
        await page.locator("#review-form").waitFor();
        await scan(page, `${name}-h${hue}-review`);
        await selectedIndicator(
          page.locator('.application-row[aria-current="true"]'),
          "border",
        );
        await goto("tasks/new", "新建任务");
        await page.locator("#task-schedule > summary").click();
        await page
          .getByLabel("报名截止", { exact: false })
          .fill("2020-01-01T12:00");
        await page.locator(".field-error").waitFor();
        // Also exercise the reusable server-error surface without a failed write.
        await page.locator("#task-form").evaluate((form) => {
          const error = document.createElement("p");
          error.className = "form-error";
          error.setAttribute("role", "alert");
          error.textContent = "提交失败，请重试。";
          form.prepend(error);
        });
        await scan(page, `${name}-h${hue}-errors`);
        await goto("tasks", "任务管理");
        for (const type of [
          "achromatopsia",
          "deuteranopia",
          "protanopia",
          "tritanopia",
        ] as const) {
          await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
          await page.screenshot({
            path: `${output}/${name}-h${hue}-${type}.png`,
            fullPage: true,
          });
        }
        await cdp.send("Emulation.setEmulatedVisionDeficiency", {
          type: "none",
        });
      }
      // Dynamic CSS must not override the user's system palette, even on input.
      await page.getByRole("button", { name: "主题", exact: true }).click();
      await page.emulateMedia({ forcedColors: "active" });
      await page.locator('.hue-preset[data-hue="155"]').click();
      await scan(page, `${name}-custom-forced-colors`);
      assert.ok(
        await page
          .locator(".page-actions a.button, .page-actions a.button > *")
          .evaluateAll(
            (elements) =>
              elements.length > 0 &&
              elements.every(
                (element) =>
                  getComputedStyle(element).forcedColorAdjust === "none",
              ),
          ),
        "System-colored buttons must not acquire opaque browser text backplates",
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((e) =>
            getComputedStyle(e).getPropertyValue("--primary").trim(),
          ),
        "LinkText",
      );
      await page.screenshot({
        path: `${output}/${name}-custom-forced-colors.png`,
        fullPage: true,
      });
      await page.emulateMedia({ forcedColors: "none", contrast: "more" });
      assert.equal(
        await page.locator("body").evaluate((e) => {
          const s = getComputedStyle(e);
          return (
            s.getPropertyValue("--outline").trim() ===
            s.getPropertyValue("--on-surface").trim()
          );
        }),
        true,
      );
      await scan(page, `${name}-custom-more-contrast`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await writeFile(
    `${output}/${baseline ? "baseline" : "results"}.json`,
    JSON.stringify(reports, null, 2),
  );
  await browser.close();
}
if (!baseline)
  assert.equal(
    failures.length,
    0,
    "Color accessibility regressions; see artifact results.json",
  );
