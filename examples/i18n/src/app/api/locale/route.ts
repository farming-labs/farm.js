import { getLocale, getLocaleSource, t } from "@farmjs/core/i18n/server";

export function GET() {
  return Response.json({
    locale: getLocale(),
    source: getLocaleSource(),
    message: t("home.visits", { count: 3 }),
  });
}
