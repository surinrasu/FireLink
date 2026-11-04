import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  resolveLanguage,
  translate,
  errorMessage,
  notificationText,
} from "../src/localization.ts";

test("language negotiation respects script, region, preference order and fallback", () => {
  for (const [header, expected] of [
    [undefined, "en"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["zh", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans", "zh-Hans"],
    ["zh-Hant", "zh-Hant"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant-HK"],
    ["zh-MO", "zh-Hant-HK"],
    ["zh-Hans-HK", "zh-Hans"],
    ["zh-Hant-CN", "zh-Hant"],
    ["en;q=0.2,zh-HK;q=0.9", "zh-Hant-HK"],
    ["zh;q=0,en;q=0.5", "en"],
    ["fr-FR,zh-TW;q=0.9,en;q=0.8", "zh-Hant"],
    ["zh;q=invalid,zh-HK;q=2,en", "en"],
    ["bad_tag,zh-SG", "zh-Hans"],
    ["fr-FR", "en"],
    ["*", "en"],
  ])
    assert.equal(resolveLanguage(header), expected, String(header));
});

test("errors and result notifications translate while authored content remains unchanged", () => {
  assert.equal(translate("en", "sign_in_required"), "Please sign in first.");
  assert.equal(translate("zh-Hant", "sign_in_required"), "請先登入");
  assert.equal(
    errorMessage("zh-Hant-HK", "unknown validation message"),
    "輸入不正確",
  );
  assert.equal(
    errorMessage("en", "toString"),
    "Check your information and try again.",
  );
  const result = { title: "报名已通过", body: "组织者已更新你的申请结果" };
  assert.deepEqual(notificationText("en", result, "accepted", null), {
    title: "Application accepted",
    body: "The organizer has updated your application result.",
  });
  assert.equal(
    notificationText("en", result, "accepted", result.body).body,
    result.body,
  );
  const authored = { title: "集合提醒", body: "请于明早集合" };
  assert.deepEqual(notificationText("en", authored, null, null), authored);
  const expiry = {
    title: "报名已过期",
    body: "任务已结束，报名未获确认，已自动过期。",
  };
  for (const language of ["en", "zh-Hans", "zh-Hant", "zh-Hant-HK"] as const)
    assert.deepEqual(notificationText(language, expiry, "expired", null), {
      title: translate(language, "application_expired"),
      body: translate(language, "application_expired_body"),
    });
  assert.equal(
    notificationText(
      "zh-Hant",
      { title: "报名未通过", body: "请等待联系" },
      "rejected",
      "请等待联系",
    ).body,
    "请等待联系",
  );
});
