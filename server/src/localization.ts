import messages from "./messages.json";

export type Language = "en" | "zh-Hans" | "zh-Hant" | "zh-Hant-HK";
export type MessageKey = keyof typeof messages;

/** Respect preference order and q weights; an explicit script takes priority over region. */
export function resolveLanguage(header?: string): Language {
  const preferences = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const weight = parameters.find((p) => p.trim().startsWith("q="));
      return { tag, q: weight ? Number(weight.trim().slice(2)) : 1 };
    })
    .filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of preferences) {
    try {
      const locale = new Intl.Locale(tag);
      if (locale.language === "en") return "en";
      if (locale.language !== "zh") continue;
      const script = locale.maximize().script;
      if (script === "Hans") return "zh-Hans";
      if (script === "Hant")
        return locale.region === "HK" || locale.region === "MO"
          ? "zh-Hant-HK"
          : "zh-Hant";
    } catch {
      // Ignore malformed or wildcard ranges and continue to the next language.
    }
  }
  return "en";
}

export function translate(language: Language, key: MessageKey): string {
  return messages[key][language];
}

/** Zod's default messages are not translation keys; use a localized validation fallback. */
export function errorMessage(language: Language, key?: string): string {
  return translate(
    language,
    key && Object.hasOwn(messages, key) ? (key as MessageKey) : "invalid_input",
  );
}

/** Only translate text produced by the application-result trigger; preserve authored replies. */
export function notificationText(
  language: Language,
  notice: { title: string; body: string },
  status: string | null,
  response: string | null,
): { title: string; body: string } {
  const key =
    status === "accepted"
      ? "application_accepted"
      : status === "rejected"
        ? "application_rejected"
        : null;
  if (!key || notice.title !== translate("zh-Hans", key)) return notice;
  return {
    title: translate(language, key),
    body:
      response === null &&
      notice.body === translate("zh-Hans", "application_updated")
        ? translate(language, "application_updated")
        : notice.body,
  };
}
