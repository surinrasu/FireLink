import fixture from "../../fixtures/demo.json";
import { randomToken, timestamp } from "./domain";
import {
  deny,
  issueOrganizerSession,
  rateLimit,
  type OrgContext,
} from "./organizer-auth";

/** Every visitor receives an isolated, expiring workspace containing synthetic data. */
export async function createDemo(c: OrgContext) {
  if (c.env.ORGANIZER_DEMO !== "true" || c.env.APP_ENV === "production")
    deny(404, "当前环境未开放演示。");
  await rateLimit(c, "demo", 12);
  const accountId = crypto.randomUUID(),
    orgId = crypto.randomUUID(),
    memberId = crypto.randomUUID();
  const now = timestamp();
  const at = (days: number, hours = 0) =>
    new Date(Date.now() + (days * 24 + hours) * 3600000).toISOString();
  const db = c.env.DB;
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO organizer_accounts VALUES (?,?,?,?,?,?)")
      .bind(
        accountId,
        `${accountId}@demo.invalid`,
        "林知夏",
        randomToken(),
        randomToken(),
        now,
      ),
    db
      .prepare(
        "INSERT INTO organizations(id,name,verified,contact,contact_methods,description,verification_status,demo_expires_at) VALUES (?,?,1,NULL,?,?,'verified',?)",
      )
      .bind(
        orgId,
        "青禾志愿服务中心",
        JSON.stringify(fixture.organizations[0].contacts),
        "连接身边的善意，让每一份力气都有去处。我们关注社区支援、物资整理与运输协助。",
        Date.now() + 86400000,
      ),
    db
      .prepare("INSERT INTO organization_members VALUES (?,?,?,'admin',1,1)")
      .bind(memberId, orgId, accountId),
  ];
  const records = [
    { source: 0, title: "安置点物资整理", state: "open", capacity: 8, days: 3 },
    { source: 1, title: "物资运输协助", state: "open", capacity: 4, days: 4 },
    {
      source: 2,
      title: "临时服务点信息登记",
      state: "open",
      capacity: 6,
      days: 2,
    },
    { source: 0, title: "社区物资打包", state: "draft", capacity: 12, days: 7 },
    {
      source: 2,
      title: "周末社区信息指引",
      state: "paused",
      capacity: 5,
      days: 5,
    },
    {
      source: 0,
      title: "爱心物资清点",
      state: "closed",
      capacity: 6,
      days: -2,
    },
  ];
  const taskIds = records.map(() => crypto.randomUUID());
  for (const [index, record] of records.entries()) {
    const task = fixture.tasks[record.source];
    statements.push(
      db
        .prepare(
          "INSERT INTO tasks(id,incident_id,organizer_id,title,summary,status,updated_at,blocks,required_fields,contact_fields,publication_status,paused,capacity,starts_at,ends_at,deadline,location,meeting_point,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          taskIds[index],
          task.incidentId,
          orgId,
          record.title,
          task.summary,
          record.state === "open" ? "open" : "closed",
          at(0, -index),
          JSON.stringify(task.blocks),
          JSON.stringify(task.requiredFields),
          JSON.stringify(task.contactFields),
          record.state === "draft" ? "draft" : "published",
          Number(record.state === "paused"),
          record.capacity,
          at(record.days),
          at(record.days, 4),
          at(record.days - 1),
          record.source === 2
            ? "南京市鼓楼区社区服务点"
            : "杭州市西湖区社区服务中心",
          "服务中心一楼接待处",
          memberId,
        ),
    );
  }
  const names = [
    "林小满",
    "周远",
    "陈宁",
    "许知秋",
    "沈禾",
    "程安",
    "吴雨",
    "李言",
    "赵晓",
  ];
  // Give each dashboard sort a distinct order while keeping five pending applications.
  const pendingTaskIndices = [1, 0, 1, 2, 2];
  for (const [index, name] of names.entries()) {
    const userId = crypto.randomUUID(),
      applicationId = crypto.randomUUID();
    const taskIndex = pendingTaskIndices[index] ?? index % 3,
      status =
        index < pendingTaskIndices.length
          ? "pending"
          : index < 8
            ? "accepted"
            : "rejected";
    const contacts = {
      phone: `1380000000${index}`,
      wechat: `firelink_demo_${index}`,
    };
    const profile = {
      username: name,
      realName: name,
      region: index % 2 ? "浙江省 杭州市 余杭区" : "浙江省 杭州市 西湖区",
      ...(taskIndex === 1
        ? {
            vehicles: { cargoVan: 1 },
            skills: [{ title: "驾驶资格证明", status: "uploaded" }],
          }
        : {}),
      equipment: index % 2 ? "手套、雨衣，自备饮水" : "可自带登记用笔记本电脑",
    };
    const response =
      status === "accepted"
        ? "报名已通过，感谢你的参与意愿。后续安排请与组织者直接沟通。"
        : status === "rejected"
          ? "感谢你的关注，本次招募名额有限。"
          : null;
    statements.push(
      db
        .prepare("INSERT INTO users VALUES (?,?,?,?)")
        .bind(
          userId,
          `demo:${userId}`,
          JSON.stringify({ id: userId, ...profile, contacts }),
          now,
        ),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO applications(id,user_id,task_id,status,profile_snapshot,contact_snapshot,consent_version,created_at,updated_at,response,reviewer_id) VALUES (?,?,?,?,?,?,1,?,?,?,?)",
        )
        .bind(
          applicationId,
          userId,
          taskIds[taskIndex],
          status,
          JSON.stringify(profile),
          JSON.stringify(
            taskIndex === 2 ? contacts : { phone: contacts.phone },
          ),
          at(0, -index - 1),
          now,
          response,
          status === "pending" ? null : accountId,
        ),
    );
    if (status !== "pending")
      statements.push(
        db
          .prepare("INSERT INTO notifications VALUES (?,?,?,?,?,?,NULL)")
          .bind(
            crypto.randomUUID(),
            userId,
            status === "accepted" ? "报名已通过" : "报名未通过",
            response,
            applicationId,
            now,
          ),
      );
  }
  statements.push(
    db
      .prepare("INSERT INTO organizer_activity VALUES (?,?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        orgId,
        "林知夏",
        "创建工作台",
        "青禾志愿服务中心",
        null,
        now,
      ),
  );
  await db.batch(statements);
  await issueOrganizerSession(c, accountId);
  return c.json({ organizationId: orgId }, 201);
}
