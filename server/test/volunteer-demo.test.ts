import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cleanupOrganizerData } from "../src/organizer-maintenance";
import type { Profile } from "../src/domain";
type Session = { token: string; profile: Profile };
type Task = {
  id: string;
  title: string;
  status: string;
  requiredFields: string[];
  contactFields: string[];
};
let mf: Miniflare;
let db: D1Database;
beforeAll(async () => {
  await mkdir(".artifacts", { recursive: true });
  await build({
    entryPoints: ["src/index.ts"],
    outfile: ".artifacts/volunteer-demo-worker.mjs",
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*"],
    logLevel: "silent",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "firelink",
          modules: true,
          scriptPath: ".artifacts/volunteer-demo-worker.mjs",
          compatibilityDate: "2026-10-06",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "volunteer-demo-test-db" },
          r2Buckets: ["FILES"],
          bindings: {
            APP_ENV: "staging",
            ORGANIZER_DEMO: "true",
            MOCK_AUTH: "false",
            RP_ID: "localhost",
            PASSKEY_ORIGINS: "http://localhost:8787",
            APPLE_APP_ID: "",
            ANDROID_SHA256: "",
          },
        },
      ],
    }),
  );
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).sort()) {
    const sql = await readFile("migrations/" + file, "utf8");
    // D1 exec expects each statement on one line, including trigger bodies.
    const statements = sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? [];
    for (const statement of statements)
      await db.exec(statement.replace(/\n/g, " "));
  }
});
afterAll(async () => {
  await mf?.dispose();
});
async function workerFetch(
  runtime: Miniflare,
  path: string,
  init?: RequestInit,
) {
  // Bun does not support the Undici dispatcher used by Miniflare.dispatchFetch.
  return fetch(new URL(path, await runtime.ready), init);
}
async function call<T = { error: string }>(
  path: string,
  body?: unknown,
  token?: string | null,
  method = body ? "POST" : "GET",
  language?: string,
) {
  const response = await workerFetch(mf, path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(language ? { "Accept-Language": language } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: (await response.json()) as T,
    headers: response.headers,
  };
}

async function demo() {
  const created = await call<Session>("/v1/auth/demo", {});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.headers.get("set-cookie"), null);
  return created.data;
}
async function tasks(token?: string) {
  const result = await call<{ tasks: Task[] }[]>(
    "/v1/incidents",
    undefined,
    token,
  );
  assert.equal(result.status, 200);
  return result.data.flatMap((incident) => incident.tasks);
}
test("cloud demo works with mock auth disabled and isolates volunteer workspaces", async () => {
  const config = await call<{ demo: boolean; mockAuth: boolean }>("/v1/config");
  assert.equal(config.data.demo, true);
  assert.equal(config.data.mockAuth, false);
  assert.equal(
    (await call("/v1/auth/sms", { phone: "13800000000" })).status,
    503,
  );
  const first = await demo(),
    second = await demo();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.profile.id, second.profile.id);
  assert.ok(Array.isArray(first.profile.equipment));
  assert.equal(typeof first.profile.birthDate, "string");
  assert.equal(
    (await call<Profile>("/v1/me", undefined, first.token)).data.id,
    first.profile.id,
  );
  const firstTasks = await tasks(first.token),
    secondTasks = await tasks(second.token),
    publicTasks = await tasks();
  assert.equal(firstTasks.length, 5);
  assert.ok(
    !firstTasks.some((task) =>
      [...secondTasks, ...publicTasks].some((other) => other.id === task.id),
    ),
  );
  const available = firstTasks.find((task) => task.title === "安置点物资整理")!;
  assert.equal((await call(`/v1/tasks/${available.id}`)).status, 404);
  assert.equal(
    (await call(`/v1/tasks/${available.id}`, undefined, second.token)).status,
    404,
  );
  assert.equal(
    (await call(`/v1/tasks/${publicTasks[0].id}`, undefined, first.token))
      .status,
    404,
  );
  const detail = (
    await call<Task>(`/v1/tasks/${available.id}`, undefined, first.token)
  ).data;
  const apply = {
    taskId: available.id,
    fields: detail.requiredFields,
    contactFields: detail.contactFields,
    consentVersion: 1,
  };
  assert.equal(
    (await call("/v1/applications", apply, second.token)).status,
    404,
  );
  const application = await call<{ id: string }>(
    "/v1/applications",
    apply,
    first.token,
  );
  assert.equal(application.status, 201, JSON.stringify(application.data));
  assert.equal(
    (await call("/v1/applications", apply, first.token)).status,
    409,
  );
  assert.equal(
    (
      await call(
        `/v1/applications/${application.data.id}/withdraw`,
        {},
        second.token,
      )
    ).status,
    409,
  );
  await db
    .prepare(
      "UPDATE applications SET status='accepted',updated_at=? WHERE id=?",
    )
    .bind(new Date().toISOString(), application.data.id)
    .run();
  const notices = await call<{ id: string; applicationId: string }[]>(
    "/v1/notifications",
    undefined,
    first.token,
  );
  assert.ok(
    notices.data.some((notice) => notice.applicationId === application.data.id),
  );
  assert.equal(
    (await call<unknown[]>("/v1/notifications", undefined, second.token)).data
      .length,
    0,
  );
  const patch = await call<Profile>(
    "/v1/me",
    { ...first.profile, username: "演示志愿者" },
    first.token,
    "PATCH",
  );
  assert.equal(patch.status, 200);
  assert.equal(patch.data.username, "演示志愿者");
  assert.equal((await call("/v1/me/logout", {}, first.token)).status, 200);
  assert.equal((await call("/v1/me", undefined, first.token)).status, 401);
  assert.equal(
    (await call("/v1/incidents", undefined, first.token)).status,
    401,
  );
});
test("demo expiry immediately revokes access and cleanup removes sessions and uploaded files", async () => {
  const user = await demo();
  const row = await db
    .prepare("SELECT organization_id FROM demo_volunteers WHERE user_id=?")
    .bind(user.profile.id)
    .first<{ organization_id: string }>();
  assert.ok(row);
  const files = await mf.getR2Bucket("FILES");
  const key = `credentials/${user.profile.id}/test`;
  await files.put(key, "test");
  await db
    .prepare("INSERT INTO credentials VALUES (?,?,?,?,?,?,?,?)")
    .bind(
      crypto.randomUUID(),
      user.profile.id,
      "Test",
      "test.pdf",
      "application/pdf",
      key,
      "uploaded",
      new Date().toISOString(),
    )
    .run();
  await db
    .prepare("UPDATE organizations SET demo_expires_at=1 WHERE id=?")
    .bind(row.organization_id)
    .run();
  assert.equal((await call("/v1/me", undefined, user.token)).status, 401);
  assert.equal(
    (await call("/v1/incidents", undefined, user.token)).status,
    401,
  );
  await cleanupOrganizerData(db, Date.now(), files);
  assert.equal(
    await db
      .prepare("SELECT id FROM users WHERE id=?")
      .bind(user.profile.id)
      .first(),
    null,
  );
  assert.equal(
    await db
      .prepare("SELECT user_id FROM sessions WHERE user_id=?")
      .bind(user.profile.id)
      .first(),
    null,
  );
  assert.equal(await files.get(key), null);
});
test("demo creation is rate limited", async () => {
  await db.prepare("DELETE FROM organizer_rate_limits").run();
  for (let index = 0; index < 12; index++) await demo();
  assert.equal((await call("/v1/auth/demo", {})).status, 429);
});
