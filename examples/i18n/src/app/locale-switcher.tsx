"use client";

import { useLocale, useTranslations } from "@farmjs/core/i18n/client";

const labels = {
  en: "locale.english",
  am: "locale.amharic",
  ar: "locale.arabic",
} as const;

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocale();
  const t = useTranslations();

  return (
    <div className="switcher" aria-label={t("locale.switch")}>
      <p>{t("home.current", { locale })}</p>
      <div>
        {locales.map((option) => (
          <button
            aria-pressed={option === locale}
            key={option}
            onClick={() => setLocale(option)}
            type="button"
          >
            {t(labels[option as keyof typeof labels])}
          </button>
        ))}
      </div>
    </div>
  );
}
