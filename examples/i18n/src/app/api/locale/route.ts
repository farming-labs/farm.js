import { getLocale, getLocaleSource, t } from "@farm.js/core/i18n/server";

export function GET() {
  return Response.json({
    locale: getLocale(),
    source: getLocaleSource(),
    message: t("home.visits", { count: 3 }),
  });
}
