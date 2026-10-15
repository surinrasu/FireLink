import { spawnSync } from "node:child_process";
const [id, status, ...words] = process.argv.slice(2);
if (!id || !["accepted", "rejected"].includes(status)) {
  console.error("用法: bun test/decision.ts <申请ID> accepted|rejected [回应]");
  process.exit(1);
}
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const sql = `UPDATE applications SET status=${q(status)},response=${q(words.join(" ") || "演示审核结果")},updated_at=${q(new Date().toISOString())} WHERE id=${q(id)} AND status='pending';`;
const result = spawnSync(
  process.execPath,
  [
    "run",
    "wrangler",
    "d1",
    "execute",
    "firelink-dev",
    "--local",
    "--command",
    sql,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
