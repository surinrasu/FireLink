import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createState, api } from "../state.ts";
import { SCENES, TOKEN, NOW } from "../scenes.ts";
import { imageArchitecture, sdkCandidates, provisionAvd } from "../platform.ts";
import { createDemoServer } from "../server.ts";
import { spawnSync } from "node:child_process";
import type { Bridge } from "../adb.ts";
const auth = `Bearer ${TOKEN}`;
test("all scenes restore a fresh, deterministic state including read flags and approval", () => {
  for (const scene of SCENES) {
    const state = createState(scene.id),
      baseline = structuredClone(state);
    state.profile.username = "changed";
    state.applications.length = 0;
    state.notifications.length = 0;
    assert.deepEqual(createState(scene.id), baseline);
  }
  assert.equal(createState("pending").applications[0].contactsReleased, false);
  assert.equal(createState("accepted").applications[0].contactsReleased, true);
  assert.equal(createState("notifications").notifications[0].readAt, null);
});
test("consent, duplicate application, withdrawal, and read state work locally and reset", () => {
  let state = createState("consent");
  assert.equal(api(state, "POST", "/v1/applications", {}, auth).status, 400);
  const body = {
    taskId: "task-supply",
    fields: ["realName", "region"],
    contactFields: ["phone"],
    consentVersion: 1,
  };
  const submitted = api(state, "POST", "/v1/applications", body, auth);
  assert.equal(submitted.status, 201);
  assert.ok("contactsReleased" in submitted.body);
  assert.equal(submitted.body.contactsReleased, false);
  assert.equal(api(state, "POST", "/v1/applications", body, auth).status, 409);
  const withdrawn = api(
    state,
    "POST",
    `/v1/applications/${submitted.body.id}/withdraw`,
    {},
    auth,
  ).body;
  assert.ok("status" in withdrawn);
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(createState("consent").applications.length, 0);
  state = createState("notifications");
  const read = api(
    state,
    "POST",
    "/v1/notifications/notice-accepted/read",
    {},
    auth,
  ).body;
  assert.ok("readAt" in read);
  assert.equal(read.readAt, NOW);
  assert.equal(createState("notifications").notifications[0].readAt, null);
  assert.equal(
    api(state, "POST", "/v1/applications/application-supply/withdraw", {}, auth)
      .status,
    409,
  );
});
test("API denies unauthenticated private access and has no upstream fallback", () => {
  const state = createState();
  assert.equal(api(state, "GET", "/v1/me").status, 401);
  assert.equal(api(state, "GET", "/v1/not-implemented", {}, auth).status, 404);
  for (const scene of SCENES) {
    const state = createState(scene.id);
    for (const endpoint of [
      "/v1/config",
      "/v1/incidents",
      "/v1/articles",
      "/v1/tasks/task-supply",
      "/v1/me",
      "/v1/applications",
      "/v1/notifications",
      "/v1/credentials",
    ])
      assert.equal(api(state, "GET", endpoint, {}, auth).status, 200);
  }
});
test("architecture and SDK detection handle independent Mac, Linux, and Windows machines", () => {
  assert.equal(imageArchitecture("darwin", "arm64"), "arm64-v8a");
  for (const system of ["darwin", "linux", "win32"])
    assert.equal(imageArchitecture(system, "x64"), "x86_64");
  assert.throws(() => imageArchitecture("linux", "arm64"), /尚无受支持/);
  assert.deepEqual(sdkCandidates({}, "darwin", "/example/home"), [
    "/example/home/Library/Android/sdk",
  ]);
  assert.deepEqual(sdkCandidates({}, "linux", "/example/home"), [
    "/example/home/Android/Sdk",
  ]);
  assert.deepEqual(
    sdkCandidates(
      { LOCALAPPDATA: "C:\\Example\\Local" },
      "win32",
      "C:\\Example",
    ),
    ["C:\\Example\\Local\\Android\\Sdk"],
  );
  assert.equal(
    sdkCandidates({ ANDROID_HOME: "/custom/sdk" }, "linux", "/other")[0],
    "/custom/sdk",
  );
});
test("AVD is generated in a fresh checkout without a pre-existing user AVD", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "firelink-avd-test-"));
  try {
    for (const abi of ["arm64-v8a", "x86_64"]) {
      const name = await provisionAvd(
        root,
        {
          relative: `system-images/android-35/google_apis/${abi}/`,
          variant: "google_apis",
        },
        abi,
      );
      const ini = await readFile(path.join(root, `${name}.ini`), "utf8");
      const config = await readFile(
        path.join(root, `${name}.avd/config.ini`),
        "utf8",
      );
      assert.ok(ini.includes(root));
      assert.ok(config.includes(`abi.type=${abi}`));
      assert.ok(config.includes("hw.lcd.width=1080"));
      assert.ok(config.includes("hw.lcd.height=1920"));
      assert.ok(!config.includes("/Users/"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("HTTP controller serializes transitions, rejects stale input, blocks foreign origins, and resets mutations", async () => {
  let release!: () => void;
  let activated!: () => void;
  let inputCount = 0;
  const activation = new Promise<void>((resolve) => {
    activated = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pause = true;
  const bridge: Bridge = {
    serial: "emulator-test",
    async activate(scene, theme, port, reset) {
      reset();
      activated();
      if (pause) await gate;
    },
    async frame() {
      return Buffer.from("fake-png");
    },
    async input() {
      inputCount++;
    },
  };
  const server = createDemoServer({ bridge });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const script = await fetch(base + "/app.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("Content-Type") || "", /text\/javascript/);
    const source = await script.text();
    const parsed = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      {
        input: source,
        encoding: "utf8",
      },
    );
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.ok(source.includes("/api/demo/scenes"));
    assert.doesNotMatch(source, /(?:from|import)\s*["'][^"']+\.ts["']/);
    const head = await fetch(base + "/app.js", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const body of [null, [], "invalid"]) {
      assert.equal((await post("/api/demo/scene", body)).status, 400);
    }
    const css = await (await fetch(base + "/vendor/beer.min.css")).text();
    assert.ok(css.includes("/vendor/material-symbols"));
    assert.ok(!css.includes("https://"));
    for (const scene of SCENES) {
      for (const theme of ["light", "dark"]) {
        const screenshot = await fetch(
          base + `/screenshots/${scene.id}-${theme}.png`,
        );
        assert.equal(
          screenshot.status,
          200,
          `${scene.id}/${theme} screenshot missing`,
        );
        assert.equal(screenshot.headers.get("Content-Type"), "image/png");
        const png = Buffer.from(await screenshot.arrayBuffer());
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.equal(png.readUInt32BE(16), 1080);
        assert.equal(png.readUInt32BE(20), 1920);
      }
    }
    const first = post("/api/demo/scene", { id: "pending", theme: "dark" });
    await activation;
    assert.equal(
      (await post("/api/demo/scene", { id: "welcome", theme: "light" })).status,
      409,
    );
    assert.equal(
      (await fetch(base + "/api/demo/frame?revision=1")).status,
      409,
    );
    release();
    const current = await (await first).json();
    pause = false;
    assert.equal(current.scene, "pending");
    assert.equal(current.theme, "dark");
    assert.equal(
      (
        await post("/api/demo/input", {
          type: "tap",
          x: 0.5,
          y: 0.5,
          revision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post("/api/demo/input", {
          type: "tap",
          x: 3,
          y: 0.5,
          revision: current.revision,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/demo/input", {
          type: "tap",
          x: 0.5,
          y: 0.5,
          revision: current.revision,
        })
      ).status,
      200,
    );
    assert.equal(inputCount, 1);
    assert.equal(
      (
        await post(
          "/api/demo/scene",
          { id: "welcome", theme: "light" },
          { Origin: "https://unrelated.example" },
        )
      ).status,
      403,
    );
    await post(
      "/v1/applications/application-supply/withdraw",
      {},
      { Authorization: auth },
    );
    await post("/api/demo/scene", { id: "pending", theme: "light" });
    const applications = await (
      await fetch(base + "/v1/applications", {
        headers: { Authorization: auth },
      })
    ).json();
    assert.equal(applications[0].status, "pending");
    assert.equal(
      (await fetch(base + "/api/demo/frame?revision=1")).status,
      409,
    );
    assert.equal(
      (await post("/api/demo/scene", { id: "missing", theme: "light" })).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
