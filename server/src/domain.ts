import { z } from "zod";
import {
  MAX_CUSTOM_FIELDS,
  MAX_CUSTOM_FIELD_NAME,
  MAX_CUSTOM_FIELD_ANSWER,
} from "../../shared/custom-fields";

const normalizePhone = (value: string) =>
  value.replace(/[\s-]/g, "").replace(/^\+86/, "");

export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^1[3-9]\d{9}$/, "invalid_phone"));

const vehicleCount = (error: string) =>
  z.number({ error }).int(error).min(0, error).max(999, error).optional();
export const vehiclesSchema = z.strictObject(
  {
    motorcycle: vehicleCount("invalid_motorcycle_count"),
    cargoTricycle: vehicleCount("invalid_cargo_tricycle_count"),
    sedan: vehicleCount("invalid_sedan_count"),
    offRoad: vehicleCount("invalid_off_road_count"),
    cargoVan: vehicleCount("invalid_cargo_van_count"),
  },
  { error: "invalid_vehicles" },
);

// Preserve descriptions entered with earlier category-based editors on the first save.
export function equipmentText(profile: {
  equipmentDescription?: string;
  equipment: string[];
  equipmentDetails?: Record<string, string>;
}) {
  if (profile.equipmentDescription !== undefined)
    return profile.equipmentDescription;
  const labels: Record<string, string> = {
    vehicle: "车辆",
    firstAid: "急救用品",
    tools: "工具",
    protective: "防护装备",
  };
  return profile.equipment
    .map((key) => {
      const fields =
        key === "vehicle" ? ["vehiclePassengers", "vehicleCargo"] : [key];
      const details = fields
        .map((field) => profile.equipmentDetails?.[field])
        .filter(Boolean)
        .join("；");
      return details
        ? `${labels[key] ?? key}：${details}`
        : (labels[key] ?? key);
    })
    .join("\n");
}

export const profileSchema = z
  .object({
    username: z
      .string({ error: "invalid_username" })
      .trim()
      .min(1, "invalid_username")
      .max(30, "invalid_username"),
    pronouns: z
      .string({ error: "invalid_pronouns" })
      .trim()
      .max(20, "invalid_pronouns"),
    region: z
      .string({ error: "invalid_region" })
      .trim()
      .max(100, "invalid_region"),
    body: z.string({ error: "invalid_body" }).trim().max(300, "invalid_body"),
    equipment: z.array(z.string()).default([]),
    equipmentDetails: z.record(z.string(), z.string()).default({}),
    equipmentDescription: z
      .string({ error: "invalid_equipment_text" })
      .optional(),
    vehicles: vehiclesSchema.default({}),
    contacts: z.object(
      {
        phone: z
          .string({ error: "invalid_contact_phone" })
          .transform(normalizePhone)
          .pipe(z.string().regex(/^1[3-9]\d{9}$/, "invalid_contact_phone")),
        wechat: z
          .string({ error: "invalid_wechat" })
          .trim()
          .max(60, "invalid_wechat"),
        email: z.union([z.literal(""), z.string().email("invalid_email")], {
          error: "invalid_email",
        }),
      },
      { error: "invalid_contacts" },
    ),
  })
  .transform((profile) => ({
    ...profile,
    equipmentDescription: equipmentText(profile),
    equipment: [] as string[],
    equipmentDetails: {} as Record<string, string>,
  }));
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
  "vehicles",
  "skills",
] as const;
export const applySchema = z.object({
  fields: z.array(z.enum(shareFields)).min(1),
  contactFields: z.array(z.enum(["phone", "wechat", "email"])).min(1),
  consentVersion: z.literal(1),
  customAnswers: z
    .record(
      z.string().min(1).max(MAX_CUSTOM_FIELD_NAME),
      z.string().trim().max(MAX_CUSTOM_FIELD_ANSWER),
    )
    .refine((answers) => Object.keys(answers).length <= MAX_CUSTOM_FIELDS)
    .default({}),
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
