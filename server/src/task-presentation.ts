import { asJSON } from "./domain";
import type { Language } from "./localization";
import type { ContentBlock } from "../../shared/organizer";

/** Existing native clients already render tables; keep scheduling data visible there. */
export function volunteerTaskBlocks(
  row: Record<string, unknown>,
  language: Language,
): ContentBlock[] {
  const blocks = asJSON<ContentBlock[]>(row.blocks);
  const labels =
    language === "en"
      ? [
          "Recruitment details",
          "Task starts (China time)",
          "Task ends (China time)",
          "Application deadline (China time)",
          "Location",
          "Meeting point",
          "Places",
        ]
      : language.startsWith("zh-Hant")
        ? [
            "招募資訊",
            "任務開始（北京時間）",
            "任務結束（北京時間）",
            "報名截止（北京時間）",
            "服務地點",
            "集合地點",
            "招募人數",
          ]
        : [
            "招募信息",
            "任务开始（北京时间）",
            "任务结束（北京时间）",
            "报名截止（北京时间）",
            "服务地点",
            "集合地点",
            "招募人数",
          ];
  const rows: string[][] = [];
  for (const [index, key] of [
    "starts_at",
    "ends_at",
    "deadline",
    "location",
    "meeting_point",
    "capacity",
  ].entries()) {
    const value = row[key];
    if (value === "" || value == null) continue;
    const text =
      index < 3
        ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", {
            timeZone: "Asia/Shanghai",
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(String(value)))
        : String(value);
    rows.push([labels[index + 1], text]);
  }
  return rows.length
    ? [
        { type: "heading", text: labels[0] },
        {
          type: "table",
          rows: [
            language === "en" ? ["Field", "Details"] : ["项目", "信息"],
            ...rows,
          ],
        },
        ...blocks,
      ]
    : blocks;
}
