import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { hash, randomToken, timestamp } from "./domain";
import type { Membership, Role, Session } from "../../shared/organizer";

export type Account = { id: string; email: string; name: string };
export type MemberRow = {
  id: string;
  organization_id: string;
  account_id: string;
  role: Role;
  can_view_contacts: number;
  active: number;
  organization_name: string;
};
export type OrganizerEnv = {
  Bindings: Env;
  Variables: { account: Account; member: MemberRow; taskIds: string[] };
};
export type OrgContext = Context<OrganizerEnv>;
export function deny(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
export async function readJSON(c: OrgContext): Promise<unknown> {
  if (!c.req.header("Content-Type")?.startsWith("application/json"))
    deny(400, "请使用 JSON 提交资料。");
  const reader = c.req.raw.body?.getReader();
  if (!reader) deny(400, "请填写提交内容。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      deny(413, "内容过长，请精简后重试。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return deny(400, "提交内容格式不正确。");
  }
}
export async function passwordHash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sameHash(left: string, right: string) {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
export async function rateLimit(c: OrgContext, scope: string, limit = 20) {
  const now = Date.now();
  const key = await hash(
    `${scope}:${c.req.header("CF-Connecting-IP") ?? "local"}`,
  );
  const row = await c.env.DB.prepare(
    "INSERT INTO organizer_rate_limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN expires_at<? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<? THEN ? ELSE expires_at END RETURNING hits",
  )
    .bind(key, now + 3600000, now, now, now + 3600000)
    .first<{ hits: number }>();
  if (row && row.hits > limit) deny(429, "尝试次数较多，请稍后再试。");
}
export async function issueOrganizerSession(c: OrgContext, accountId: string) {
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO organizer_sessions VALUES (?,?,?)")
    .bind(await hash(token), accountId, Date.now() + 7 * 86400000)
    .run();
  setCookie(c, "fl_organizer", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export async function sessionAccount(c: OrgContext) {
  const token = getCookie(c, "fl_organizer");
  if (!token) return null;
  return c.env.DB.prepare(
    "SELECT a.id,a.email,a.name FROM organizer_sessions s JOIN organizer_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await hash(token), Date.now())
    .first<Account>();
}
export async function membershipDTO(
  db: D1Database,
  row: MemberRow,
): Promise<Membership> {
  const tasks = await db
    .prepare("SELECT task_id FROM member_tasks WHERE member_id=?")
    .bind(row.id)
    .all<{ task_id: string }>();
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.role,
    canViewContacts: row.role === "admin" || !!row.can_view_contacts,
    taskIds: tasks.results.map((t) => t.task_id),
  };
}
export function taskScope(c: OrgContext, column = "t.id") {
  if (c.get("member").role === "admin")
    return { sql: "1=1", values: [] as string[] };
  return {
    sql: `${column} IN (SELECT task_id FROM member_tasks WHERE member_id=?)`,
    values: [c.get("member").id],
  };
}
export function requireRole(c: OrgContext, ...roles: Role[]) {
  if (!roles.includes(c.get("member").role))
    deny(403, "你的角色没有此操作权限，请联系组织管理员。");
}
export const authRoutes = new Hono<OrganizerEnv>();
authRoutes.get("/config", (c) =>
  c.json({
    demo: c.env.ORGANIZER_DEMO === "true" && c.env.APP_ENV !== "production",
  }),
);
authRoutes.post("/login", async (c) => {
  await rateLimit(c, "login");
  const input = z
    .object({
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      password: z.string().min(1).max(200),
    })
    .parse(await readJSON(c));
  const row = await c.env.DB.prepare(
    "SELECT * FROM organizer_accounts WHERE email=?",
  )
    .bind(input.email)
    .first<Account & { password_salt: string; password_hash: string }>();
  const calculated = await passwordHash(
    input.password,
    row?.password_salt ?? "firelink-unavailable-account",
  );
  if (!row || !sameHash(calculated, row.password_hash))
    deny(401, "邮箱或密码不正确。");
  await issueOrganizerSession(c, row.id);
  return c.json({ ok: true });
});
authRoutes.post("/join", async (c) => {
  await rateLimit(c, "join");
  const input = z
    .object({
      token: z.string().min(32).max(200),
      name: z.string().trim().min(1).max(60),
      password: z.string().min(12, "密码至少需要 12 个字符。").max(200),
    })
    .parse(await readJSON(c));
  const key = await hash(input.token);
  const invitation = await c.env.DB.prepare(
    "SELECT i.* FROM organizer_invitations i JOIN organizations o ON o.id=i.organization_id WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND (o.demo_expires_at IS NULL OR o.demo_expires_at>?)",
  )
    .bind(key, Date.now(), Date.now())
    .first<{
      organization_id: string;
      email: string;
      role: Role;
      can_view_contacts: number;
      task_ids: string;
    }>();
  if (!invitation) deny(400, "邀请已失效或已被使用，请联系管理员重新邀请。");
  const existing = await c.env.DB.prepare(
    "SELECT * FROM organizer_accounts WHERE email=?",
  )
    .bind(invitation.email)
    .first<Account & { password_salt: string; password_hash: string }>();
  if (
    existing &&
    !sameHash(
      await passwordHash(input.password, existing.password_salt),
      existing.password_hash,
    )
  )
    deny(401, "此邮箱已有账号，请填写该账号的密码。");
  const accountId = existing?.id ?? crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const salt = randomToken();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      "UPDATE organizer_invitations SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
    ).bind(timestamp(), key, Date.now()),
  ];
  // A transaction-local guard makes concurrent invitation redemption roll back.
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO organizer_rate_limits(id,hits,expires_at) SELECT ?,-1,0 WHERE changes()=0",
    ).bind(`invitation-guard:${key}`),
  );
  if (!existing)
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO organizer_accounts VALUES (?,?,?,?,?,?)",
      ).bind(
        accountId,
        invitation.email,
        input.name,
        salt,
        await passwordHash(input.password, salt),
        timestamp(),
      ),
    );
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO organization_members VALUES (?,?,?,?,?,1) ON CONFLICT(organization_id,account_id) DO UPDATE SET role=excluded.role,can_view_contacts=excluded.can_view_contacts,active=1",
    ).bind(
      memberId,
      invitation.organization_id,
      accountId,
      invitation.role,
      invitation.can_view_contacts,
    ),
  );
  statements.push(
    c.env.DB.prepare(
      "DELETE FROM member_tasks WHERE member_id=(SELECT id FROM organization_members WHERE organization_id=? AND account_id=?)",
    ).bind(invitation.organization_id, accountId),
  );
  for (const taskId of JSON.parse(invitation.task_ids) as string[])
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO member_tasks SELECT id,? FROM organization_members WHERE organization_id=? AND account_id=?",
      ).bind(taskId, invitation.organization_id, accountId),
    );
  await c.env.DB.batch(statements);
  await issueOrganizerSession(c, accountId);
  return c.json({ ok: true });
});
authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, "fl_organizer");
  if (token)
    await c.env.DB.prepare("DELETE FROM organizer_sessions WHERE token_hash=?")
      .bind(await hash(token))
      .run();
  deleteCookie(c, "fl_organizer", { path: "/" });
  return c.json({ ok: true });
});
authRoutes.get("/session", async (c) => {
  const account = await sessionAccount(c);
  if (!account) deny(401, "请先登录组织者账号。");
  const rows = await c.env.DB.prepare(
    "SELECT m.*,o.name AS organization_name FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.account_id=? AND m.active=1 AND (o.demo_expires_at IS NULL OR o.demo_expires_at>?)",
  )
    .bind(account.id, Date.now())
    .all<MemberRow>();
  const result: Session = {
    account,
    memberships: await Promise.all(
      rows.results.map((row) => membershipDTO(c.env.DB, row)),
    ),
  };
  return c.json(result);
});
