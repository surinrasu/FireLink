import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hash } from "./domain";
import {
  deny,
  rateLimit,
  readJSON,
  requireRole,
  type OrgContext,
} from "./organizer-auth";
import {
  isCompleteRegion,
  regionNames,
  regionPath,
} from "../../shared/regions";
import type { LocationQuery, LocationResult } from "../../shared/locations";

const queryInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("region"),
    regionCode: z.string().min(1).max(12),
  }),
  z.object({
    kind: z.literal("search"),
    regionCode: z.string().min(1).max(12).optional(),
    query: z.string().trim().min(1).max(150),
  }),
  z.object({
    kind: z.literal("reverse"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
]);
const placeInput = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  name: z.string().optional(),
  display_name: z.string(),
  boundingbox: z
    .tuple([
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number(),
    ])
    .optional(),
  address: z.object({ country_code: z.string().optional() }).optional(),
});

export function locationURL(base: string, query: LocationQuery) {
  const url = new URL(
    `${base.replace(/\/$/, "")}/${query.kind === "reverse" ? "reverse" : "search"}`,
  );
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "zh-CN");
  url.searchParams.set("addressdetails", "1");
  if (query.kind === "reverse") {
    url.searchParams.set("lat", query.latitude.toFixed(6));
    url.searchParams.set("lon", query.longitude.toFixed(6));
    url.searchParams.set("zoom", "18");
  } else {
    const path = query.regionCode ? regionPath(query.regionCode) : [];
    if (query.kind === "region" && !isCompleteRegion(path))
      deny(400, "请完整选择所在地区。");
    if (query.regionCode && !path.length) deny(400, "所在地区无效。");
    const names = regionNames(path).reverse();
    url.searchParams.set(
      "q",
      [...(query.kind === "search" ? [query.query] : []), ...names].join(", "),
    );
    url.searchParams.set("countrycodes", "cn");
    url.searchParams.set("limit", query.kind === "region" ? "1" : "6");
    if (query.kind === "region") url.searchParams.set("layer", "address");
  }
  return url;
}
export function locationResults(
  body: unknown,
  reverse: boolean,
): LocationResult[] {
  const rows = reverse ? [body] : Array.isArray(body) ? body : [];
  return rows.slice(0, 6).flatMap((row) => {
    const parsed = placeInput.safeParse(row);
    if (
      !parsed.success ||
      (parsed.data.address?.country_code &&
        parsed.data.address.country_code !== "cn")
    )
      return [];
    const place = parsed.data;
    return [
      {
        name: place.name || place.display_name.split(",")[0],
        address: place.display_name,
        latitude: place.lat,
        longitude: place.lon,
        ...(place.boundingbox ? { bounds: place.boundingbox } : {}),
      },
    ];
  });
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty location response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 131072) {
      await reader.cancel();
      throw new Error("location response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function findLocations(c: OrgContext) {
  requireRole(c, "admin", "manager");
  const query = queryInput.parse(await readJSON(c));
  const url = locationURL(
    c.env.GEOCODER_URL || "https://nominatim.openstreetmap.org",
    query,
  );
  const id = await hash(url.href);
  const cached = await c.env.DB.prepare(
    "SELECT payload FROM location_cache WHERE id=? AND expires_at>?",
  )
    .bind(id, Date.now())
    .first<{ payload: string }>();
  if (cached) return c.json(JSON.parse(cached.payload) as LocationResult[]);
  await rateLimit(c, "locations", 120);
  // A database lease serializes all users/Workers. Hold it through the request,
  // then leave a full second of cooldown: https://operations.osmfoundation.org/policies/nominatim/
  const lease = Date.now() + 20000;
  const lock = await c.env.DB.prepare(
    "INSERT INTO organizer_rate_limits VALUES ('geocoder:upstream',1,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<=? RETURNING id",
  )
    .bind(lease, Date.now())
    .first();
  if (!lock) {
    c.header("Retry-After", "2");
    deny(429, "地址服务繁忙，请稍后重试。");
  }
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": `FireLink/1.0 (event location picker; ${new URL(c.req.url).origin})`,
        Referer: new URL(c.req.url).origin,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("location provider unavailable");
    const results = locationResults(
      await boundedResponse(response),
      query.kind === "reverse",
    );
    const ttl =
      query.kind === "region" && results.length ? 30 * 86400000 : 86400000;
    await c.env.DB.prepare(
      "INSERT INTO location_cache VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",
    )
      .bind(id, JSON.stringify(results), Date.now() + ttl)
      .run();
    return c.json(results);
  } catch {
    throw new HTTPException(503, { message: "地址查询暂不可用，请稍后重试。" });
  } finally {
    await c.env.DB.prepare(
      "UPDATE organizer_rate_limits SET expires_at=? WHERE id='geocoder:upstream' AND expires_at=?",
    )
      .bind(Date.now() + 1100, lease)
      .run();
  }
}
