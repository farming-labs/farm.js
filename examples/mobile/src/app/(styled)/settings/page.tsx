import { t } from "@farm.js/core/i18n/server";
import { Link } from "@farm.js/core/client";
import { LanguagePicker } from "./language-picker";

export default function SettingsPage() {
  return (
    <>
      <h1 className="page-title">{t("settings.title")}</h1>
      <LanguagePicker />
      <ul className="list">
        <li>
          <Link className="row" href="/settings/device">
            <strong>Device</strong>
            <span>page.kt: a platform screen on Android</span>
          </Link>
        </li>
        <li>
          <Link className="row" href="/about">
            <strong>About</strong>
            <span>A push on the Settings tab's own stack</span>
          </Link>
        </li>
      </ul>
    </>
  );
}
