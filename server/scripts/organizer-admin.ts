import { parseArgs } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import { hash, randomToken, timestamp } from "../src/domain";

// Operator-only provisioning through Wrangler credentials, never a public admin API.
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    remote: { type: "boolean", default: false },
    name: { type: "string" },
    email: { type: "string" },
    origin: { type: "string" },
    organization: { type: "string" },
    request: { type: "string" },
    status: { type: "string" },
    region: { type: "string" },
    latitude: { type: "string" },
    longitude: { type: "string" },
  },
});
const command = positionals[0];
const required = (name: keyof typeof values) => {
  const value = values[name];
  if (typeof value !== "string" || !value.trim() || value.length > 1000)
    throw new Error(`缺少或无效参数 --${name}`);
  return value.trim();
};
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
let sql: string;
let invitation = "";
if (command === "bootstrap") {
  const name = required("name"),
    email = required("email").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error("邮箱格式无效。");
  const origin = new URL(required("origin"));
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname)
    )
  )
    throw new Error("远程工作台必须使用 HTTPS。");
  const id = crypto.randomUUID(),
    token = randomToken();
  sql = `INSERT INTO organizations(id,name,verified,contact_methods) VALUES (${quote(id)},${quote(name)},0,'[]');
INSERT INTO organizer_invitations VALUES (${quote(await hash(token))},${quote(id)},${quote(email)},'admin',1,'[]',${Date.now() + 48 * 3600000},NULL);`;
  invitation = `组织 ID：${id}\n首位管理员邀请（48 小时内一次有效）：${origin.origin}/#/join/${token}\n组织初始为未认证，请完成核实后运行 verify。`;
} else if (command === "verify") {
  const id = quote(required("organization"));
  sql = `UPDATE organizations SET verified=1,verification_status='verified' WHERE id=${id} AND demo_expires_at IS NULL;
UPDATE organizer_requests SET status='resolved' WHERE organization_id=${id} AND kind='verification' AND status='pending';
SELECT id,name,verification_status FROM organizations WHERE id=${id};`;
} else if (command === "requests") {
  sql =
    "SELECT r.*,o.name AS organization_name FROM organizer_requests r JOIN organizations o ON o.id=r.organization_id WHERE r.status='pending' AND o.demo_expires_at IS NULL ORDER BY r.created_at;";
} else if (command === "resolve-request") {
  const status = required("status");
  if (!["resolved", "rejected"].includes(status))
    throw new Error("--status 只能是 resolved 或 rejected。");
  sql = `UPDATE organizer_requests SET status=${quote(status)} WHERE id=${quote(required("request"))};
UPDATE organizations SET verification_status='unsubmitted' WHERE verified=0 AND verification_status='pending' AND NOT EXISTS (SELECT 1 FROM organizer_requests WHERE organization_id=organizations.id AND kind='verification' AND status='pending');`;
} else if (command === "incident") {
  const latitude = Number(required("latitude")),
    longitude = Number(required("longitude"));
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new Error("经纬度无效。");
  sql = `INSERT INTO incidents VALUES (${quote(crypto.randomUUID())},${quote(required("name"))},${quote(required("region"))},${latitude},${longitude},'active',${quote(timestamp())});`;
} else {
  console.log(`用法（默认本地，--remote 指向独立 staging）：
  bun scripts/organizer-admin.ts bootstrap --name 组织名称 --email 管理员邮箱 --origin 工作台地址
  bun scripts/organizer-admin.ts verify --organization 组织ID
  bun scripts/organizer-admin.ts requests
  bun scripts/organizer-admin.ts resolve-request --request 申请ID --status resolved|rejected
  bun scripts/organizer-admin.ts incident --name 事件名称 --region 地区 --latitude 纬度 --longitude 经度
邀请链接需要自行安全转交。本工具不发送邮件，也不执行组织资质核实。`);
  process.exit(command ? 1 : 0);
}
await mkdir(".artifacts", { recursive: true });
const path = `.artifacts/organizer-admin-${crypto.randomUUID()}.sql`;
try {
  await Bun.write(path, sql, { mode: 0o600 });
  const process = Bun.spawn(
    [
      "bun",
      "run",
      "wrangler",
      "d1",
      "execute",
      values.remote ? "firelink-organizer-staging" : "firelink-dev",
      ...(values.remote ? ["--remote", "--env", "staging"] : ["--local"]),
      "--file",
      path,
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0)
    throw new Error("数据库操作失败；未生成可用邀请。");
  if (invitation) console.log(invitation);
} finally {
  await rm(path, { force: true });
}
