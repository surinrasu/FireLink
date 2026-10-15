import assert from "node:assert/strict";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { SCENES } from "./scenes.ts";
import type { DemoStatus, Theme } from "./types.ts";

// Capture the real app after its expected page text and pixels have settled.
// Keep the previous complete set if any scene fails to load.
export async function captureScreenshots(
  port = Number(process.env.DEMO_PORT || 4173),
  output = new URL("./public/screenshots/", import.meta.url),
) {
  const base = `http://127.0.0.1:${port}`;
  async function request(url: string, body?: unknown) {
    const response = await fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`${url}: ${response.status} ${await response.text()}`);
    return response;
  }
  const activate = async (id: string, theme: Theme): Promise<DemoStatus> =>
    (await request("/api/demo/scene", { id, theme })).json();
  const initial: DemoStatus = await (await request("/api/demo/status")).json();
  const captures = new Map<string, Buffer>();
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const scene of SCENES) {
        const state = await activate(scene.id, theme);
        assert.equal(state.scene, scene.id);
        assert.equal(state.theme, theme);
        let previous: Buffer | undefined;
        let stable: Buffer | undefined;
        for (let attempt = 0; attempt < 10; attempt++) {
          const response = await request(
            `/api/demo/frame?revision=${state.revision}`,
          );
          assert.equal(
            Number(response.headers.get("X-Demo-Revision")),
            state.revision,
          );
          const png = Buffer.from(await response.arrayBuffer());
          assert.ok(png.length >= 24, `${scene.id}: empty screenshot`);
          assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
          assert.equal(png.readUInt32BE(16), 1080);
          assert.equal(png.readUInt32BE(20), 1920);
          if (previous?.equals(png)) {
            stable = png;
            break;
          }
          previous = png;
          await sleep(250);
        }
        assert.ok(stable, `${scene.id}/${theme}: app did not settle`);
        captures.set(`${scene.id}-${theme}.png`, stable);
        console.log(`CAPTURE ${scene.id}/${theme}: 1080 × 1920`);
      }
    }
  } finally {
    await activate(initial.scene || "welcome", initial.theme);
  }
  await mkdir(output, { recursive: true });
  for (const [name, png] of captures) {
    const temporary = new URL(`${name}.tmp`, output);
    await writeFile(temporary, png);
    await rename(temporary, new URL(name, output));
  }
  for (const name of await readdir(output)) {
    if (name.endsWith(".png") && !captures.has(name))
      await rm(new URL(name, output));
  }
  console.log(`Updated ${captures.size} presentation screenshots.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await captureScreenshots();
