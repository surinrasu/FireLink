import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type {
  ApplicationPage,
  ContentBlock,
  OrganizerApplication,
  OrganizerTask,
  Session,
  TaskInput,
  Workspace,
} from "../../shared/organizer";
import { cleanupOrganizerData } from "../src/organizer-maintenance.ts";
import type { UploadedMedia } from "../../shared/media";

let mf: Miniflare, db: D1Database, base: string;
type Identity = { cookie: string; org: string };
beforeAll(async () => {
  await mkdir(".artifacts", { recursive: true });
  await build({
    entryPoints: ["src/index.ts"],
    outfile: ".artifacts/organizer-worker.mjs",
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
          name: "organizer-tests",
          modules: true,
          scriptPath: ".artifacts/organizer-worker.mjs",
          compatibilityDate: "2026-10-13",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "organizer-test-db" },
          r2Buckets: ["FILES"],
          bindings: {
            APP_ENV: "local",
            ORGANIZER_DEMO: "true",
            MOCK_AUTH: "true",
            RP_ID: "localhost",
            PASSKEY_ORIGINS: "http://localhost:8787",
            APPLE_APP_ID: "",
            ANDROID_SHA256: "",
          },
        },
      ],
    }),
  );
  base = String(await mf.ready);
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).sort()) {
    const sql = await readFile(`migrations/${file}`, "utf8");
    for (const statement of sql.match(
      /\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g,
    ) ?? [])
      await db.exec(statement.replace(/\n/g, " "));
  }
});
afterAll(async () => {
  await mf?.dispose();
});
async function request<T = { error: string; ok?: boolean }>(
  path: string,
  identity?: Identity,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  extra: Record<string, string> = {},
) {
  const response = await fetch(new URL(`/api/organizer${path}`, base), {
    method,
    headers: {
      "X-FireLink-Request": "organizer",
      ...(identity
        ? { Cookie: identity.cookie, "X-Organization-Id": identity.org }
        : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    data: (await response.json()) as T,
  };
}
async function demo() {
  const created = await request<{ organizationId: string }>(
    "/auth/demo",
    undefined,
    {},
    "POST",
    { "CF-Connecting-IP": crypto.randomUUID() },
  );
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const cookie = created.headers.get("set-cookie")!.split(";")[0];
  return { cookie, org: created.data.organizationId };
}
async function workspace(identity: Identity) {
  const result = await request<Workspace>("/workspace", identity);
  assert.equal(result.status, 200);
  return result.data;
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
async function upload(
  identity?: Identity,
  bytes: Uint8Array = png,
  mime = "image/png",
  extra: Record<string, string> = {},
) {
  return fetch(new URL("/api/organizer/media", base), {
    method: "POST",
    headers: {
      "X-FireLink-Request": "organizer",
      "Content-Type": mime,
      "X-File-Name": encodeURIComponent("现场照片.png"),
      "X-File-Size": String(bytes.length),
      ...(identity
        ? { Cookie: identity.cookie, "X-Organization-Id": identity.org }
        : {}),
      ...extra,
    },
    body: bytes as BodyInit,
  });
}
async function readMedia(
  media: UploadedMedia,
  identity?: Identity,
  extra: Record<string, string> = {},
) {
  return fetch(media.url, {
    headers: { ...(identity ? { Cookie: identity.cookie } : {}), ...extra },
  });
}
function taskInput(task: OrganizerTask): TaskInput {
  const {
    title,
    summary,
    incidentId,
    capacity,
    startsAt,
    endsAt,
    deadline,
    location,
    meetingPoint,
    ownerId,
    blocks,
    requiredFields,
    contactFields,
    version,
  } = task;
  return {
    title,
    summary,
    incidentId,
    capacity,
    startsAt,
    endsAt,
    deadline,
    location,
    meetingPoint,
    ownerId,
    blocks,
    requiredFields,
    contactFields,
    version,
  };
}
test("organizer API requires session, organization membership and same-origin mutations", async () => {
  assert.equal((await request("/workspace")).status, 401);
  const identity = await demo();
  assert.equal(
    (await request("/workspace", { ...identity, org: "org-demo" })).status,
    403,
  );
  const csrf = await request("/auth/logout", identity, {}, "POST", {
    Origin: "https://unrelated.example",
  });
  assert.equal(csrf.status, 403);
  const result = await request<Session>("/auth/session", identity);
  assert.equal(result.data.memberships.length, 1);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("demo workspaces are isolated and excluded from volunteer public listings", async () => {
  const a = await demo(),
    b = await demo();
  const wa = await workspace(a),
    wb = await workspace(b);
  assert.notEqual(wa.organization.id, wb.organization.id);
  assert.ok(!wa.tasks.some((t) => wb.tasks.some((other) => other.id === t.id)));
  const apps = await request<ApplicationPage>("/applications", a);
  assert.equal(
    (await request(`/applications/${apps.data.items[0].id}`, b)).status,
    404,
  );
  const publicList = (await (
    await fetch(new URL("/v1/incidents", base))
  ).json()) as { tasks: { id: string }[] }[];
  assert.equal(publicList.flatMap((i) => i.tasks).length, 3);
  assert.equal(
    (await fetch(new URL(`/v1/tasks/${wa.tasks[0].id}`, base))).status,
    404,
  );
});
test("contacts never appear in lists or pending/rejected details and are audited on disclosure", async () => {
  const identity = await demo();
  const applications = (
    await request<ApplicationPage>("/applications", identity)
  ).data.items;
  assert.ok(applications.every((a) => a.contacts === null));
  for (const application of applications.filter((a) => a.status !== "accepted"))
    assert.equal(
      (
        await request<OrganizerApplication>(
          `/applications/${application.id}`,
          identity,
        )
      ).data.contacts,
      null,
    );
  const accepted = applications.find((a) => a.status === "accepted")!;
  const detail = await request<OrganizerApplication>(
    `/applications/${accepted.id}`,
    identity,
  );
  assert.ok(detail.data.contacts?.phone);
  assert.ok(
    (await workspace(identity)).activities.some(
      (a) => a.action === "查看授权联系方式",
    ),
  );
});
test("invited reviewers are task-scoped and cannot disclose contacts without separate permission", async () => {
  const admin = await demo(),
    ws = await workspace(admin);
  const task = ws.tasks.find((t) => t.state === "open")!;
  const invite = await request<{ url: string }>("/invitations", admin, {
    email: "reviewer@test.invalid",
    role: "reviewer",
    canViewContacts: false,
    taskIds: [task.id],
  });
  assert.equal(invite.status, 201);
  const token = invite.data.url.split("/join/")[1];
  const joined = await request("/auth/join", undefined, {
    token,
    name: "审核同事",
    password: "a-secure-test-password",
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  const reviewer = {
    cookie: joined.headers.get("set-cookie")!.split(";")[0],
    org: admin.org,
  };
  const reviewerWorkspace = await workspace(reviewer);
  assert.equal(reviewerWorkspace.tasks.length, 1);
  assert.equal(reviewerWorkspace.tasks[0].id, task.id);
  assert.equal(
    (await request("/tasks", reviewer, taskInput(task))).status,
    403,
  );
  assert.equal(
    (await request("/organization", reviewer, { name: "Changed" }, "PUT"))
      .status,
    403,
  );
  const apps = (await request<ApplicationPage>("/applications", reviewer)).data
    .items;
  assert.ok(apps.every((a) => a.taskId === task.id));
  const accepted = apps.find((a) => a.status === "accepted")!;
  assert.equal(
    (
      await request<OrganizerApplication>(
        `/applications/${accepted.id}`,
        reviewer,
      )
    ).data.contacts,
    null,
  );
  const otherTask = ws.tasks.find((t) => t.id !== task.id)!;
  assert.equal(
    (
      await request(
        `/tasks/${otherTask.id}`,
        reviewer,
        taskInput(otherTask),
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/join", undefined, {
        token,
        name: "再次使用",
        password: "a-secure-test-password",
      })
    ).status,
    400,
  );
  const reviewerMember = reviewerWorkspace.membership;
  assert.equal(
    (
      await request(
        `/members/${reviewerMember.id}`,
        admin,
        {
          role: "reviewer",
          canViewContacts: true,
          taskIds: [task.id],
          active: true,
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.ok(
    (
      await request<OrganizerApplication>(
        `/applications/${accepted.id}`,
        reviewer,
      )
    ).data.contacts?.phone,
  );
  assert.equal(
    (
      await request(
        `/members/${reviewerMember.id}`,
        admin,
        {
          role: "reviewer",
          canViewContacts: true,
          taskIds: [task.id],
          active: false,
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal((await request("/workspace", reviewer)).status, 403);
});
test("concurrent acceptance respects capacity and creates exactly one result notification", async () => {
  const identity = await demo();
  const apps = (await request<ApplicationPage>("/applications", identity)).data
    .items;
  const taskId = apps.find(
    (a) =>
      apps.filter((b) => b.taskId === a.taskId && b.status === "pending")
        .length === 2,
  )!.taskId;
  const candidates = apps.filter(
    (a) => a.taskId === taskId && a.status === "pending",
  );
  assert.equal(candidates.length, 2);
  await db
    .prepare(
      "UPDATE tasks SET capacity=(SELECT COUNT(*)+1 FROM applications WHERE task_id=? AND status='accepted') WHERE id=?",
    )
    .bind(taskId, taskId)
    .run();
  const result = await Promise.all(
    candidates.map((a) =>
      request(`/applications/${a.id}/decision`, identity, {
        status: "accepted",
        response: "欢迎参与，请直接联系组织者。",
      }),
    ),
  );
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  const winner = candidates[result.findIndex((r) => r.status === 200)];
  assert.equal(
    (
      await request(`/applications/${winner.id}/decision`, identity, {
        status: "rejected",
        response: "重复操作",
      })
    ).status,
    409,
  );
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE application_id=?")
      .bind(winner.id)
      .first<{ n: number }>())!.n,
    1,
  );
  assert.equal(
    (
      await request<OrganizerApplication>(
        `/applications/${winner.id}`,
        identity,
      )
    ).data.status,
    "accepted",
  );
});
test("withdrawal wins over stale organizer review and never releases contacts", async () => {
  const identity = await demo();
  const pending = (
    await request<ApplicationPage>("/applications", identity)
  ).data.items.find((a) => a.status === "pending")!;
  await db
    .prepare("UPDATE applications SET status='withdrawn' WHERE id=?")
    .bind(pending.id)
    .run();
  assert.equal(
    (
      await request(`/applications/${pending.id}/decision`, identity, {
        status: "accepted",
        response: "通过",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request<OrganizerApplication>(
        `/applications/${pending.id}`,
        identity,
      )
    ).data.contacts,
    null,
  );
});
test("task drafts publish, pause and close with optimistic edit conflicts and locked consent", async () => {
  const identity = await demo(),
    ws = await workspace(identity);
  const sample = ws.tasks.find((t) => t.state === "open")!;
  const created = await request<{ id: string }>("/tasks", identity, {
    ...taskInput(sample),
    title: "新增测试任务",
  });
  assert.equal(created.status, 201);
  let task = (await workspace(identity)).tasks.find(
    (t) => t.id === created.data.id,
  )!;
  assert.equal(task.state, "draft");
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "open",
        version: task.version,
      })
    ).status,
    200,
  );
  task = (await workspace(identity)).tasks.find((t) => t.id === task.id)!;
  const [a, b] = await Promise.all(
    ["修改一", "修改二"].map((title) =>
      request(
        `/tasks/${task.id}`,
        identity,
        { ...taskInput(task), title },
        "PUT",
      ),
    ),
  );
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  task = (await workspace(identity)).tasks.find((t) => t.id === task.id)!;
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "paused",
        version: task.version,
      })
    ).status,
    200,
  );
  task = (await workspace(identity)).tasks.find((t) => t.id === task.id)!;
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "closed",
        version: task.version,
      })
    ).status,
    200,
  );
  task = (await workspace(identity)).tasks.find((t) => t.id === task.id)!;
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "archived",
        version: task.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/tasks/${sample.id}`,
        identity,
        { ...taskInput(sample), requiredFields: ["realName", "age"] },
        "PUT",
      )
    ).status,
    409,
  );
});
test("task changes notify only pending applications; accepted communication is out of scope", async () => {
  const identity = await demo(),
    ws = await workspace(identity);
  const task = ws.tasks.find((t) => t.state === "open")!;
  const before = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM notifications n JOIN applications a ON a.id=n.application_id WHERE a.task_id=?",
    )
    .bind(task.id)
    .first<{ n: number }>();
  assert.equal(
    (
      await request(
        `/tasks/${task.id}`,
        identity,
        { ...taskInput(task), location: "新地点" },
        "PUT",
      )
    ).status,
    200,
  );
  const after = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM notifications n JOIN applications a ON a.id=n.application_id WHERE a.task_id=?",
    )
    .bind(task.id)
    .first<{ n: number }>();
  assert.equal(after!.n - before!.n, task.pending);
  const changed = await db
    .prepare(
      "SELECT a.status FROM notifications n JOIN applications a ON a.id=n.application_id WHERE a.task_id=? AND n.title='任务信息已更新'",
    )
    .bind(task.id)
    .all<{ status: string }>();
  assert.ok(changed.results.every((r) => r.status === "pending"));
});
test("organization admins cannot remove the last admin or assign foreign tasks", async () => {
  const identity = await demo(),
    other = await demo();
  const ws = await workspace(identity),
    foreign = (await workspace(other)).tasks[0];
  assert.equal(
    (
      await request(
        `/members/${ws.membership.id}`,
        identity,
        { role: "reviewer", active: true, canViewContacts: false, taskIds: [] },
        "PUT",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/invitations", identity, {
        email: "bad@test.invalid",
        role: "manager",
        canViewContacts: true,
        taskIds: [foreign.id],
      })
    ).status,
    400,
  );
  assert.equal((await request("/auth/logout", identity, {})).status, 200);
  assert.equal((await request("/auth/session", identity)).status, 401);
});
test("unverified organizations cannot publish or accept applications", async () => {
  const identity = await demo(),
    ws = await workspace(identity);
  await db
    .prepare("UPDATE organizations SET verified=0 WHERE id=?")
    .bind(identity.org)
    .run();
  const draft = ws.tasks.find((t) => t.state === "draft")!;
  assert.equal(
    (
      await request(`/tasks/${draft.id}/state`, identity, {
        state: "open",
        version: draft.version,
      })
    ).status,
    403,
  );
  const application = (
    await request<ApplicationPage>("/applications", identity)
  ).data.items.find((a) => a.status === "pending")!;
  assert.equal(
    (
      await request(`/applications/${application.id}/decision`, identity, {
        status: "accepted",
        response: "通过",
      })
    ).status,
    403,
  );
  const accepted = (
    await request<ApplicationPage>("/applications?status=accepted", identity)
  ).data.items[0];
  assert.equal(
    (
      await request<OrganizerApplication>(
        `/applications/${accepted.id}`,
        identity,
      )
    ).data.contacts,
    null,
  );
});

test("a verified organization must provide its own contacts before publishing or accepting", async () => {
  const identity = await demo(),
    ws = await workspace(identity);
  const draft = ws.tasks.find((t) => t.state === "draft")!;
  const application = (
    await request<ApplicationPage>("/applications?status=pending", identity)
  ).data.items[0];
  await db
    .prepare("UPDATE organizations SET contact_methods='[]' WHERE id=?")
    .bind(identity.org)
    .run();
  assert.equal(
    (
      await request(`/tasks/${draft.id}/state`, identity, {
        state: "open",
        version: draft.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/applications/${application.id}/decision`, identity, {
        status: "accepted",
        response: "通过",
      })
    ).status,
    400,
  );
});

test("application pagination and search preserve counts, scope and contact privacy", async () => {
  const identity = await demo(),
    ws = await workspace(identity),
    task = ws.tasks[0];
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < 55; i++) {
    const id = crypto.randomUUID();
    statements.push(
      db
        .prepare("INSERT INTO users VALUES (?,?,?,?)")
        .bind(id, `demo:${id}`, "{}", new Date().toISOString()),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO applications(id,user_id,task_id,status,profile_snapshot,contact_snapshot,consent_version,created_at,updated_at) VALUES (?,?,?,'pending',?,?,1,?,?)",
        )
        .bind(
          id,
          id,
          task.id,
          JSON.stringify({ realName: `分页测试${i}` }),
          '{"phone":"13800000000"}',
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    );
  }
  await db.batch(statements);
  const path = `/applications?taskId=${task.id}&status=pending&q=${encodeURIComponent("分页测试")}`;
  const first = (await request<ApplicationPage>(path, identity)).data;
  const second = (await request<ApplicationPage>(`${path}&page=2`, identity))
    .data;
  assert.equal(first.total, 55);
  assert.equal(first.counts.pending, 55);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 5);
  assert.equal(
    new Set([...first.items, ...second.items].map((a) => a.id)).size,
    55,
  );
  assert.ok(
    [...first.items, ...second.items].every((a) => a.contacts === null),
  );
  const other = await demo();
  assert.equal((await request<ApplicationPage>(path, other)).data.total, 0);
});

test("new organizer scheduling fields reach existing mobile clients through content blocks", async () => {
  const identity = await demo(),
    ws = await workspace(identity),
    task = ws.tasks.find((t) => t.state === "open")!;
  await db
    .prepare("UPDATE organizations SET demo_expires_at=NULL WHERE id=?")
    .bind(identity.org)
    .run();
  const response = await fetch(new URL(`/v1/tasks/${task.id}`, base));
  assert.equal(response.status, 200);
  const detail = (await response.json()) as {
    blocks: { type: string; rows?: string[][] }[];
  };
  assert.equal(detail.blocks[1].type, "table");
  assert.ok(detail.blocks[1].rows!.some((row) => row[1] === task.location));
  assert.ok(
    detail.blocks[1].rows!.some((row) => row[1] === String(task.capacity)),
  );
});

test("expired demo cleanup removes tenant data while preserving real organizations and active demos", async () => {
  const expired = await demo(),
    active = await demo();
  const oldWorkspace = await workspace(expired);
  const before = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM organizations WHERE demo_expires_at IS NULL",
    )
    .first<{ n: number }>();
  // A real colleague's account can outlive an invitation to a demo organization.
  const accountId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO organizer_accounts VALUES (?,?,?,'salt','hash',?)")
      .bind(
        accountId,
        `${accountId}@example.invalid`,
        "真实同事",
        new Date().toISOString(),
      ),
    db
      .prepare("INSERT INTO organization_members VALUES (?,?,?,'reviewer',0,1)")
      .bind(crypto.randomUUID(), expired.org, accountId),
    db
      .prepare("UPDATE organizations SET demo_expires_at=1 WHERE id=?")
      .bind(expired.org),
  ]);
  assert.equal((await request("/workspace", expired)).status, 403);
  await cleanupOrganizerData(db);
  assert.equal(
    await db
      .prepare("SELECT id FROM organizations WHERE id=?")
      .bind(expired.org)
      .first(),
    null,
  );
  assert.equal(
    await db
      .prepare("SELECT id FROM tasks WHERE id=?")
      .bind(oldWorkspace.tasks[0].id)
      .first(),
    null,
  );
  assert.equal((await request("/auth/session", expired)).status, 401);
  assert.ok(
    await db
      .prepare("SELECT id FROM organizer_accounts WHERE id=?")
      .bind(accountId)
      .first(),
  );
  assert.equal((await workspace(active)).organization.id, active.org);
  assert.equal(
    (await db
      .prepare(
        "SELECT COUNT(*) AS n FROM organizations WHERE demo_expires_at IS NULL",
      )
      .first<{ n: number }>())!.n,
    before!.n,
  );
});

test("media uploads validate identity, format, actual length, quota and tenant references", async () => {
  assert.equal((await upload()).status, 401);
  const owner = await demo(),
    other = await demo();
  assert.equal(
    (
      await upload(owner, png, "image/png", {
        Origin: "https://elsewhere.invalid",
      })
    ).status,
    403,
  );
  assert.equal((await upload(owner, png, "image/svg+xml")).status, 400);
  assert.equal(
    (await upload(owner, new Uint8Array(32), "image/png")).status,
    400,
  );
  assert.equal(
    (
      await upload(owner, png, "image/png", {
        "X-File-Size": String(9 * 1024 * 1024),
      })
    ).status,
    413,
  );
  assert.equal(
    (await upload(owner, png, "image/png", { "X-File-Size": "16" })).status,
    413,
  );
  assert.equal(
    (await upload(owner, png, "image/png", { "X-File-Size": "100" })).status,
    400,
  );
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) n FROM organizer_media WHERE organization_id=?")
      .bind(owner.org)
      .first<{ n: number }>())!.n,
    0,
  );
  const response = await upload(owner);
  assert.equal(response.status, 201, await response.clone().text());
  const media = (await response.json()) as UploadedMedia;
  assert.equal((await readMedia(media)).status, 404);
  assert.equal((await readMedia(media, other)).status, 404);
  const own = await readMedia(media, owner);
  assert.equal(own.status, 200);
  assert.match(own.headers.get("x-robots-tag")!, /noindex/);
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), png);
  const otherTask = (await workspace(other)).tasks.find(
    (t) => t.state === "draft",
  )!;
  assert.equal(
    (
      await request(
        `/tasks/${otherTask.id}`,
        other,
        {
          ...taskInput(otherTask),
          blocks: [{ type: "image", url: media.url }],
        },
        "PUT",
      )
    ).status,
    400,
  );
  const ws = await workspace(owner),
    task = ws.tasks.find((t) => t.state === "draft")!;
  assert.equal(
    (
      await request(
        `/tasks/${task.id}`,
        owner,
        { ...taskInput(task), blocks: [{ type: "image", url: media.url }] },
        "PUT",
      )
    ).status,
    200,
  );
  // A draft attachment remains private even for a real organization.
  await db
    .prepare("UPDATE organizations SET demo_expires_at=NULL WHERE id=?")
    .bind(owner.org)
    .run();
  assert.equal((await readMedia(media)).status, 404);
  await db
    .prepare("UPDATE tasks SET publication_status='published' WHERE id=?")
    .bind(task.id)
    .run();
  assert.equal((await readMedia(media)).status, 200);
  // Reservations, including unfinished uploads, are part of the storage budget.
  await db
    .prepare("UPDATE organizer_media SET size=1073741824 WHERE id=?")
    .bind(media.id)
    .run();
  assert.equal((await upload(owner)).status, 413);
});

test("private attachments follow assigned-task permissions and cannot be republished by another manager", async () => {
  const owner = await demo(),
    ws = await workspace(owner),
    task = ws.tasks.find((t) => t.state === "draft")!;
  const media = (await (await upload(owner)).json()) as UploadedMedia;
  const invite = await request<{ url: string }>("/invitations", owner, {
    email: "media-manager@test.invalid",
    role: "manager",
    canViewContacts: false,
    taskIds: [],
  });
  const joined = await request("/auth/join", undefined, {
    token: invite.data.url.split("/join/")[1],
    name: "任务同事",
    password: "media-test-password",
  });
  assert.equal(joined.status, 200);
  const manager = {
    cookie: joined.headers.get("set-cookie")!.split(";")[0],
    org: owner.org,
  };
  const managerWs = await workspace(manager);
  assert.equal((await readMedia(media, manager)).status, 404);
  assert.equal(
    (
      await request("/tasks", manager, {
        ...taskInput(task),
        ownerId: managerWs.membership.id,
        blocks: [{ type: "image", url: media.url }],
      })
    ).status,
    400,
  );
  await request(
    `/tasks/${task.id}`,
    owner,
    { ...taskInput(task), blocks: [{ type: "image", url: media.url }] },
    "PUT",
  );
  await db
    .prepare("INSERT INTO member_tasks VALUES (?,?)")
    .bind(managerWs.membership.id, task.id)
    .run();
  assert.equal((await readMedia(media, manager)).status, 200);
  await db
    .prepare("UPDATE organization_members SET role='reviewer' WHERE id=?")
    .bind(managerWs.membership.id)
    .run();
  assert.equal((await upload(manager)).status, 403);
  await db
    .prepare("UPDATE organization_members SET active=0 WHERE id=?")
    .bind(managerWs.membership.id)
    .run();
  assert.equal((await readMedia(media, manager)).status, 404);
});

test("large videos use multipart storage and support ranges; demo expiry removes R2 objects", async () => {
  const owner = await demo();
  const video = new Uint8Array(6 * 1024 * 1024 + 17);
  video.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  video[video.length - 1] = 42;
  const result = await upload(owner, video, "video/mp4");
  assert.equal(result.status, 201, await result.clone().text());
  const media = (await result.json()) as UploadedMedia;
  const partial = await readMedia(media, owner, { Range: "bytes=4-11" });
  assert.equal(partial.status, 206);
  assert.equal(
    partial.headers.get("content-range"),
    `bytes 4-11/${video.length}`,
  );
  assert.equal(await partial.text(), "ftypisom");
  const suffix = await readMedia(media, owner, { Range: "bytes=-1" });
  assert.equal(new Uint8Array(await suffix.arrayBuffer())[0], 42);
  assert.equal(
    (await readMedia(media, owner, { Range: `bytes=${video.length}-` })).status,
    416,
  );
  const files = await mf.getR2Bucket("FILES");
  const objectKey = (await db
    .prepare("SELECT object_key FROM organizer_media WHERE id=?")
    .bind(media.id)
    .first<{ object_key: string }>())!.object_key;
  assert.ok(await files.head(objectKey));
  await db
    .prepare("UPDATE organizations SET demo_expires_at=1 WHERE id=?")
    .bind(owner.org)
    .run();
  assert.equal((await readMedia(media, owner)).status, 404);
  await cleanupOrganizerData(db, Date.now(), files);
  assert.equal(await files.head(objectKey), null);
  assert.equal(
    await db
      .prepare("SELECT id FROM organizer_media WHERE id=?")
      .bind(media.id)
      .first(),
    null,
  );
});

test("tasks can accept applications after starting, but not after their end", async () => {
  const identity = await demo();
  const task = (await workspace(identity)).tasks.find(
    (task) => task.state === "draft",
  )!;
  const now = Date.now();
  const input = {
    ...taskInput(task),
    title: "持续报名的任务",
    summary: "任务开始后仍可加入",
    location: "社区服务中心",
    startsAt: new Date(now - 3600000).toISOString(),
    deadline: new Date(now + 24 * 3600000).toISOString(),
    endsAt: new Date(now + 48 * 3600000).toISOString(),
  };
  const created = await request<{ id: string }>("/tasks", identity, input);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(
    (
      await request(`/tasks/${created.data.id}/state`, identity, {
        state: "open",
        version: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/tasks/${created.data.id}`,
        identity,
        {
          ...input,
          version: 2,
          deadline: new Date(now + 49 * 3600000).toISOString(),
        },
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/tasks/${created.data.id}`,
        identity,
        { ...input, version: 2, endsAt: input.startsAt },
        "PUT",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/tasks/${created.data.id}`,
        identity,
        { ...input, version: 2, deadline: input.endsAt },
        "PUT",
      )
    ).status,
    200,
  );
});

test("map annotations round-trip, publish all geometry types and reject incomplete or invalid shapes", async () => {
  const identity = await demo();
  const task = (await workspace(identity)).tasks.find(
    (task) => task.state === "draft",
  )!;
  const fixture = JSON.parse(
    await readFile("../fixtures/map-annotations.json", "utf8"),
  ) as ContentBlock[];
  const input = {
    ...taskInput(task),
    title: "地图标注验证",
    summary: "位置、路径与范围",
    location: "社区服务中心",
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    deadline: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    blocks: [fixture[1]],
  };
  const created = await request<{ id: string }>("/tasks", identity, input);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.deepEqual(
    (await workspace(identity)).tasks.find(
      (task) => task.id === created.data.id,
    )!.blocks,
    input.blocks,
  );
  assert.equal(
    (
      await request(`/tasks/${created.data.id}/state`, identity, {
        state: "open",
        version: 1,
      })
    ).status,
    200,
  );
  await db
    .prepare("UPDATE organizations SET demo_expires_at=NULL WHERE id=?")
    .bind(identity.org)
    .run();
  const published = (await (
    await fetch(new URL(`/v1/tasks/${created.data.id}`, base))
  ).json()) as { blocks: ContentBlock[] };
  assert.deepEqual(
    published.blocks.find((block) => block.type === "map")?.annotations,
    fixture[1].annotations,
  );
  for (const annotation of [
    { type: "path", coordinates: [{ latitude: 91, longitude: 120 }] },
    {
      type: "point",
      coordinates: [
        { latitude: 30, longitude: 120 },
        { latitude: 31, longitude: 121 },
      ],
    },
  ])
    assert.equal(
      (
        await request("/tasks", identity, {
          ...input,
          blocks: [{ type: "map", annotations: [annotation] }],
        })
      ).status,
      400,
    );
  for (const annotations of [
    [{ type: "path", coordinates: [{ latitude: 30, longitude: 120 }] }],
    [
      {
        type: "area",
        coordinates: [
          { latitude: 30, longitude: 120 },
          { latitude: 31, longitude: 121 },
          { latitude: 32, longitude: 122 },
        ],
      },
    ],
    [
      {
        type: "area",
        coordinates: [
          { latitude: 30, longitude: 120 },
          { latitude: 31, longitude: 121 },
        ],
      },
    ],
    [
      {
        type: "path",
        coordinates: [
          { latitude: 30, longitude: 120 },
          { latitude: 30, longitude: 120 },
        ],
      },
    ],
    [],
  ]) {
    const draft = await request<{ id: string }>("/tasks", identity, {
      ...input,
      blocks: [{ type: "map", latitude: 30, longitude: 120, annotations }],
    });
    assert.equal(draft.status, 201);
    assert.equal(
      (
        await request(`/tasks/${draft.data.id}/state`, identity, {
          state: "open",
          version: 1,
        })
      ).status,
      400,
    );
    if (!annotations.length)
      assert.equal(
        (await workspace(identity)).tasks.find(
          (task) => task.id === draft.data.id,
        )!.blocks[0].latitude,
        undefined,
      );
  }
});

test("publishing requires complete media and map blocks, while draft coordinates may be blank", async () => {
  const identity = await demo(),
    task = (await workspace(identity)).tasks.find((t) => t.state === "draft")!;
  const input = {
    ...taskInput(task),
    summary: "需要帮助",
    location: "社区",
    startsAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
    endsAt: "",
    blocks: [{ type: "map" as const }],
  };
  assert.equal(
    (await request(`/tasks/${task.id}`, identity, input, "PUT")).status,
    200,
  );
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "open",
        version: task.version + 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/tasks/${task.id}`,
        identity,
        {
          ...input,
          version: task.version + 1,
          blocks: [{ type: "map", latitude: 0, longitude: 0 }],
        },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/tasks/${task.id}/state`, identity, {
        state: "open",
        version: task.version + 2,
      })
    ).status,
    200,
  );
});
