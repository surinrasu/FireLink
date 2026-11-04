// End-to-end verification against the REAL running AVD. No emulator stubs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { DemoStatus, Theme } from "./types.ts";
import type { DemoState } from "./state.ts";
import { SCENES, TOKEN } from "./scenes.ts";
import { createBridge } from "./adb.ts";
const base = `http://127.0.0.1:${process.env.DEMO_PORT || 4173}`;
const out = new URL("./.artifacts/verification/", import.meta.url);
await mkdir(out, { recursive: true });
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};
async function scene(id: string, theme: Theme) {
  const started = performance.now();
  const response = await fetch(base + "/api/demo/scene", {
    method: "POST",
    headers,
    body: JSON.stringify({ id, theme }),
  });
  const data = (await response.json()) as DemoStatus;
  assert.equal(response.status, 200, JSON.stringify(data));
  const frame = await fetch(`${base}/api/demo/frame?revision=${data.revision}`);
  assert.equal(frame.status, 200);
  const png = Buffer.from(await frame.arrayBuffer());
  const elapsed = Math.round(performance.now() - started);
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1920);
  await writeFile(new URL(`${id}-${theme}.png`, out), png);
  // Readiness callbacks optimize the runtime path. Verify the actual destination
  // independently so an early callback cannot silently pass this check.
  const hierarchy = await createBridge({ serial: data.device }).hierarchy();
  for (const text of SCENES.find((item) => item.id === id)!.expected)
    assert.ok(hierarchy.includes(text), `${id}: missing ${text}`);
  console.log(`  首帧 ${elapsed} ms`);
  return data;
}
for (const theme of ["light", "dark"] as const)
  for (const item of SCENES) {
    await scene(item.id, theme);
    console.log(
      `PASS ${theme} / ${item.id}: 页面文本就绪，1080 × 1920 真实画面`,
    );
  }
await scene("pending", "light");
await fetch(base + "/v1/applications/application-supply/withdraw", {
  method: "POST",
  headers,
  body: "{}",
});
await scene("pending", "light");
const restored = (await (
  await fetch(base + "/v1/applications", { headers })
).json()) as DemoState["applications"];
assert.equal(restored[0].status, "pending");
await scene("notifications", "dark");
await fetch(base + "/v1/notifications/notice-accepted/read", {
  method: "POST",
  headers,
  body: "{}",
});
await scene("notifications", "dark");
const notices = (await (
  await fetch(base + "/v1/notifications", { headers })
).json()) as DemoState["notifications"];
assert.equal(notices[0].readAt, null);
await scene("welcome", "light");
console.log("PASS 撤回、通知已读均在重置后还原；已回到首页。");
