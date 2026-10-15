import { z } from "zod";

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").replace(/^\+86/, ""))
  .pipe(z.string().regex(/^1[3-9]\d{9}$/, "invalid_phone"));
export const profileSchema = z.object({
  username: z.string().trim().min(1).max(30),
  pronouns: z.string().trim().max(20),
  region: z.string().trim().max(100),
  body: z.string().trim().max(300),
  equipment: z
    .array(z.enum(["vehicle", "firstAid", "tools", "protective"]))
    .max(4),
  contacts: z.object({
    phone: phoneSchema,
    wechat: z.string().trim().max(60),
    email: z.union([z.literal(""), z.string().email()]),
  }),
});
export type Profile = z.infer<typeof profileSchema> & {
  id: string;
  realName: string;
  birthDate: string;
  gender: string;
  verified: boolean;
};
export const shareFields = [
  "username",
  "pronouns",
  "realName",
  "age",
  "gender",
  "region",
  "body",
  "equipment",
  "skills",
] as const;
export const applySchema = z.object({
  fields: z.array(z.enum(shareFields)).min(1),
  contactFields: z.array(z.enum(["phone", "wechat", "email"])).min(1),
  consentVersion: z.literal(1),
});
export const identities = {
  lin: { realName: "林晓", birthDate: "1998-06-18", gender: "女" },
  zhou: { realName: "周远", birthDate: "1995-03-12", gender: "男" },
};
// Reserved, non-resident area prefix: these fixtures cannot identify a real resident.
export const identityExamples = {
  lin: { realName: "林晓", idNumber: "000000199806180020" },
  zhou: { realName: "周远", idNumber: "000000199503120013" },
};
export const identityInput = z.object({
  realName: z.string().trim().min(1, "missing_name").max(80),
  idNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{17}[\dX]$/, "invalid_id"),
});
export function matchIdentity(input: z.infer<typeof identityInput>) {
  return (Object.keys(identityExamples) as (keyof typeof identities)[]).find(
    (key) =>
      identityExamples[key].realName === input.realName &&
      identityExamples[key].idNumber === input.idNumber,
  );
}
export function age(birthDate: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = today.split("-").map(Number),
    [by, bm, bd] = birthDate.split("-").map(Number);
  return y - by - Number(m < bm || (m === bm && d < bd));
}
export function asJSON<T>(text: unknown): T {
  return JSON.parse(String(text)) as T;
}
export const timestamp = () => new Date().toISOString();
export async function hash(value: string) {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(data), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function randomToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}
