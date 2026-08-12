"use client";

/** Preact consumes FARMJS's React-shaped hooks through the renderer's preact/compat aliases. */
export {
  useBlocker,
  useNavigation,
  usePageState,
  useRouter,
  useScrollRestoration,
} from "@farm.js/core/client";
export { useAction } from "@farm.js/core/server-fn/client";
export { useServerQuery } from "@farm.js/core/server-query/client";
export { useTheme } from "@farm.js/core/theme/client";
export { useLocale, useTranslations } from "@farm.js/core/i18n/client";
