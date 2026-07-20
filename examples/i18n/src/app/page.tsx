import { format, getLocale, t } from "@farmjs/core/i18n/server";
import { LocaleSwitcher } from "./locale-switcher";

export const ssg = true;

export default function HomePage() {
  const locale = getLocale();

  return (
    <main className="shell">
      <section>
        <p className="eyebrow">{t("home.eyebrow")}</p>
        <h1>{t("home.title")}</h1>
        <p className="description">{t("home.description")}</p>
        <dl>
          <div>
            <dt>{t("home.localeLabel")}</dt>
            <dd>{locale}</dd>
          </div>
          <div>
            <dt>{t("home.numberLabel")}</dt>
            <dd>{format.number(128_400)}</dd>
          </div>
          <div>
            <dt>{t("home.messageLabel")}</dt>
            <dd>{t("home.visits", { count: 3 })}</dd>
          </div>
        </dl>
        <LocaleSwitcher />
      </section>
    </main>
  );
}
