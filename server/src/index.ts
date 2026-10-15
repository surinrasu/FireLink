import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import {
  age,
  applySchema,
  asJSON,
  hash,
  identities,
  identityExamples,
  identityInput,
  matchIdentity,
  phoneSchema,
  profileSchema,
  equipmentText,
  randomToken,
  timestamp,
  type Profile,
} from "./domain";
import { passkeyRoutes } from "./passkeys";
import {
  resolveLanguage,
  translate,
  errorMessage,
  fieldError,
  notificationText,
  type Language,
  type MessageKey,
} from "./localization";

export type App = {
  Bindings: Env;
  Variables: { user: Profile; sessionHash: string; language: Language };
};
const app = new Hono<App>();
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
  message: MessageKey,
): never {
  throw new HTTPException(status, { message });
}
export { fail };
export async function boundedJSON(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) fail(400, "empty_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      fail(413, "request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, "invalid_json");
  }
}
app.use("*", async (c, next) => {
  const language = resolveLanguage(c.req.header("Accept-Language"));
  c.set("language", language);
  c.header("Content-Language", language);
  c.header("Vary", "Accept-Language");
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});
app.onError((e, c) => {
  if (e instanceof ZodError)
    return c.json(
      {
        error: [
          ...new Set(
            e.issues.map((issue) =>
              errorMessage(c.get("language"), issue.message),
            ),
          ),
        ].join("\n"),
      },
      400,
    );
  if (e instanceof HTTPException)
    return c.json(
      { error: errorMessage(c.get("language"), e.message) },
      e.status,
    );
  console.error(
    JSON.stringify({ event: "request_failed", path: c.req.path, kind: e.name }),
  );
  return c.json(
    { error: translate(c.get("language"), "service_unavailable") },
    500,
  );
});
app.notFound((c) =>
  c.json({ error: translate(c.get("language"), "not_found") }, 404),
);
app.use("/v1/*", async (c, next) => {
  const length = Number(c.req.header("Content-Length") ?? 0);
  if (length > 8 * 1024 * 1024) fail(413, "attachment_too_large");
  if (!c.req.path.startsWith("/v1/credentials") && length > 65536)
    fail(413, "request_too_large");
  await next();
});
app.get("/v1/config", (c) =>
  c.json({
    mockAuth: c.env.MOCK_AUTH === "true" && c.env.APP_ENV !== "production",
    passkeys: !!c.env.RP_ID && c.env.RP_ID !== "localhost",
    region: "CN",
    consentVersion: 1,
    ...(c.env.MOCK_AUTH === "true" && c.env.APP_ENV !== "production"
      ? { mockIdentity: identityExamples.lin }
      : {}),
  }),
);
app.get("/health", (c) =>
  c.json({ ok: true, service: "FireLink", environment: c.env.APP_ENV }),
);

export async function issueSession(env: Env, user: Profile) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions VALUES (?, ?, ?)")
    .bind(await hash(token), user.id, Date.now() + 30 * 86400000)
    .run();
  return { token, profile: user };
}
const mockOnly = (env: Env) => {
  if (env.APP_ENV === "production" || env.MOCK_AUTH !== "true")
    fail(503, "identity_unavailable");
};
app.post("/v1/auth/sms", async (c) => {
  mockOnly(c.env);
  const { phone } = z
    .object({ phone: phoneSchema })
    .parse(await boundedJSON(c.req.raw));
  const active = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM challenges WHERE kind = ? AND subject = ? AND expires_at > ?",
  )
    .bind("sms", phone, Date.now())
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= 5)
    return c.json(
      { error: translate(c.get("language"), "too_many_requests") },
      429,
    );
  const id = randomToken(),
    code = String(
      100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
    );
  await c.env.DB.prepare("INSERT INTO challenges VALUES (?, ?, ?, ?, ?)")
    .bind(id, "sms", phone, await hash(code), Date.now() + 300000)
    .run();
  return c.json({
    challengeId: id,
    mockCode: code,
    message: translate(c.get("language"), "code_sent"),
  });
});
app.post("/v1/auth/verify", async (c) => {
  mockOnly(c.env);
  const { challengeId, code } = z
    .object({ challengeId: z.string(), code: z.string().regex(/^\d{6}$/) })
    .parse(await boundedJSON(c.req.raw));
  const row = await c.env.DB.prepare(
    "DELETE FROM challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING subject, payload",
  )
    .bind(challengeId, "sms", Date.now())
    .first<{ subject: string; payload: string }>();
  if (!row || row.payload !== (await hash(code))) fail(400, "invalid_code");
  const existing = await c.env.DB.prepare(
    "SELECT profile FROM users WHERE phone = ?",
  )
    .bind(row.subject)
    .first<{ profile: string }>();
  if (existing)
    return c.json(await issueSession(c.env, asJSON<Profile>(existing.profile)));
  const registrationToken = randomToken();
  await c.env.DB.prepare("INSERT INTO challenges VALUES (?, ?, ?, ?, ?)")
    .bind(registrationToken, "register", row.subject, "", Date.now() + 600000)
    .run();
  return c.json({ registrationToken, needsRegistration: true });
});
app.post("/v1/auth/register", async (c) => {
  mockOnly(c.env);
  const input = identityInput
    .extend({
      registrationToken: z.string(),
      consent: z.literal(true),
    })
    .parse(await boundedJSON(c.req.raw));
  const identity = matchIdentity(input);
  if (!identity) fail(400, "identity_mismatch");
  const { registrationToken } = input;
  const row = await c.env.DB.prepare(
    "DELETE FROM challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING subject",
  )
    .bind(registrationToken, "register", Date.now())
    .first<{ subject: string }>();
  if (!row) fail(400, "registration_expired");
  const p: Profile = {
    id: crypto.randomUUID(),
    username: translate(c.get("language"), "new_volunteer"),
    pronouns: "",
    ...identities[identity],
    verified: true,
    region: "",
    body: "",
    equipment: [],
    equipmentDetails: {},
    equipmentDescription: "",
    vehicles: {},
    contacts: { phone: row.subject, wechat: "", email: "" },
  };
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?)",
  )
    .bind(p.id, row.subject, JSON.stringify(p), timestamp())
    .run();
  if (!inserted.meta.changes) fail(409, "phone_registered");
  return c.json(await issueSession(c.env, p), 201);
});

app.get("/v1/incidents", async (c) => {
  const incidents = (
    await c.env.DB.prepare(
      "SELECT id,title,region,latitude,longitude,status,updated_at AS updatedAt FROM incidents ORDER BY updated_at DESC,id",
    ).all()
  ).results;
  const tasks = (
    await c.env.DB.prepare(
      "SELECT id,incident_id AS incidentId,title,summary,status,updated_at AS updatedAt FROM tasks ORDER BY updated_at DESC,id",
    ).all()
  ).results;
  return c.json(
    incidents.map((i) => ({
      ...i,
      tasks: tasks.filter((t) => t.incidentId === i.id),
    })),
  );
});
app.get("/v1/tasks/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT t.*,o.name AS organizer_name,o.verified,o.contact,o.contact_methods FROM tasks t JOIN organizations o ON o.id=t.organizer_id WHERE t.id=?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!row) fail(404, "task_not_found");
  return c.json({
    id: row.id,
    incidentId: row.incident_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    updatedAt: row.updated_at,
    organizer: {
      id: row.organizer_id,
      name: row.organizer_name,
      verified: !!row.verified,
      contacts: asJSON(row.contact_methods),
    },
    blocks: asJSON(row.blocks),
    requiredFields: asJSON(row.required_fields),
    contactFields: asJSON(row.contact_fields),
  });
});
app.get("/v1/articles", async (c) =>
  c.json(
    (
      await c.env.DB.prepare("SELECT * FROM articles ORDER BY id").all()
    ).results.map((a) => ({ ...a, blocks: asJSON(a.blocks) })),
  ),
);

app.use("/v1/me/*", authorize);
app.use("/v1/me", authorize);
app.use("/v1/applications/*", authorize);
app.use("/v1/applications", authorize);
app.use("/v1/credentials/*", authorize);
app.use("/v1/credentials", authorize);
app.use("/v1/notifications/*", authorize);
app.use("/v1/notifications", authorize);
export async function authorize(c: Context<App>, next: () => Promise<void>) {
  const token = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!token) fail(401, "sign_in_required");
  const key = await hash(token);
  const row = await c.env.DB.prepare(
    "SELECT u.profile FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?",
  )
    .bind(key, Date.now())
    .first<{ profile: string }>();
  if (!row) fail(401, "session_expired");
  c.set("user", asJSON<Profile>(row.profile));
  c.set("sessionHash", key);
  await next();
}
app.get("/v1/me", (c) => c.json(c.get("user")));
app.patch("/v1/me", async (c) => {
  const update = profileSchema.parse(await boundedJSON(c.req.raw));
  const p = { ...c.get("user"), ...update };
  await c.env.DB.prepare("UPDATE users SET profile=? WHERE id=?")
    .bind(JSON.stringify(p), p.id)
    .run();
  return c.json(p);
});
app.post("/v1/me/reverify", async (c) => {
  mockOnly(c.env);
  const input = identityInput.parse(await boundedJSON(c.req.raw));
  const identity = matchIdentity(input);
  if (!identity) fail(400, "identity_mismatch");
  const p = { ...c.get("user"), ...identities[identity] };
  await c.env.DB.prepare("UPDATE users SET profile=? WHERE id=?")
    .bind(JSON.stringify(p), p.id)
    .run();
  return c.json(p);
});
app.post("/v1/me/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
    .bind(c.get("sessionHash"))
    .run();
  return c.json({ ok: true });
});
app.get("/v1/credentials", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,title,filename,status,created_at AS createdAt FROM credentials WHERE user_id=? ORDER BY created_at DESC",
      )
        .bind(c.get("user").id)
        .all()
    ).results,
  ),
);
app.post("/v1/credentials", async (c) => {
  const mime = z
    .enum(["image/jpeg", "image/png", "application/pdf"])
    .parse(c.req.header("Content-Type"));
  const title = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(decodeURIComponent(c.req.header("X-Certificate-Title") ?? ""));
  const filename = z
    .string()
    .min(1)
    .max(160)
    .parse(decodeURIComponent(c.req.header("X-File-Name") ?? "certificate"));
  const reader = c.req.raw.body?.getReader();
  if (!reader) fail(400, "attachment_required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      fail(413, "attachment_too_large");
    }
    chunks.push(value);
  }
  if (!size) fail(400, "empty_file");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const valid =
    mime === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : mime === "image/png"
        ? bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) fail(400, "file_type_mismatch");
  const id = crypto.randomUUID(),
    key = `credentials/${c.get("user").id}/${id}`,
    createdAt = timestamp();
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await c.env.DB.prepare(
      "INSERT INTO credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        c.get("user").id,
        title,
        filename,
        mime,
        key,
        "uploaded",
        createdAt,
      )
      .run();
  } catch (e) {
    await c.env.FILES.delete(key);
    throw e;
  }
  return c.json({ id, title, filename, status: "uploaded", createdAt }, 201);
});
app.get("/v1/credentials/:id/file", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key,mime FROM credentials WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), c.get("user").id)
    .first<{ object_key: string; mime: string }>();
  if (!row) fail(404, "attachment_not_found");
  const file = await c.env.FILES.get(row.object_key);
  if (!file) fail(404, "attachment_not_found");
  return new Response(file.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": "attachment",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
app.post("/v1/applications", async (c) => {
  const { taskId, ...choice } = applySchema
    .extend({ taskId: z.string() })
    .parse(await boundedJSON(c.req.raw));
  const row = await c.env.DB.prepare(
    "SELECT t.*,o.verified FROM tasks t JOIN organizations o ON o.id=t.organizer_id WHERE t.id=?",
  )
    .bind(taskId)
    .first();
  if (!row) fail(404, "task_not_found");
  if (row.status !== "open" || !row.verified) fail(409, "applications_closed");
  const required = asJSON<string[]>(row.required_fields),
    contacts = asJSON<string[]>(row.contact_fields);
  const missingConsent = [
    ...required.filter(
      (f) => !choice.fields.includes(f as (typeof choice.fields)[number]),
    ),
    ...contacts.filter(
      (f) =>
        !choice.contactFields.includes(
          f as (typeof choice.contactFields)[number],
        ),
    ),
  ];
  if (missingConsent.length)
    return c.json(
      {
        error: fieldError(c.get("language"), "missing_consent", missingConsent),
      },
      400,
    );
  const p = c.get("user");
  const skills = (
    await c.env.DB.prepare(
      "SELECT id,title,status FROM credentials WHERE user_id=?",
    )
      .bind(p.id)
      .all()
  ).results;
  const all: Record<string, unknown> = {
    ...p,
    equipment: equipmentText(p),
    vehicles: p.vehicles ?? {},
    age: age(p.birthDate),
    skills,
  };
  const missingProfile = required.filter((f) => {
    const value = all[f];
    if (f === "vehicles")
      return !Object.values(p.vehicles ?? {}).some(
        (count) => count != null && count > 0,
      );
    return (
      value == null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.length)
    );
  });
  const missingContacts = choice.contactFields.filter((f) => !p.contacts[f]);
  if (missingProfile.length || missingContacts.length) {
    const errors = [];
    if (missingProfile.length)
      errors.push(
        fieldError(c.get("language"), "incomplete_profile", missingProfile),
      );
    if (missingContacts.length)
      errors.push(
        fieldError(c.get("language"), "incomplete_contacts", missingContacts),
      );
    return c.json({ error: errors.join("\n") }, 400);
  }
  const profileSnapshot: Record<string, unknown> = {},
    contactSnapshot: Record<string, string> = {};
  for (const f of choice.fields) {
    const v = all[f];
    profileSnapshot[f] = v;
  }
  for (const f of choice.contactFields) {
    contactSnapshot[f] = p.contacts[f];
  }
  const id = crypto.randomUUID(),
    now = timestamp();
  const result = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO applications SELECT ?, ?, ?, 'pending', ?, ?, 1, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM tasks WHERE id=? AND status='open')",
  )
    .bind(
      id,
      p.id,
      taskId,
      JSON.stringify(profileSnapshot),
      JSON.stringify(contactSnapshot),
      now,
      now,
      taskId,
    )
    .run();
  if (!result.meta.changes) fail(409, "already_applied");
  return c.json({ id, status: "pending" }, 201);
});
app.get("/v1/applications", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT a.*,t.title AS task_title,o.name AS organizer_name FROM applications a JOIN tasks t ON t.id=a.task_id JOIN organizations o ON o.id=t.organizer_id WHERE a.user_id=? ORDER BY a.created_at DESC",
    )
      .bind(c.get("user").id)
      .all()
  ).results;
  return c.json(
    rows.map((a) => ({
      id: a.id,
      taskId: a.task_id,
      taskTitle: a.task_title,
      organizerName: a.organizer_name,
      status: a.status,
      profileSnapshot: asJSON(a.profile_snapshot),
      contactFields: Object.keys(
        asJSON<Record<string, string>>(a.contact_snapshot),
      ),
      contactsReleased: a.status === "accepted",
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      response: a.response,
    })),
  );
});
app.post("/v1/applications/:id/withdraw", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE applications SET status='withdrawn',updated_at=? WHERE id=? AND user_id=? AND status='pending'",
  )
    .bind(timestamp(), c.req.param("id"), c.get("user").id)
    .run();
  if (!result.meta.changes) fail(409, "withdraw_pending_only");
  return c.json({ ok: true });
});
app.get("/v1/notifications", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT n.id,n.title,n.body,n.application_id AS applicationId,n.created_at AS createdAt,n.read_at AS readAt,a.status AS applicationStatus,a.response AS applicationResponse FROM notifications n LEFT JOIN applications a ON a.id=n.application_id AND a.user_id=n.user_id WHERE n.user_id=? ORDER BY n.created_at DESC",
      )
        .bind(c.get("user").id)
        .all<{
          id: string;
          title: string;
          body: string;
          applicationId: string | null;
          createdAt: string;
          readAt: string | null;
          applicationStatus: string | null;
          applicationResponse: string | null;
        }>()
    ).results.map(({ applicationStatus, applicationResponse, ...notice }) => ({
      ...notice,
      ...notificationText(
        c.get("language"),
        notice,
        applicationStatus,
        applicationResponse,
      ),
    })),
  ),
);
app.post("/v1/notifications/:id/read", async (c) => {
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
  )
    .bind(timestamp(), c.req.param("id"), c.get("user").id)
    .run();
  return c.json({ ok: true });
});
app.route("/", passkeyRoutes);
export default app;
