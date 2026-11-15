"use client";

import { useLocale, useTranslations } from "@farm.js/core/i18n/client";

const labels = { en: "settings.english", es: "settings.spanish" } as const;

/**
 * setLocale() is a document navigation to the locale URL, never a client visit, so the shell's
 * navigator does not see it: the WebView reloads the page in the new locale in place.
 */
export function LanguagePicker() {
  const { locale, locales, setLocale } = useLocale();
  const t = useTranslations();
  return (
    <section className="card" aria-label={t("settings.language")}>
      <p data-testid="locale">{t("settings.current", { locale })}</p>
      <div className="actions">
        {locales.map((option) => (
          <button
            className={option === locale ? "button" : "button secondary"}
            aria-pressed={option === locale}
            key={option}
            onClick={() => setLocale(option)}
            type="button"
          >
            {t(labels[option as keyof typeof labels])}
          </button>
        ))}
      </div>
    </section>
  );
}
