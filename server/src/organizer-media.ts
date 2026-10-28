import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  deny,
  rateLimit,
  requireRole,
  sessionAccount,
  type OrgContext,
  type OrganizerEnv,
} from "./organizer-auth";
import { mediaTypes } from "../../shared/media";
import type { ContentBlock } from "../../shared/organizer";

interface MediaRow {
  id: string;
  organization_id: string;
  uploaded_by: string;
  object_key: string;
  url: string;
  mime: string;
  size: number;
  filename: string;
}
// Reuse the existing content-block contract, including absolute URLs for native clients.
const reference =
  "EXISTS (SELECT 1 FROM json_each(t.blocks) b WHERE json_extract(b.value,'$.type') IN ('image','video') AND json_extract(b.value,'$.url')=f.url)";

function matchesMime(bytes: Uint8Array, mime: string) {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length < 16) return false;
  switch (mime) {
    case "image/jpeg":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/png":
      return (
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) &&
        text(12, 16) === "IHDR"
      );
    case "image/webp":
      return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(text(0, 6));
    case "video/mp4":
      return (
        text(4, 8) === "ftyp" &&
        [
          "isom",
          "iso2",
          "mp41",
          "mp42",
          "avc1",
          "M4V ",
          "MSNV",
          "dash",
        ].includes(text(8, 12))
      );
    case "video/webm":
      return (
        [26, 69, 223, 163].every((b, i) => bytes[i] === b) &&
        text(4, 512).includes("webm")
      );
    default:
      return false;
  }
}

/** Bound memory to one 5 MiB part, including for chunked requests. */
async function storeUpload(
  c: OrgContext,
  key: string,
  mime: string,
  expected: number,
) {
  const reader = c.req.raw.body?.getReader();
  if (!reader) deny(400, "请选择文件。");
  const chunkSize = 5 * 1024 * 1024;
  const buffer = new Uint8Array(chunkSize);
  let used = 0,
    total = 0,
    checked = false;
  let upload: R2MultipartUpload | undefined;
  const parts: R2UploadedPart[] = [];
  const check = () => {
    if (!checked) {
      if (!matchesMime(buffer.subarray(0, used), mime))
        deny(400, "文件内容与格式不符，请重新导出后上传。");
      checked = true;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > expected) deny(413, "文件大小与申报不符，请重新选择文件。");
      for (let offset = 0; offset < value.length; ) {
        const count = Math.min(chunkSize - used, value.length - offset);
        buffer.set(value.subarray(offset, offset + count), used);
        used += count;
        offset += count;
        if (used === chunkSize) {
          check();
          upload ??= await c.env.FILES.createMultipartUpload(key, {
            httpMetadata: { contentType: mime },
          });
          parts.push(await upload.uploadPart(parts.length + 1, buffer));
          used = 0;
        }
      }
    }
    if (total !== expected) deny(400, "文件上传不完整，请重试。");
    check();
    if (upload) {
      if (used)
        parts.push(
          await upload.uploadPart(parts.length + 1, buffer.subarray(0, used)),
        );
      await upload.complete(parts);
    } else {
      await c.env.FILES.put(key, buffer.subarray(0, used), {
        httpMetadata: { contentType: mime },
      });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (upload) await upload.abort().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function uploadMedia(c: OrgContext) {
  requireRole(c, "admin", "manager");
  const mime = c.req.header("Content-Type") || "";
  const kind = mime.startsWith("image/") ? "image" : "video";
  if (!(mediaTypes[kind].accept.split(",") as string[]).includes(mime))
    deny(400, "不支持此格式，请选择 JPG、PNG、WebP、GIF、MP4 或 WebM。");
  const size = Number(c.req.header("X-File-Size"));
  if (!Number.isSafeInteger(size) || size < 16) deny(400, "文件为空或无效。");
  if (size > mediaTypes[kind].limit) deny(413, mediaTypes[kind].hint);
  let filename = "";
  try {
    filename = decodeURIComponent(c.req.header("X-File-Name") || "")
      .replace(/[\x00-\x1f\x7f/\\]/g, "")
      .slice(0, 180);
  } catch {
    deny(400, "文件名无效。");
  }
  const member = c.get("member"),
    account = c.get("account");
  await rateLimit(c, `media:${account.id}`, 30);
  const id = crypto.randomUUID(),
    key = `organizer/${member.organization_id}/${id}`;
  const url = new URL(`/api/organizer-media/${id}`, c.req.url).href;
  // Reserve storage atomically before reading the body; concurrent uploads count too.
  const reservation = await c.env.DB.prepare(
    `INSERT INTO organizer_media (id,organization_id,uploaded_by,object_key,url,mime,size,filename,created_at)
    SELECT ?,?,?,?,?,?,?,?,? FROM organizations o WHERE o.id=? AND
    COALESCE((SELECT SUM(size) FROM organizer_media WHERE organization_id=o.id),0)+? <= CASE WHEN o.demo_expires_at IS NULL THEN 1073741824 ELSE 209715200 END`,
  )
    .bind(
      id,
      member.organization_id,
      account.id,
      key,
      url,
      mime,
      size,
      filename,
      Date.now(),
      member.organization_id,
      size,
    )
    .run();
  if (!reservation.meta.changes) deny(413, "空间容量已满，请联系管理员。");
  try {
    await storeUpload(c, key, mime, size);
    await c.env.DB.prepare("UPDATE organizer_media SET ready=1 WHERE id=?")
      .bind(id)
      .run();
  } catch (error) {
    // Keep the reservation if R2 deletion fails so scheduled cleanup can retry.
    await c.env.FILES.delete(key);
    await c.env.DB.prepare("DELETE FROM organizer_media WHERE id=?")
      .bind(id)
      .run();
    throw error;
  }
  return c.json({ id, url, mime, size, filename }, 201);
}

export async function validateMedia(c: OrgContext, blocks: ContentBlock[]) {
  for (const block of blocks) {
    if (!block.url) continue;
    const url = new URL(block.url);
    if (url.pathname.startsWith("/api/organizer-media/")) {
      const file = await c.env.DB.prepare(
        `SELECT f.mime FROM organizer_media f WHERE f.url=? AND f.organization_id=? AND f.ready=1 AND
        (?='admin' OR f.uploaded_by=? OR EXISTS (SELECT 1 FROM member_tasks mt JOIN tasks t ON t.id=mt.task_id WHERE mt.member_id=? AND t.organizer_id=f.organization_id AND ${reference}))`,
      )
        .bind(
          block.url,
          c.get("member").organization_id,
          c.get("member").role,
          c.get("account").id,
          c.get("member").id,
        )
        .first<{ mime: string }>();
      if (!file || !file.mime.startsWith(`${block.type}/`))
        deny(400, "附件不存在或不属于本组织，请重新上传。");
    } else if (url.protocol !== "https:") deny(400, "媒体链接必须使用 HTTPS。");
  }
}

export const organizerMedia = new Hono<OrganizerEnv>();
organizerMedia.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  console.error(
    JSON.stringify({ event: "media_read_failed", kind: error.name }),
  );
  return c.json({ error: "文件暂时不可用。" }, 500);
});
organizerMedia.on(["GET", "HEAD"], "/:id", async (c) => {
  const file = await c.env.DB.prepare(
    "SELECT f.* FROM organizer_media f JOIN organizations o ON o.id=f.organization_id WHERE f.id=? AND f.ready=1 AND (o.demo_expires_at IS NULL OR o.demo_expires_at>?)",
  )
    .bind(c.req.param("id"), Date.now())
    .first<MediaRow>();
  if (!file) deny(404, "文件不存在。");
  const publicFile = await c.env.DB.prepare(
    `SELECT 1 FROM organizer_media f JOIN tasks t ON t.organizer_id=f.organization_id JOIN organizations o ON o.id=f.organization_id WHERE f.id=? AND t.publication_status!='draft' AND o.verified=1 AND o.demo_expires_at IS NULL AND ${reference} LIMIT 1`,
  )
    .bind(file.id)
    .first();
  if (!publicFile) {
    const account = await sessionAccount(c);
    const allowed =
      account &&
      (await c.env.DB.prepare(
        `SELECT 1 FROM organizer_media f JOIN organization_members m ON m.organization_id=f.organization_id WHERE f.id=? AND m.account_id=? AND m.active=1 AND
      (m.role='admin' OR (m.role='manager' AND f.uploaded_by=m.account_id) OR EXISTS (SELECT 1 FROM member_tasks mt JOIN tasks t ON t.id=mt.task_id WHERE mt.member_id=m.id AND t.organizer_id=f.organization_id AND ${reference}))`,
      )
        .bind(file.id, account.id)
        .first());
    if (!allowed) deny(404, "文件不存在或没有访问权限。");
  }
  const headers = new Headers({
    "Content-Type": file.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Disposition": "inline",
  });
  let offset = 0,
    length = file.size;
  const range = c.req.method === "GET" ? c.req.header("Range") : undefined;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: {
          ...Object.fromEntries(headers),
          "Content-Range": `bytes */${file.size}`,
        },
      });
    offset = match[1]
      ? Number(match[1])
      : Math.max(0, file.size - Number(match[2]));
    const end =
      match[1] && match[2]
        ? Math.min(Number(match[2]), file.size - 1)
        : file.size - 1;
    length = end - offset + 1;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset >= file.size ||
      length <= 0
    )
      return new Response(null, {
        status: 416,
        headers: {
          ...Object.fromEntries(headers),
          "Content-Range": `bytes */${file.size}`,
        },
      });
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${file.size}`,
    );
  }
  headers.set("Content-Length", String(length));
  if (c.req.method === "HEAD") return new Response(null, { headers });
  const object = await c.env.FILES.get(file.object_key, {
    range: { offset, length },
  });
  if (!object) deny(404, "文件不存在。");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: range ? 206 : 200, headers });
});

export async function cleanupMedia(
  db: D1Database,
  files: Pick<R2Bucket, "delete">,
  now: number,
) {
  // Delete objects before metadata; a failure leaves a retryable record.
  for (;;) {
    const batch = await db
      .prepare(
        `SELECT f.id,f.object_key FROM organizer_media f JOIN organizations o ON o.id=f.organization_id WHERE (o.demo_expires_at IS NOT NULL AND o.demo_expires_at<=?) OR (f.ready=0 AND f.created_at<?) LIMIT 100`,
      )
      .bind(now, now - 86400000)
      .all<{ id: string; object_key: string }>();
    if (!batch.results.length) break;
    await files.delete(batch.results.map((f) => f.object_key));
    await db.batch(
      batch.results.map((f) =>
        db.prepare("DELETE FROM organizer_media WHERE id=?").bind(f.id),
      ),
    );
  }
}
