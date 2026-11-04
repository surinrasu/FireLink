import fixture from "../../fixtures/demo.json" with { type: "json" };
import type { ApplicationStatus } from "./types.ts";
import { NOW, TOKEN, SCENES } from "./scenes.ts";
import { profileSchema, type Profile } from "../../server/src/domain.ts";
import messages from "../../server/src/messages.json" with { type: "json" };
const profile: Profile = {
  id: "volunteer-demo",
  username: "林小满",
  pronouns: "她",
  realName: "林小满",
  birthDate: "1998-05-20",
  gender: "女",
  verified: true,
  region: "浙江省 杭州市 西湖区",
  body: "可参与半天志愿服务",
  equipment: [],
  equipmentDetails: {},
  equipmentDescription: "急救包 1 套、绷带 10 卷；手套 2 双、雨衣 1 件",
  vehicles: { sedan: 1 },
  contacts: {
    phone: "13800000000",
    wechat: "xiaoman_demo",
    email: "xiaoman@example.com",
  },
};
function application(
  status: ApplicationStatus = "pending",
  contactFields = ["phone"],
) {
  return {
    id: "application-supply",
    taskId: "task-supply",
    taskTitle: "安置点物资整理",
    organizerName: "青禾志愿服务中心",
    status,
    contactFields,
    contactsReleased: status === "accepted",
    createdAt: "2026-10-15T08:45:00Z",
    updatedAt: NOW,
    response:
      status === "accepted"
        ? "欢迎加入！请于明天 09:00 到安置点报到，具体安排将电话确认。"
        : null,
  };
}
export function createState(id = "welcome") {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error("未知演示场景");
  return {
    scene: id,
    authenticated: true,
    ...structuredClone(fixture),
    profile: structuredClone(profile),
    applications: scene.status ? [application(scene.status)] : [],
    credentials: [
      {
        id: "credential-first-aid",
        title: "急救培训证明",
        filename: "急救培训证明.pdf",
        status: "uploaded",
        createdAt: "2026-10-10T08:00:00Z",
      },
    ],
    notifications: scene.notices
      ? [
          {
            id: "notice-accepted",
            title: "报名已通过",
            body: "安置点物资整理：欢迎加入，请查看组织者的回应。",
            applicationId: "application-supply",
            createdAt: NOW,
            readAt: null as string | null,
          },
          {
            id: "notice-guide",
            title: "出发前的小提醒",
            body: "确认集合地点，带好饮水，按约定时间到达。",
            applicationId: null,
            createdAt: "2026-10-15T08:00:00Z",
            readAt: "2026-10-15T08:15:00Z",
          },
        ]
      : [],
  };
}
export type DemoState = ReturnType<typeof createState>;
const ok = <T>(body: T) => ({ status: 200, body });
const fail = (status: number, error: string) => ({ status, body: { error } });
/** Deliberately self-contained: no HTTP client, database binding, or upstream fallback. */
export function api(
  state: DemoState,
  method: string,
  path: string,
  body: Record<string, unknown> = {},
  token = "",
) {
  if (method === "GET" && path === "/v1/config")
    return ok({
      mockAuth: true,
      passkeys: false,
      region: "中国",
      consentVersion: 1,
    });
  if (method === "GET" && path === "/v1/incidents")
    return ok(
      state.incidents.map((i) => ({
        ...i,
        tasks: state.tasks.filter((t) => t.incidentId === i.id),
      })),
    );
  if (method === "GET" && path === "/v1/articles") return ok(state.articles);
  if (method === "GET" && path.startsWith("/v1/tasks/")) {
    const task = state.tasks.find(
      (t) => t.id === path.slice("/v1/tasks/".length),
    );
    return task
      ? ok({
          ...task,
          organizer: state.organizations.find((o) => o.id === task.organizerId),
        })
      : fail(404, "任务不存在");
  }
  if (method === "POST" && path === "/v1/auth/sms")
    return ok({
      challengeId: "demo-sms",
      mockCode: "123456",
      message: "本地演示验证码：123456",
    });
  if (method === "POST" && path === "/v1/auth/verify") {
    if (body.challengeId !== "demo-sms" || body.code !== "123456")
      return fail(400, "请输入演示验证码 123456");
    state.authenticated = true;
    return ok({ token: TOKEN, profile: state.profile });
  }
  if (token !== `Bearer ${TOKEN}` || !state.authenticated)
    return fail(401, "请登录演示账号");
  if (method === "GET" && path === "/v1/me") return ok(state.profile);
  if (method === "GET" && path === "/v1/credentials")
    return ok(state.credentials);
  if (method === "GET" && path === "/v1/me/passkeys") return ok([]);
  if (method === "GET" && path === "/v1/applications")
    return ok(state.applications);
  if (method === "GET" && path === "/v1/notifications")
    return ok(state.notifications);
  if (method === "PATCH" && path === "/v1/me") {
    const result = profileSchema.safeParse({ ...state.profile, ...body });
    if (!result.success)
      return fail(
        400,
        [
          ...new Set(
            result.error.issues.map(
              ({ message }) =>
                (Object.hasOwn(messages, message)
                  ? messages[message as keyof typeof messages]
                  : messages.invalid_input)["zh-Hans"],
            ),
          ),
        ].join("\n"),
      );
    state.profile = { ...state.profile, ...result.data };
    return ok(state.profile);
  }
  if (method === "POST" && path === "/v1/applications") {
    const { fields, contactFields } = body;
    const task = state.tasks.find((t) => t.id === body.taskId);
    if (
      !task ||
      body.consentVersion !== 1 ||
      !Array.isArray(fields) ||
      !Array.isArray(contactFields) ||
      !task.requiredFields.every((f) => fields.includes(f)) ||
      !task.contactFields.every((f) => contactFields.includes(f))
    )
      return fail(400, "请完成必需资料与联系授权");
    if (state.applications.some((a) => a.taskId === task.id))
      return fail(409, "已经报名过此任务");
    const item = {
      ...application(
        "pending",
        contactFields.filter(
          (f): f is string =>
            typeof f === "string" && ["phone", "wechat", "email"].includes(f),
        ),
      ),
      id: `application-${task.id}`,
      taskId: task.id,
      taskTitle: task.title,
    };
    state.applications.unshift(item);
    return { status: 201, body: item };
  }
  const withdrawal = path.match(/^\/v1\/applications\/([^/]+)\/withdraw$/);
  if (method === "POST" && withdrawal) {
    const item = state.applications.find((a) => a.id === withdrawal[1]);
    if (!item) return fail(404, "申请不存在");
    if (item.status !== "pending") return fail(409, "只能撤回待审核的申请");
    Object.assign(item, {
      status: "withdrawn",
      contactsReleased: false,
      updatedAt: NOW,
    });
    return ok(item);
  }
  const read = path.match(/^\/v1\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && read) {
    const item = state.notifications.find((n) => n.id === read[1]);
    if (!item) return fail(404, "通知不存在");
    item.readAt ??= NOW;
    return ok(item);
  }
  if (method === "POST" && path === "/v1/me/logout") {
    state.authenticated = false;
    return ok({ ok: true });
  }
  return fail(404, "本地演示未提供此操作");
}
