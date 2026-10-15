import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { captureScreenshots } from "../screenshots.ts";

test("failed screenshot capture preserves the previous set and restores the original scene", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "firelink-screenshots-"),
  );
  const output = pathToFileURL(directory + path.sep);
  const original = new URL("welcome-light.png", output);
  await writeFile(original, "previous screenshot");
  const png = await readFile(
    new URL("../public/screenshots/welcome-light.png", import.meta.url),
  );
  const activated: unknown[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/demo/frame")) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "X-Demo-Revision": "1",
      });
      res.end(png);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      activated.push(body);
      if (body.id === "discover") {
        res.writeHead(503);
        res.end(JSON.stringify({ error: "scene unavailable" }));
      } else {
        res.end(
          JSON.stringify({ scene: body.id, theme: body.theme, revision: 1 }),
        );
      }
    } else {
      res.end(JSON.stringify({ scene: "task", theme: "dark", revision: 0 }));
    }
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      captureScreenshots(address.port, output),
      /scene unavailable/,
    );
    assert.deepEqual(await readdir(output), ["welcome-light.png"]);
    assert.equal(await readFile(original, "utf8"), "previous screenshot");
    assert.deepEqual(activated.at(-1), { id: "task", theme: "dark" });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
