import { afterAll, beforeAll, test } from "bun:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { applicationForOrganizer } from "../src/organizer.ts";
import type { Profile } from "../src/domain.ts";
import type fixture from "../../fixtures/demo.json";
type Session = { token: string; profile: Profile };
type SmsChallenge = { challengeId: string; mockCode: string };
type Verification =
  | Session
  | { registrationToken: string; needsRegistration: true };
type CreatedApplication = { id: string; status: string };
type Application = CreatedApplication & { contactsReleased: boolean };
type Notification = {
  id: string;
  title: string;
  body: string;
  applicationId: string;
  applicationStatus?: string;
};
type Incident = (typeof fixture.incidents)[number] & {
  tasks: (typeof fixture.tasks)[number][];
};
type Task = (typeof fixture.tasks)[number] & {
  organizer: (typeof fixture.organizations)[number];
};
type LocalConfig = { mockIdentity: { realName: string; idNumber: string } };

let mf: Miniflare;
let db: D1Database;
beforeAll(async () => {
  await mkdir(".artifacts", { recursive: true });
  await build({
    entryPoints: ["src/index.ts"],
    outfile: ".artifacts/worker.mjs",
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
          scriptPath: ".artifacts/worker.mjs",
          compatibilityDate: "2026-10-06",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "test-db" },
          r2Buckets: ["FILES"],
          bindings: {
            APP_ENV: "local",
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
async function account(phone: string) {
  const sms = await call<SmsChallenge>("/v1/auth/sms", { phone });
  assert.equal(sms.status, 200);
  const result = await call<Verification>("/v1/auth/verify", {
    challengeId: sms.data.challengeId,
    code: sms.data.mockCode,
  });
  if ("token" in result.data) return result.data;
  const created = await call<Session>("/v1/auth/register", {
    registrationToken: result.data.registrationToken,
    realName: "林晓",
    idNumber: "000000199806180020",
    consent: true,
  });
  assert.equal(created.status, 201);
  return created.data;
}
async function requiredApplication(id: string) {
  const application = await applicationForOrganizer(db, "org-demo", id);
  assert.ok(application);
  return application;
}
test("public content follows shared fixtures; protected endpoints require login", async () => {
  const fixture = JSON.parse(await readFile("../fixtures/demo.json", "utf8"));
  const list = await call<Incident[]>("/v1/incidents");
  assert.equal(list.status, 200);
  assert.equal(list.data[0].id, fixture.incidents[0].id);
  assert.equal(list.data[0].tasks.length, 2);
  assert.equal((await call("/v1/me")).status, 401);
  assert.equal((await call("/v1/auth/sms", { phone: "123" })).status, 400);
  assert.equal((await call("/v1/auth/passkeys/options", {})).status, 503);
});
test("SMS challenges and registration grants are single use", async () => {
  const sms = await call<SmsChallenge>("/v1/auth/sms", {
    phone: "13800000001",
  });
  const body = { challengeId: sms.data.challengeId, code: sms.data.mockCode };
  const verified = await call<Verification>("/v1/auth/verify", body);
  assert.equal(verified.status, 200);
  assert.equal((await call("/v1/auth/verify", body)).status, 400);
  assert.ok("registrationToken" in verified.data);
  const register = {
    registrationToken: verified.data.registrationToken,
    realName: "周远",
    idNumber: "000000199503120013",
    consent: true,
  };
  assert.equal((await call("/v1/auth/register", register)).status, 201);
  assert.equal((await call("/v1/auth/register", register)).status, 400);
});
test("profile validation identifies every invalid field and preserves saved data", async () => {
  const user = await account("13900000088");
  const missing = await call(
    "/v1/applications",
    {
      taskId: "task-supply",
      fields: ["realName", "region"],
      contactFields: ["phone", "email"],
      consentVersion: 1,
    },
    user.token,
    "POST",
    "zh-Hans",
  );
  assert.equal(missing.status, 400);
  assert.ok(missing.data.error.includes("活动区域"), missing.data.error);
  assert.ok(missing.data.error.includes("电子邮箱"), missing.data.error);
  const invalid = await call(
    "/v1/me",
    {
      ...user.profile,
      username: " ",
      pronouns: "字".repeat(21),
      contacts: {
        phone: "123",
        wechat: "x".repeat(61),
        email: "invalid-email",
      },
    },
    user.token,
    "PATCH",
    "zh-Hans",
  );
  assert.equal(invalid.status, 400);
  for (const message of [
    "用户名需为 1–30 个字符",
    "称呼代词不能超过 20 个字符",
    "联系电话须为有效的中国大陆手机号",
    "微信号不能超过 60 个字符",
    "电子邮箱格式不正确，请填写有效邮箱或留空",
  ])
    assert.ok(invalid.data.error.includes(message), invalid.data.error);
  assert.equal(invalid.data.error.split("\n").length, 5);
  const unchanged = await call<Profile>("/v1/me", null, user.token);
  assert.deepEqual(unchanged.data, user.profile);

  const valid = await call<Profile>(
    "/v1/me",
    {
      ...user.profile,
      username: "字".repeat(30),
      pronouns: "字".repeat(20),
      region: "浙江省 杭州市 西湖区",
      contacts: {
        phone: "+86 139-0000-0088",
        wechat: "x".repeat(60),
        email: "",
      },
    },
    user.token,
    "PATCH",
  );
  assert.equal(valid.status, 200);
  assert.equal(valid.data.region, "浙江省 杭州市 西湖区");
  assert.equal(valid.data.contacts.phone, "13900000088");

  for (const language of ["en", "zh-Hant", "zh-Hant-HK"]) {
    const result = await call(
      "/v1/me",
      { ...valid.data, username: "x".repeat(31) },
      user.token,
      "PATCH",
      language,
    );
    assert.equal(result.status, 400);
    assert.ok(result.data.error.includes("30"));
    assert.ok(!result.data.error.includes("invalid_username"));
  }
});
test("authorization snapshots, organization isolation and result notification", async () => {
  const user = await account("13800000002");
  const other = await account("13800000003");
  const profile = {
    ...user.profile,
    region: "浙江省 杭州市 西湖区",
    username: "测试志愿者",
  };
  assert.equal(
    (await call("/v1/me", profile, user.token, "PATCH")).status,
    200,
  );
  const request = {
    taskId: "task-supply",
    fields: ["realName", "region"],
    contactFields: ["phone"],
    consentVersion: 1,
  };
  assert.equal(
    (
      await call(
        "/v1/applications",
        { ...request, fields: ["realName"] },
        user.token,
      )
    ).status,
    400,
  );
  const result = await call<CreatedApplication>(
    "/v1/applications",
    request,
    user.token,
  );
  assert.equal(result.status, 201);
  assert.equal(
    (await call("/v1/applications", request, user.token)).status,
    409,
  );
  const id = result.data.id;
  assert.equal(await applicationForOrganizer(db, "wrong-org", id), null);
  assert.equal((await requiredApplication(id)).contacts, null);
  assert.equal(
    (await call<Application[]>("/v1/applications", null, other.token)).data
      .length,
    0,
  );
  assert.equal(
    (await call(`/v1/applications/${id}/withdraw`, {}, other.token)).status,
    409,
  );
  profile.contacts.phone = "13900000002";
  profile.region = "江苏省 南京市";
  await call("/v1/me", profile, user.token, "PATCH");
  await db
    .prepare(
      "UPDATE applications SET status='accepted',response='请等待联系',updated_at=? WHERE id=?",
    )
    .bind(new Date().toISOString(), id)
    .run();
  const disclosed = await applicationForOrganizer(db, "org-demo", id);
  assert.ok(disclosed);
  assert.equal(disclosed.contacts.phone, "13800000002");
  assert.equal(disclosed.profile.region, "浙江省 杭州市 西湖区");
  assert.equal(disclosed.profile.body, undefined);
  const notifications = await call<Notification[]>(
    "/v1/notifications",
    null,
    user.token,
  );
  assert.equal(notifications.data.length, 1);
  assert.equal(notifications.data[0].applicationId, id);
  for (const [language, title] of [
    ["en", "Application accepted"],
    ["zh-HK", "報名已通過"],
  ]) {
    const localized = await call<Notification[]>(
      "/v1/notifications",
      null,
      user.token,
      "GET",
      language,
    );
    assert.equal(localized.data[0].title, title);
    assert.equal(localized.data[0].body, "请等待联系");
    assert.equal(localized.data[0].applicationStatus, undefined);
  }
  assert.equal(
    (await call(`/v1/applications/${id}/withdraw`, {}, user.token)).status,
    409,
  );
  const records = await call<Application[]>(
    "/v1/applications",
    null,
    user.token,
  );
  assert.equal(records.data[0].contactsReleased, true);
});
test("vehicle counts and free-form equipment persist and are shared independently", async () => {
  const user = await account("13900000089");
  const base = {
    ...user.profile,
    region: "浙江省 杭州市 西湖区",
    contacts: { ...user.profile.contacts, wechat: "vehicle-test" },
  };
  for (const [key, label] of [
    ["motorcycle", "摩托车"],
    ["cargoTricycle", "三轮货车"],
    ["sedan", "轿车"],
    ["offRoad", "越野车"],
    ["cargoVan", "厢式货车"],
  ]) {
    for (const count of [-1, 0.5, 1000, "1"]) {
      const invalid = await call(
        "/v1/me",
        { ...base, vehicles: { [key]: count } },
        user.token,
        "PATCH",
        "zh-Hans",
      );
      assert.equal(invalid.status, 400);
      assert.ok(invalid.data.error.includes(label), invalid.data.error);
    }
  }
  const unknown = await call(
    "/v1/me",
    { ...base, vehicles: { unknown: 1 } },
    user.token,
    "PATCH",
    "zh-Hans",
  );
  assert.equal(unknown.status, 400);
  assert.ok(unknown.data.error.includes("载具"));
  const description =
    "自由填写：帐篷、对讲机、手套 🧤\n数量、用途都可自己写。" +
    "装备".repeat(200);
  const vehicles = {
    motorcycle: 2,
    cargoTricycle: 1,
    sedan: 0,
    offRoad: 1,
    cargoVan: 3,
  };
  const saved = await call<Profile>(
    "/v1/me",
    { ...base, equipmentDescription: description, vehicles },
    user.token,
    "PATCH",
  );
  assert.equal(saved.status, 200);
  const loaded = await call<Profile>("/v1/me", null, user.token);
  assert.equal(loaded.data.equipmentDescription, description);
  assert.deepEqual(loaded.data.vehicles, vehicles);

  const vehicleApplication = await call<CreatedApplication>(
    "/v1/applications",
    {
      taskId: "task-supply",
      fields: ["realName", "region", "vehicles"],
      contactFields: ["phone"],
      consentVersion: 1,
    },
    user.token,
  );
  assert.equal(vehicleApplication.status, 201);
  const vehicleSnapshot = (
    await requiredApplication(vehicleApplication.data.id)
  ).profile;
  assert.deepEqual(vehicleSnapshot.vehicles, vehicles);
  assert.ok(!Object.hasOwn(vehicleSnapshot, "equipment"));
  assert.ok(!Object.hasOwn(vehicleSnapshot, "equipmentDetails"));

  const equipmentApplication = await call<CreatedApplication>(
    "/v1/applications",
    {
      taskId: "task-support",
      fields: ["realName", "equipment"],
      contactFields: ["phone", "wechat"],
      consentVersion: 1,
    },
    user.token,
  );
  assert.equal(equipmentApplication.status, 201);
  const equipmentSnapshot = (
    await requiredApplication(equipmentApplication.data.id)
  ).profile;
  assert.equal(equipmentSnapshot.equipment, description);
  assert.ok(!Object.hasOwn(equipmentSnapshot, "vehicles"));

  const cleared = await call<Profile>(
    "/v1/me",
    { ...base, equipmentDescription: "", vehicles: { motorcycle: 0 } },
    user.token,
    "PATCH",
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.equipmentDescription, "");
  const transport = await call(
    "/v1/applications",
    {
      taskId: "task-transport",
      fields: ["realName", "vehicles", "skills"],
      contactFields: ["phone"],
      consentVersion: 1,
    },
    user.token,
    "POST",
    "zh-Hans",
  );
  assert.equal(transport.status, 400);
  assert.ok(transport.data.error.includes("载具"), transport.data.error);
  assert.deepEqual(
    (await requiredApplication(vehicleApplication.data.id)).profile.vehicles,
    vehicles,
  );
});

test("legacy equipment descriptions migrate once and never override deliberately cleared text", async () => {
  const user = await account("13900000090");
  const { equipmentDescription: _, vehicles: __, ...legacy } = user.profile;
  const input = {
    ...legacy,
    equipment: ["vehicle", "firstAid"],
    equipmentDetails: {
      vehiclePassengers: "4 人",
      vehicleCargo: "500 升",
      firstAid: "急救包 1 套",
    },
  };
  const migrated = await call<Profile>("/v1/me", input, user.token, "PATCH");
  assert.equal(migrated.status, 200);
  for (const text of ["4 人", "500 升", "急救包 1 套"])
    assert.ok(migrated.data.equipmentDescription.includes(text));
  assert.deepEqual(migrated.data.vehicles, {});
  assert.deepEqual(migrated.data.equipment, []);
  assert.deepEqual(migrated.data.equipmentDetails, {});
  const cleared = await call<Profile>(
    "/v1/me",
    { ...input, equipmentDescription: "" },
    user.token,
    "PATCH",
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.equipmentDescription, "");
});

test("withdrawn and rejected applications never expose contacts", async () => {
  for (const [phone, status] of [
    ["13800000004", "withdrawn"],
    ["13800000005", "rejected"],
  ]) {
    const user = await account(phone);
    await call(
      "/v1/me",
      { ...user.profile, region: "浙江省 杭州市" },
      user.token,
      "PATCH",
    );
    const result = await call<CreatedApplication>(
      "/v1/applications",
      {
        taskId: "task-supply",
        fields: ["realName", "region"],
        contactFields: ["phone"],
        consentVersion: 1,
      },
      user.token,
    );
    const id = result.data.id;
    if (status === "withdrawn")
      assert.equal(
        (await call(`/v1/applications/${id}/withdraw`, {}, user.token)).status,
        200,
      );
    else
      await db
        .prepare("UPDATE applications SET status=? WHERE id=?")
        .bind(status, id)
        .run();
    assert.equal((await requiredApplication(id)).contacts, null);
    await assert.rejects(() =>
      db
        .prepare("UPDATE applications SET status='accepted' WHERE id=?")
        .bind(id)
        .run(),
    );
  }
});
test("private certificate upload is bounded, checked and owner scoped", async () => {
  const user = await account("13800000006"),
    other = await account("13800000007");
  const response = await workerFetch(mf, "/v1/credentials", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/pdf",
      "X-Certificate-Title": encodeURIComponent("驾驶证明"),
      "X-File-Name": "demo.pdf",
    },
    body: "%PDF-1.4\n%%EOF",
  });
  assert.equal(response.status, 201);
  const file = (await response.json()) as { id: string };
  assert.equal(
    (
      await workerFetch(mf, `/v1/credentials/${file.id}/file`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await workerFetch(mf, `/v1/credentials/${file.id}/file`, {
        headers: { Authorization: `Bearer ${other.token}` },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await workerFetch(mf, "/v1/credentials", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.token}`,
          "Content-Type": "image/png",
          "X-Certificate-Title": "test",
        },
        body: "not an image",
      })
    ).status,
    400,
  );
  assert.equal((await call("/v1/me/logout", {}, user.token)).status, 200);
  assert.equal((await call("/v1/me", null, user.token)).status, 401);
});
test("closed tasks and unverified organizers reject enrollment", async () => {
  const user = await account("13800000008");
  await call(
    "/v1/me",
    { ...user.profile, region: "浙江省 杭州市" },
    user.token,
    "PATCH",
  );
  await db
    .prepare("UPDATE tasks SET status='closed' WHERE id='task-supply'")
    .run();
  const body = {
    taskId: "task-supply",
    fields: ["realName", "region"],
    contactFields: ["phone"],
    consentVersion: 1,
  };
  assert.equal((await call("/v1/applications", body, user.token)).status, 409);
  await db
    .prepare("UPDATE tasks SET status='open' WHERE id='task-supply'")
    .run();
  await db
    .prepare("UPDATE organizations SET verified=0 WHERE id='org-demo'")
    .run();
  assert.equal((await call("/v1/applications", body, user.token)).status, 409);
  await db
    .prepare("UPDATE organizations SET verified=1 WHERE id='org-demo'")
    .run();
});
test("malformed JSON and oversized requests return controlled errors", async () => {
  assert.equal(
    (
      await workerFetch(mf, "/v1/auth/sms", {
        method: "POST",
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await workerFetch(mf, "/v1/auth/sms", {
        method: "POST",
        body: "x".repeat(70000),
      })
    ).status,
    413,
  );
});
test("production refuses mock authentication even if mock flag is accidentally enabled", async () => {
  const prod = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "firelink",
          modules: true,
          scriptPath: ".artifacts/worker.mjs",
          compatibilityDate: "2026-10-06",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "prod-test" },
          r2Buckets: ["FILES"],
          bindings: {
            APP_ENV: "production",
            MOCK_AUTH: "true",
            RP_ID: "",
            PASSKEY_ORIGINS: "",
            APPLE_APP_ID: "",
            ANDROID_SHA256: "",
          },
        },
      ],
    }),
  );
  try {
    assert.equal(
      (
        await workerFetch(prod, "/v1/auth/sms", {
          method: "POST",
          body: JSON.stringify({ phone: "13800000000" }),
        })
      ).status,
      503,
    );
  } finally {
    await prod.dispose();
  }
});

test("task updates move the parent incident to the top of the feed", async () => {
  await db
    .prepare(
      "UPDATE tasks SET updated_at='2026-10-16T00:00:00Z' WHERE id='task-support'",
    )
    .run();
  const list = await call<Incident[]>("/v1/incidents");
  assert.equal(list.data[0].id, "incident-nanjing");
  assert.equal(list.data[0].updatedAt, "2026-10-16T00:00:00Z");
});

test("identity forms validate the name/ID pair without storing the ID; contacts are selectable", async () => {
  const config = (await call<LocalConfig>("/v1/config")).data;
  assert.deepEqual(config.mockIdentity, {
    realName: "林晓",
    idNumber: "000000199806180020",
  });
  const sms = (
    await call<SmsChallenge>("/v1/auth/sms", { phone: "13800000091" })
  ).data;
  const verified = (
    await call<Verification>("/v1/auth/verify", {
      challengeId: sms.challengeId,
      code: sms.mockCode,
    })
  ).data;
  assert.ok("registrationToken" in verified);
  const body = {
    registrationToken: verified.registrationToken,
    consent: true,
    ...config.mockIdentity,
  };
  assert.equal(
    (await call("/v1/auth/register", { ...body, realName: "不匹配" })).status,
    400,
  );
  const created = await call<Session>("/v1/auth/register", body);
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.realName, "林晓");
  assert.equal(
    JSON.stringify(created.data.profile).includes(body.idNumber),
    false,
  );
  assert.equal(
    (
      await call(
        "/v1/me/reverify",
        { ...config.mockIdentity, idNumber: "000000199503120013" },
        created.data.token,
      )
    ).status,
    400,
  );
  const reverified = await call<Profile>(
    "/v1/me/reverify",
    { realName: "周远", idNumber: "000000199503120013" },
    created.data.token,
  );
  assert.equal(reverified.data.gender, "男");
  const task = (await call<Task>("/v1/tasks/task-supply")).data;
  assert.deepEqual(
    task.organizer.contacts.map((c) => c.type),
    ["phone", "wechat", "email"],
  );
  assert.equal(task.organizer.name, "青禾志愿服务中心");
  assert.doesNotMatch(JSON.stringify(task), /演示|模拟|课设/);
});

test("API localizes errors per request and advertises the selected language", async () => {
  await Promise.all(
    [
      ["en-GB", "en", "Please sign in first."],
      ["zh-SG", "zh-Hans", "请先登录"],
      ["zh-TW", "zh-Hant", "請先登入"],
      ["zh-MO", "zh-Hant-HK", "請先登入"],
      ["fr-FR", "en", "Please sign in first."],
    ].map(async ([requested, selected, message]) => {
      const result = await call("/v1/me", null, null, "GET", requested);
      assert.equal(result.status, 401);
      assert.equal(result.data.error, message);
      assert.equal(result.headers.get("Content-Language"), selected);
      assert.equal(result.headers.get("Vary"), "Accept-Language");
    }),
  );
  const invalid = await call(
    "/v1/auth/sms",
    { phone: "123" },
    null,
    "POST",
    "en",
  );
  assert.equal(invalid.data.error, "Enter a mainland China mobile number.");
  const invalidType = await call(
    "/v1/auth/sms",
    { phone: 123 },
    null,
    "POST",
    "zh-HK",
  );
  assert.equal(invalidType.data.error, "輸入不正確");
  const passkey = await call(
    "/v1/auth/passkeys/options",
    {},
    null,
    "POST",
    "zh-TW",
  );
  assert.equal(passkey.data.error, "通行金鑰尚未設定關聯網域");
  const missing = await call("/v1/missing", null, null, "GET", "en");
  assert.equal(missing.data.error, "Content not found.");
});

test("stored result notifications follow the requesting language without rewriting data", async () => {
  const user = await account("13800000019");
  await call(
    "/v1/me",
    { ...user.profile, region: "Hangzhou" },
    user.token,
    "PATCH",
  );
  const result = await call<CreatedApplication>(
    "/v1/applications",
    {
      taskId: "task-supply",
      fields: ["realName", "region"],
      contactFields: ["phone"],
      consentVersion: 1,
    },
    user.token,
  );
  assert.equal(result.status, 201);
  await db
    .prepare(
      "UPDATE applications SET status='rejected',updated_at=? WHERE id=?",
    )
    .bind(new Date().toISOString(), result.data.id)
    .run();
  const english = await call<Notification[]>(
    "/v1/notifications",
    null,
    user.token,
    "GET",
    "en-US",
  );
  const traditional = await call<Notification[]>(
    "/v1/notifications",
    null,
    user.token,
    "GET",
    "zh-TW",
  );
  assert.equal(english.data[0].title, "Application not accepted");
  assert.equal(
    english.data[0].body,
    "The organizer has updated your application result.",
  );
  assert.equal(traditional.data[0].title, "報名未通過");
  assert.equal(traditional.data[0].body, "組織者已更新你的申請結果");
  assert.equal(english.data[0].id, traditional.data[0].id);
  const stored = await db
    .prepare("SELECT title,body FROM notifications WHERE id=?")
    .bind(english.data[0].id)
    .first();
  assert.ok(stored);
  assert.equal(stored.title, "报名未通过");
  assert.equal(stored.body, "组织者已更新你的申请结果");
});
