import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z, ZodError } from "zod";
import { asJSON, hash, randomToken, shareFields, timestamp } from "./domain";
import {
  authRoutes,
  deny,
  membershipDTO,
  readJSON,
  requireRole,
  sessionAccount,
  taskScope,
  type MemberRow,
  type OrgContext,
  type OrganizerEnv,
} from "./organizer-auth";
import { createDemo } from "./organizer-demo";
import { uploadMedia, validateMedia } from "./organizer-media";
import {
  completeMap,
  MAX_MAP_ANNOTATIONS,
  MAX_MAP_POINTS,
} from "../../shared/maps";
import type {
  ContentBlock,
  OrganizerApplication,
  OrganizerTask,
  TaskState,
  Workspace,
} from "../../shared/organizer";

type Row = Record<string, unknown>;
export const organizerAPI = new Hono<OrganizerEnv>();
organizerAPI.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return c.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      },
      400,
    );
  const message =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : "";
  if (message.includes("organizer_capacity_full"))
    return c.json({ error: "名额已满，请先调整招募人数。" }, 409);
  if (message.includes("organizer_last_admin"))
    return c.json({ error: "组织至少需要保留一位管理员。" }, 409);
  if (message.includes("CHECK constraint failed: hits"))
    return c.json(
      { error: "内容已发生变化或邀请已被使用，请刷新后重试。" },
      409,
    );
  console.error(
    JSON.stringify({
      event: "organizer_request_failed",
      path: c.req.path,
      kind: error.name,
    }),
  );
  return c.json({ error: "暂时无法完成操作，请刷新确认结果后重试。" }, 500);
});
organizerAPI.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(c.req.method)) {
    if (c.req.header("X-FireLink-Request") !== "organizer")
      deny(403, "请求来源无效，请重新打开工作台。");
    const origin = c.req.header("Origin");
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      c.req.header("Sec-Fetch-Site") === "cross-site"
    )
      deny(403, "请求来源无效。");
  }
  await next();
});
organizerAPI.route("/auth", authRoutes);
organizerAPI.post("/auth/demo", createDemo);
organizerAPI.use("*", async (c, next) => {
  const account = await sessionAccount(c);
  if (!account) deny(401, "登录已过期，请重新登录。");
  c.set("account", account);
  const orgId = c.req.header("X-Organization-Id");
  if (!orgId) deny(400, "请先选择组织。");
  const member = await c.env.DB.prepare(
    "SELECT m.*,o.name AS organization_name FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.account_id=? AND m.organization_id=? AND m.active=1 AND (o.demo_expires_at IS NULL OR o.demo_expires_at>?)",
  )
    .bind(account.id, orgId, Date.now())
    .first<MemberRow>();
  if (!member) deny(403, "你已没有该组织的访问权限，或演示已到期。");
  c.set("member", member);
  const assigned = await c.env.DB.prepare(
    "SELECT task_id FROM member_tasks WHERE member_id=?",
  )
    .bind(member.id)
    .all<{ task_id: string }>();
  c.set(
    "taskIds",
    assigned.results.map((r) => r.task_id),
  );
  await next();
});

organizerAPI.post("/media", uploadMedia);

function audit(
  c: OrgContext,
  action: string,
  subject: string,
  taskId: string | null = null,
  conditional = false,
) {
  return c.env.DB.prepare(
    `INSERT INTO organizer_activity SELECT ?,?,?,?,?,?,? ${conditional ? "WHERE changes()>0" : ""}`,
  ).bind(
    crypto.randomUUID(),
    c.get("member").organization_id,
    c.get("account").name,
    action,
    subject,
    taskId,
    timestamp(),
  );
}
const taskSelect = `SELECT t.*,i.title AS incident_title,a.name AS owner_name,
 (SELECT COUNT(*) FROM applications WHERE task_id=t.id AND status='pending') AS pending,
 (SELECT COUNT(*) FROM applications WHERE task_id=t.id AND status='accepted') AS accepted,
 (SELECT COUNT(*) FROM applications WHERE task_id=t.id AND status='rejected') AS rejected,
 (SELECT COUNT(*) FROM applications WHERE task_id=t.id AND status='withdrawn') AS withdrawn
 FROM tasks t JOIN incidents i ON i.id=t.incident_id
 LEFT JOIN organization_members m ON m.id=t.owner_id LEFT JOIN organizer_accounts a ON a.id=m.account_id`;
export function taskState(row: Row): TaskState {
  if (
    row.publication_status === "draft" ||
    row.publication_status === "archived"
  )
    return row.publication_status;
  if (row.paused) return "paused";
  if (
    row.status !== "open" ||
    (row.deadline && String(row.deadline) <= timestamp())
  )
    return "closed";
  return "open";
}
function taskDTO(row: Row): OrganizerTask {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    incidentTitle: String(row.incident_title),
    title: String(row.title),
    summary: String(row.summary),
    state: taskState(row),
    capacity: row.capacity == null ? null : Number(row.capacity),
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    deadline: String(row.deadline),
    location: String(row.location),
    meetingPoint: String(row.meeting_point),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name ?? "未分配"),
    blocks: asJSON(row.blocks),
    requiredFields: asJSON(row.required_fields),
    contactFields: asJSON(row.contact_fields),
    updatedAt: String(row.updated_at),
    version: Number(row.version),
    pending: Number(row.pending),
    accepted: Number(row.accepted),
    rejected: Number(row.rejected),
    withdrawn: Number(row.withdrawn),
  };
}
async function findTask(c: OrgContext, id: string) {
  const scope = taskScope(c);
  const task = await c.env.DB.prepare(
    `${taskSelect} WHERE t.id=? AND t.organizer_id=? AND ${scope.sql}`,
  )
    .bind(id, c.get("member").organization_id, ...scope.values)
    .first();
  if (!task) deny(404, "任务不存在或你没有访问权限。");
  return task;
}
organizerAPI.get("/workspace", async (c) => {
  const member = c.get("member"),
    scope = taskScope(c);
  const [org, taskRows, incidents, activities, members, requests] =
    await Promise.all([
      c.env.DB.prepare("SELECT * FROM organizations WHERE id=?")
        .bind(member.organization_id)
        .first(),
      c.env.DB.prepare(
        `${taskSelect} WHERE t.organizer_id=? AND ${scope.sql} ORDER BY t.updated_at DESC,t.id`,
      )
        .bind(member.organization_id, ...scope.values)
        .all(),
      c.env.DB.prepare(
        "SELECT id,title,region,latitude,longitude,status FROM incidents ORDER BY updated_at DESC",
      ).all<Workspace["incidents"][number]>(),
      c.env.DB.prepare(
        `SELECT id,actor,action,subject,task_id AS taskId,created_at AS createdAt FROM organizer_activity WHERE organization_id=? ${member.role === "admin" ? "" : "AND task_id IN (SELECT task_id FROM member_tasks WHERE member_id=?)"} ORDER BY created_at DESC LIMIT 30`,
      )
        .bind(
          member.organization_id,
          ...(member.role === "admin" ? [] : [member.id]),
        )
        .all<Workspace["activities"][number]>(),
      c.env.DB.prepare(
        "SELECT m.*,a.name,a.email FROM organization_members m JOIN organizer_accounts a ON a.id=m.account_id WHERE m.organization_id=? ORDER BY m.active DESC,a.name",
      )
        .bind(member.organization_id)
        .all<Row>(),
      c.env.DB.prepare(
        `SELECT id,kind,content,status,created_at AS createdAt FROM organizer_requests WHERE organization_id=? ${member.role === "admin" ? "" : "AND kind='incident'"} ORDER BY created_at DESC LIMIT 50`,
      )
        .bind(member.organization_id)
        .all<Workspace["requests"][number]>(),
    ]);
  if (!org) deny(404, "组织不存在。");
  const memberDTOs = await Promise.all(
    members.results.map(async (row) => ({
      id: String(row.id),
      name: String(row.name),
      email: member.role === "admin" ? String(row.email) : "",
      role: row.role as MemberRow["role"],
      canViewContacts: !!row.can_view_contacts || row.role === "admin",
      active: !!row.active,
      taskIds: (
        await c.env.DB.prepare(
          "SELECT task_id FROM member_tasks WHERE member_id=?",
        )
          .bind(row.id)
          .all<{ task_id: string }>()
      ).results.map((t) => t.task_id),
    })),
  );
  const result: Workspace = {
    organization: {
      id: String(org.id),
      name: String(org.name),
      verified: !!org.verified,
      description: String(org.description),
      contacts: asJSON(org.contact_methods),
      verificationStatus: String(org.verification_status),
      demo: org.demo_expires_at != null,
    },
    membership: await membershipDTO(c.env.DB, member),
    tasks: taskRows.results.map(taskDTO),
    incidents: incidents.results,
    activities: activities.results,
    members: memberDTOs,
    requests: requests.results,
  };
  return c.json(result);
});

const date = z
  .union([z.literal(""), z.iso.datetime()])
  .transform((s) => (s ? new Date(s).toISOString() : ""));
const block = z
  .object({
    type: z.enum(["heading", "paragraph", "image", "video", "map", "table"]),
    text: z.string().max(10000).optional(),
    url: z.url().max(2048).optional(),
    rows: z
      .array(z.array(z.string().max(500)).max(12))
      .max(30)
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    annotations: z
      .array(
        z
          .object({
            type: z.enum(["point", "path", "area"]),
            coordinates: z
              .array(
                z.object({
                  latitude: z.number().min(-90).max(90),
                  longitude: z.number().min(-180).max(180),
                }),
              )
              .min(1)
              .max(MAX_MAP_POINTS),
          })
          .refine(
            (mark) => mark.type !== "point" || mark.coordinates.length === 1,
            "每个位置须包含一个点。",
          ),
      )
      .max(MAX_MAP_ANNOTATIONS)
      .optional(),
  })
  .transform((block) => {
    if (block.type !== "map" || block.annotations === undefined) return block;
    const point = block.annotations[0]?.coordinates[0];
    return { ...block, latitude: point?.latitude, longitude: point?.longitude };
  });
const taskInput = z
  .object({
    title: z.string().trim().min(1, "请填写任务标题。").max(100),
    summary: z.string().trim().max(500),
    incidentId: z.string().min(1),
    capacity: z.number().int().min(1).max(10000).nullable(),
    startsAt: date,
    endsAt: date,
    deadline: date,
    location: z.string().trim().max(300),
    meetingPoint: z.string().trim().max(300),
    ownerId: z.string(),
    blocks: z.array(block).max(50),
    requiredFields: z.array(z.enum(shareFields)).max(10),
    contactFields: z
      .array(z.enum(["phone", "wechat", "email"]))
      .min(1)
      .max(3),
    version: z.number().int().optional(),
  })
  .refine(
    (i) => !i.startsAt || !i.endsAt || i.endsAt > i.startsAt,
    "任务结束时间必须晚于任务开始时间。",
  )
  .refine(
    (i) => !i.deadline || !i.endsAt || i.deadline <= i.endsAt,
    "报名截止时间应不晚于任务结束时间。",
  );
function validatePublishedBlocks(blocks: ContentBlock[]) {
  if (
    blocks.some(
      (block) =>
        (block.type === "image" || block.type === "video") && !block.url,
    )
  )
    deny(400, "请上传图片或视频，或删除空的内容块。");
  if (blocks.some((block) => block.type === "map" && !completeMap(block)))
    deny(
      400,
      "请完成地图标注：位置至少 1 个点，路径 2 个不同点，范围 3 个不共线的点；或删除未完成的地图。",
    );
}
async function validateTaskRelations(
  c: OrgContext,
  input: z.infer<typeof taskInput>,
) {
  await validateMedia(c, input.blocks);
  const incident = await c.env.DB.prepare(
    "SELECT id FROM incidents WHERE id=? AND status='active'",
  )
    .bind(input.incidentId)
    .first();
  if (!incident) deny(400, "请选择有效的事件。");
  if (input.ownerId) {
    const member = await c.env.DB.prepare(
      "SELECT id FROM organization_members WHERE id=? AND organization_id=? AND active=1 AND role IN ('admin','manager')",
    )
      .bind(input.ownerId, c.get("member").organization_id)
      .first();
    if (!member) deny(400, "负责人须为本组织的管理员或任务负责人。");
  }
}
organizerAPI.post("/tasks", async (c) => {
  requireRole(c, "admin", "manager");
  const input = taskInput.parse(await readJSON(c));
  await validateTaskRelations(c, input);
  const member = c.get("member"),
    id = crypto.randomUUID();
  const owner = input.ownerId || member.id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO tasks(id,incident_id,organizer_id,title,summary,status,updated_at,blocks,required_fields,contact_fields,publication_status,capacity,starts_at,ends_at,deadline,location,meeting_point,owner_id) VALUES (?,?,?,?,?,'closed',?,?,?,?,'draft',?,?,?,?,?,?,?)",
    ).bind(
      id,
      input.incidentId,
      member.organization_id,
      input.title,
      input.summary,
      timestamp(),
      JSON.stringify(input.blocks),
      JSON.stringify(input.requiredFields),
      JSON.stringify(input.contactFields),
      input.capacity,
      input.startsAt,
      input.endsAt,
      input.deadline,
      input.location,
      input.meetingPoint,
      owner,
    ),
    c.env.DB.prepare("INSERT OR IGNORE INTO member_tasks VALUES (?,?)").bind(
      member.id,
      id,
    ),
    c.env.DB.prepare("INSERT OR IGNORE INTO member_tasks VALUES (?,?)").bind(
      owner,
      id,
    ),
    audit(c, "创建草稿", input.title, id),
  ]);
  return c.json({ id }, 201);
});
organizerAPI.put("/tasks/:id", async (c) => {
  requireRole(c, "admin", "manager");
  const old = await findTask(c, c.req.param("id"));
  if (old.publication_status === "archived")
    deny(409, "已归档的任务不能编辑，请复制为新任务。");
  const input = taskInput.parse(await readJSON(c));
  await validateTaskRelations(c, input);
  if (input.version !== old.version)
    deny(409, "任务已被其他成员更新，请刷新后再编辑。");
  if (old.publication_status === "published")
    validatePublishedBlocks(input.blocks);
  if (input.capacity != null && input.capacity < Number(old.accepted))
    deny(409, "招募人数不能小于已通过人数。");
  const hasApplications =
    Number(old.pending) +
      Number(old.accepted) +
      Number(old.rejected) +
      Number(old.withdrawn) >
    0;
  const sameFields = (a: string[], b: string[]) =>
    JSON.stringify([...new Set(a)].sort()) ===
    JSON.stringify([...new Set(b)].sort());
  const consentChanged =
    !sameFields(input.requiredFields, asJSON(old.required_fields)) ||
    !sameFields(input.contactFields, asJSON(old.contact_fields));
  if (hasApplications && consentChanged)
    deny(409, "已有报名，资料授权要求已锁定。请复制任务设置新的授权要求。");
  if (
    old.publication_status === "published" &&
    (!input.summary || !input.location || !input.startsAt || !input.deadline)
  )
    deny(400, "已发布任务须保留摘要、地点、服务时间和截止时间。");
  const changed =
    input.startsAt !== old.starts_at ||
    input.endsAt !== old.ends_at ||
    input.location !== old.location ||
    input.meetingPoint !== old.meeting_point ||
    input.deadline !== old.deadline;
  const now = timestamp();
  const statements = [
    c.env.DB.prepare(
      "UPDATE tasks SET incident_id=?,title=?,summary=?,blocks=?,required_fields=?,contact_fields=?,capacity=?,starts_at=?,ends_at=?,deadline=?,location=?,meeting_point=?,owner_id=?,updated_at=?,version=version+1 WHERE id=? AND organizer_id=? AND version=? AND (? IS NULL OR (SELECT COUNT(*) FROM applications WHERE task_id=tasks.id AND status='accepted')<=?) AND (?=0 OR NOT EXISTS (SELECT 1 FROM applications WHERE task_id=tasks.id))",
    ).bind(
      input.incidentId,
      input.title,
      input.summary,
      JSON.stringify(input.blocks),
      JSON.stringify(input.requiredFields),
      JSON.stringify(input.contactFields),
      input.capacity,
      input.startsAt,
      input.endsAt,
      input.deadline,
      input.location,
      input.meetingPoint,
      input.ownerId,
      now,
      old.id,
      c.get("member").organization_id,
      input.version,
      input.capacity,
      input.capacity,
      Number(consentChanged),
    ),
    audit(c, "更新任务", input.title, String(old.id)),
  ];
  // Force the entire transaction to fail if a concurrent editor won the version check.
  statements.splice(
    1,
    0,
    c.env.DB.prepare(
      "INSERT INTO organizer_rate_limits SELECT ?,-1,0 WHERE changes()=0",
    ).bind(`task-guard:${old.id}`),
  );
  if (input.ownerId)
    statements.push(
      c.env.DB.prepare("INSERT OR IGNORE INTO member_tasks VALUES (?,?)").bind(
        input.ownerId,
        old.id,
      ),
    );
  if (changed && hasApplications)
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO notifications SELECT lower(hex(randomblob(16))),user_id,'任务信息已更新',?,id,?,NULL FROM applications WHERE task_id=? AND status='pending'",
      ).bind(
        `${input.title}的时间或地点等信息已更新，请重新查看任务详情。`,
        now,
        old.id,
      ),
    );
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
organizerAPI.post("/tasks/:id/state", async (c) => {
  requireRole(c, "admin", "manager");
  const input = z
    .object({
      state: z.enum(["open", "paused", "closed", "archived"]),
      version: z.number().int(),
    })
    .parse(await readJSON(c));
  const row = await findTask(c, c.req.param("id"));
  if (input.version !== row.version) deny(409, "任务已更新，请刷新后再操作。");
  const current = taskState(row);
  const transitions: Record<TaskState, TaskState[]> = {
    draft: ["open"],
    open: ["paused", "closed"],
    paused: ["open", "closed"],
    closed: ["open", "archived"],
    archived: [],
  };
  if (!transitions[current].includes(input.state))
    deny(409, "当前任务状态不支持此操作。");
  if (input.state === "open") {
    validatePublishedBlocks(asJSON<ContentBlock[]>(row.blocks));
    await validateMedia(c, asJSON<ContentBlock[]>(row.blocks));
    const org = await c.env.DB.prepare(
      "SELECT verified,contact_methods FROM organizations WHERE id=?",
    )
      .bind(c.get("member").organization_id)
      .first<{ verified: number; contact_methods: string }>();
    if (!org?.verified) deny(403, "组织认证通过后才能发布招募。");
    if (!asJSON<unknown[]>(org.contact_methods).length)
      deny(400, "请先在组织设置中填写公开联系方式。");
    if (
      !row.summary ||
      !row.location ||
      !row.starts_at ||
      !row.deadline ||
      String(row.deadline) <= timestamp() ||
      !asJSON<string[]>(row.required_fields).length
    )
      deny(400, "请先完善摘要、地点、服务时间、未来的截止时间和报名资料要求。");
  }
  if (input.state === "archived" && Number(row.pending) > 0)
    deny(409, "请处理全部待审核报名后再归档。");
  const labels = {
    open: "开放招募",
    paused: "暂停招募",
    closed: "截止招募",
    archived: "归档任务",
  };
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE tasks SET publication_status=?,paused=?,status=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
    ).bind(
      input.state === "archived" ? "archived" : "published",
      Number(input.state === "paused"),
      input.state === "open" ? "open" : "closed",
      timestamp(),
      row.id,
      input.version,
    ),
    audit(c, labels[input.state], String(row.title), String(row.id), true),
  ]);
  if (!result[0].meta.changes) deny(409, "任务已更新，请刷新后再操作。");
  return c.json({ ok: true });
});

const applicationSelect =
  "SELECT a.*,t.title AS task_title,u.name AS reviewer_name FROM applications a JOIN tasks t ON t.id=a.task_id LEFT JOIN organizer_accounts u ON u.id=a.reviewer_id";
function applicationDTO(row: Row, contacts = false): OrganizerApplication {
  const contactSnapshot = asJSON<Record<string, string>>(row.contact_snapshot);
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    taskTitle: String(row.task_title),
    status: row.status as OrganizerApplication["status"],
    profile: asJSON(row.profile_snapshot),
    contactFields: Object.keys(contactSnapshot),
    contacts: contacts && row.status === "accepted" ? contactSnapshot : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    response: row.response == null ? null : String(row.response),
    note: String(row.internal_note),
    reviewerName: row.reviewer_name == null ? null : String(row.reviewer_name),
  };
}
organizerAPI.get("/applications", async (c) => {
  const scope = taskScope(c);
  const taskId = c.req.query("taskId");
  const page = Math.max(
    1,
    Math.min(100000, Number.parseInt(c.req.query("page") || "1", 10) || 1),
  );
  const status = c.req.query("status") || "all";
  if (!["all", "pending", "accepted", "rejected", "withdrawn"].includes(status))
    deny(400, "报名状态无效。");
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const where = `t.organizer_id=? AND ${scope.sql} ${taskId ? "AND t.id=?" : ""} ${query ? "AND (instr(lower(COALESCE(json_extract(a.profile_snapshot,'$.realName'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(a.profile_snapshot,'$.username'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(a.profile_snapshot,'$.region'),'')),lower(?))>0)" : ""}`;
  const values = [
    c.get("member").organization_id,
    ...scope.values,
    ...(taskId ? [taskId] : []),
    ...(query ? [query, query, query] : []),
  ];
  const [rows, groups] = await Promise.all([
    c.env.DB.prepare(
      `${applicationSelect} WHERE ${where} ${status === "all" ? "" : "AND a.status=?"} ORDER BY a.created_at ASC,a.id LIMIT 50 OFFSET ?`,
    )
      .bind(...values, ...(status === "all" ? [] : [status]), (page - 1) * 50)
      .all(),
    c.env.DB.prepare(
      `SELECT a.status,COUNT(*) AS n FROM applications a JOIN tasks t ON t.id=a.task_id WHERE ${where} GROUP BY a.status`,
    )
      .bind(...values)
      .all<{ status: OrganizerApplication["status"]; n: number }>(),
  ]);
  const counts = { pending: 0, accepted: 0, rejected: 0, withdrawn: 0 };
  for (const group of groups.results) counts[group.status] = group.n;
  const total =
    status === "all"
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : counts[status as keyof typeof counts];
  return c.json({
    items: rows.results.map((row) => applicationDTO(row)),
    total,
    counts,
    page,
    pageSize: 50,
  });
});
organizerAPI.get("/applications/:id", async (c) => {
  const scope = taskScope(c),
    member = c.get("member");
  const row = await c.env.DB.prepare(
    `${applicationSelect} WHERE a.id=? AND t.organizer_id=? AND ${scope.sql}`,
  )
    .bind(c.req.param("id"), member.organization_id, ...scope.values)
    .first();
  if (!row) deny(404, "报名不存在或你没有访问权限。");
  const org = await c.env.DB.prepare(
    "SELECT verified FROM organizations WHERE id=?",
  )
    .bind(member.organization_id)
    .first<{ verified: number }>();
  const contacts =
    !!org?.verified && (member.role === "admin" || !!member.can_view_contacts);
  if (contacts && row.status === "accepted")
    await audit(
      c,
      "查看授权联系方式",
      String(row.task_title),
      String(row.task_id),
    ).run();
  return c.json(applicationDTO(row, contacts));
});
organizerAPI.post("/applications/:id/decision", async (c) => {
  const input = z
    .object({
      status: z.enum(["accepted", "rejected"]),
      response: z.string().trim().min(1, "请填写给志愿者的回应。").max(1000),
      note: z.string().max(2000).default(""),
    })
    .parse(await readJSON(c));
  const scope = taskScope(c),
    member = c.get("member");
  const row = await c.env.DB.prepare(
    `${applicationSelect} WHERE a.id=? AND t.organizer_id=? AND ${scope.sql}`,
  )
    .bind(c.req.param("id"), member.organization_id, ...scope.values)
    .first();
  if (!row) deny(404, "报名不存在或你没有访问权限。");
  const org = await c.env.DB.prepare(
    "SELECT verified,contact_methods FROM organizations WHERE id=?",
  )
    .bind(member.organization_id)
    .first<{ verified: number; contact_methods: string }>();
  if (!org?.verified) deny(403, "组织认证通过后才能处理报名。");
  if (
    input.status === "accepted" &&
    !asJSON<unknown[]>(org.contact_methods).length
  )
    deny(400, "请先在组织设置中填写公开联系方式，再通过报名。");
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE applications SET status=?,response=?,internal_note=?,reviewer_id=?,updated_at=? WHERE id=? AND status='pending'",
    ).bind(
      input.status,
      input.response,
      input.note,
      c.get("account").id,
      timestamp(),
      row.id,
    ),
    audit(
      c,
      input.status === "accepted" ? "通过报名" : "拒绝报名",
      String(row.task_title),
      String(row.task_id),
      true,
    ),
  ]);
  if (!results[0].meta.changes)
    deny(409, "这份报名已被处理或撤回，请刷新查看最新结果。");
  return c.json({ ok: true });
});
organizerAPI.get("/notices", async (c) => {
  const scope = taskScope(c);
  const rows = await c.env.DB.prepare(
    `SELECT n.id,n.title,n.body,t.title AS taskTitle,n.created_at AS createdAt,n.read_at AS readAt FROM notifications n JOIN applications a ON a.id=n.application_id JOIN tasks t ON t.id=a.task_id WHERE t.organizer_id=? AND ${scope.sql} ORDER BY n.created_at DESC LIMIT 200`,
  )
    .bind(c.get("member").organization_id, ...scope.values)
    .all();
  return c.json(rows.results);
});

const contactsInput = z
  .array(
    z.object({
      type: z.enum(["phone", "wechat", "email"]),
      label: z.string().trim().min(1).max(30),
      value: z.string().trim().min(1).max(150),
    }),
  )
  .min(1)
  .max(8);
organizerAPI.put("/organization", async (c) => {
  requireRole(c, "admin");
  const input = z
    .object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(2000),
      contacts: contactsInput,
    })
    .parse(await readJSON(c));
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE organizations SET name=?,description=?,contact_methods=? WHERE id=?",
    ).bind(
      input.name,
      input.description,
      JSON.stringify(input.contacts),
      c.get("member").organization_id,
    ),
    audit(c, "更新组织资料", input.name),
  ]);
  return c.json({ ok: true });
});
organizerAPI.post("/requests", async (c) => {
  const input = z
    .object({
      kind: z.enum(["incident", "verification"]),
      content: z
        .string()
        .trim()
        .min(10, "请提供至少 10 个字的说明。")
        .max(5000),
    })
    .parse(await readJSON(c));
  if (input.kind === "verification") requireRole(c, "admin");
  else requireRole(c, "admin", "manager");
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO organizer_requests VALUES (?,?,?,?,'pending',?)",
    ).bind(
      crypto.randomUUID(),
      c.get("member").organization_id,
      input.kind,
      input.content,
      timestamp(),
    ),
    audit(
      c,
      "提交申请",
      input.kind === "incident" ? "新增事件或信息纠错" : "组织认证",
    ),
  ];
  if (input.kind === "verification")
    statements.push(
      c.env.DB.prepare(
        "UPDATE organizations SET verification_status='pending' WHERE id=? AND verified=0",
      ).bind(c.get("member").organization_id),
    );
  await c.env.DB.batch(statements);
  return c.json({ ok: true }, 201);
});
organizerAPI.get("/requests", async (c) => {
  const member = c.get("member");
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT id,kind,content,status,created_at AS createdAt FROM organizer_requests WHERE organization_id=? ${member.role === "admin" ? "" : "AND kind='incident'"} ORDER BY created_at DESC LIMIT 50`,
      )
        .bind(member.organization_id)
        .all()
    ).results,
  );
});
const permissions = z.object({
  role: z.enum(["admin", "manager", "reviewer"]),
  canViewContacts: z.boolean(),
  taskIds: z.array(z.string()).max(200),
});
async function checkAssignedTasks(c: OrgContext, ids: string[]) {
  if (!ids.length) return;
  const rows = await c.env.DB.prepare(
    `SELECT id FROM tasks WHERE organizer_id=? AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(c.get("member").organization_id, ...ids)
    .all();
  if (rows.results.length !== new Set(ids).size)
    deny(400, "只能分配本组织的任务。");
}
organizerAPI.post("/invitations", async (c) => {
  requireRole(c, "admin");
  const input = permissions
    .extend({
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
    })
    .parse(await readJSON(c));
  await checkAssignedTasks(c, input.taskIds);
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE organizer_invitations SET used_at=? WHERE organization_id=? AND email=? AND used_at IS NULL",
    ).bind(timestamp(), c.get("member").organization_id, input.email),
    c.env.DB.prepare(
      "INSERT INTO organizer_invitations VALUES (?,?,?,?,?,?,?,NULL)",
    ).bind(
      await hash(token),
      c.get("member").organization_id,
      input.email,
      input.role,
      Number(input.canViewContacts),
      JSON.stringify([...new Set(input.taskIds)]),
      Date.now() + 48 * 3600000,
    ),
    audit(c, "创建成员邀请", input.email),
  ]);
  return c.json(
    {
      url: `${new URL(c.req.url).origin}/mng-dash#/join/${token}`,
      expiresInHours: 48,
    },
    201,
  );
});
organizerAPI.put("/members/:id", async (c) => {
  requireRole(c, "admin");
  const input = permissions
    .extend({ active: z.boolean() })
    .parse(await readJSON(c));
  const member = await c.env.DB.prepare(
    "SELECT id FROM organization_members WHERE id=? AND organization_id=?",
  )
    .bind(c.req.param("id"), c.get("member").organization_id)
    .first();
  if (!member) deny(404, "成员不存在。");
  await checkAssignedTasks(c, input.taskIds);
  const statements = [
    c.env.DB.prepare(
      "UPDATE organization_members SET role=?,can_view_contacts=?,active=? WHERE id=?",
    ).bind(
      input.role,
      Number(input.canViewContacts),
      Number(input.active),
      member.id,
    ),
    c.env.DB.prepare("DELETE FROM member_tasks WHERE member_id=?").bind(
      member.id,
    ),
  ];
  for (const id of new Set(input.taskIds))
    statements.push(
      c.env.DB.prepare("INSERT INTO member_tasks VALUES (?,?)").bind(
        member.id,
        id,
      ),
    );
  statements.push(
    c.env.DB.prepare(
      "UPDATE organizer_invitations SET used_at=? WHERE organization_id=? AND email=(SELECT a.email FROM organizer_accounts a JOIN organization_members m ON m.account_id=a.id WHERE m.id=?) AND used_at IS NULL",
    ).bind(timestamp(), c.get("member").organization_id, member.id),
  );
  statements.push(audit(c, "更新成员权限", String(member.id)));
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
