export type FarmBuildActivityPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface FarmDevIndicatorsConfig {
  /** Show build and HMR activity in the browser during development. */
  buildActivity?: boolean;
  /** Corner used by the build activity indicator. */
  buildActivityPosition?: FarmBuildActivityPosition;
}

export interface ResolvedFarmDevIndicatorsConfig {
  buildActivity: boolean;
  buildActivityPosition: FarmBuildActivityPosition;
}

export function resolveFarmDevIndicatorsConfig(
  config: FarmDevIndicatorsConfig | undefined,
  mode: "development" | "production" = "development",
): ResolvedFarmDevIndicatorsConfig {
  return {
    buildActivity: mode === "development" && (config?.buildActivity ?? true),
    buildActivityPosition: config?.buildActivityPosition ?? "bottom-right",
  };
}

export function generateFarmDevIndicatorsClientRuntime(
  config: ResolvedFarmDevIndicatorsConfig,
): string {
  if (!config.buildActivity) return "";

  const position = {
    "bottom-right": "right: 16px; bottom: 16px;",
    "bottom-left": "left: 16px; bottom: 16px;",
    "top-right": "right: 16px; top: 16px;",
    "top-left": "left: 16px; top: 16px;",
  }[config.buildActivityPosition];
  const styles = `
    #__farm_build_activity__ {
      position: fixed;
      ${position}
      z-index: 2147483645;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid rgb(255 255 255 / 0.16);
      border-radius: 999px;
      background: rgb(17 17 17 / 0.9);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
      color: rgb(250 250 250);
      font: 500 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: -0.01em;
      opacity: 0;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 120ms ease-out, transform 120ms ease-out;
    }
    #__farm_build_activity__[data-visible="true"] {
      opacity: 1;
      transform: translateY(0);
    }
    #__farm_build_activity__::before {
      width: 8px;
      height: 8px;
      border: 1.5px solid rgb(255 255 255 / 0.32);
      border-top-color: currentColor;
      border-radius: 50%;
      content: "";
      animation: farm-build-activity-spin 650ms linear infinite;
    }
    #__farm_build_activity__[data-state="ready"]::before {
      border-color: currentColor;
      animation: none;
    }
    #__farm_build_activity__[data-state="error"] {
      border-color: rgb(248 113 113 / 0.55);
      color: rgb(254 202 202);
    }
    #__farm_build_activity__[data-state="error"]::before {
      border-color: currentColor;
      animation: none;
    }
    @keyframes farm-build-activity-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #__farm_build_activity__ { transition: none; }
      #__farm_build_activity__::before { animation-duration: 1.4s; }
    }
  `;

  return `
if (import.meta.hot) {
  (() => {
    const hot = import.meta.hot;
    const indicatorId = "__farm_build_activity__";
    const styleId = "__farm_build_activity_styles__";
    const runtimeKey = "__FARM_BUILD_ACTIVITY_RUNTIME__";
    const reloadMarker = "__FARM_BUILD_ACTIVITY_RELOADING__";
    let hideTimer;

    const ensureIndicator = () => {
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        style.textContent = ${JSON.stringify(styles)};
        document.head.appendChild(style);
      }

      let indicator = document.getElementById(indicatorId);
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = indicatorId;
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-live", "polite");
        document.body.appendChild(indicator);
      }
      return indicator;
    };

    const show = (state, label) => {
      window.clearTimeout(hideTimer);
      const indicator = ensureIndicator();
      indicator.dataset.state = state;
      indicator.dataset.visible = "true";
      indicator.textContent = label;
    };
    const hide = () => {
      const indicator = document.getElementById(indicatorId);
      if (indicator) indicator.dataset.visible = "false";
    };
    const onBeforeUpdate = () => show("building", "Farm updating");
    const onAfterUpdate = () => {
      show("ready", "Farm ready");
      hideTimer = window.setTimeout(hide, 500);
    };
    const onError = () => show("error", "Build failed");
    const onBeforeFullReload = () => {
      try {
        window.sessionStorage.setItem(reloadMarker, "1");
      } catch {}
      show("building", "Farm updating");
    };

    window[runtimeKey]?.dispose?.();
    ensureIndicator();
    let completedReload = false;
    try {
      completedReload = window.sessionStorage.getItem(reloadMarker) === "1";
      window.sessionStorage.removeItem(reloadMarker);
    } catch {}
    if (completedReload) onAfterUpdate();
    else hide();
    hot.on("vite:beforeUpdate", onBeforeUpdate);
    hot.on("vite:afterUpdate", onAfterUpdate);
    hot.on("vite:error", onError);
    hot.on("vite:beforeFullReload", onBeforeFullReload);
    window[runtimeKey] = {
      dispose() {
        window.clearTimeout(hideTimer);
        hot.off("vite:beforeUpdate", onBeforeUpdate);
        hot.off("vite:afterUpdate", onAfterUpdate);
        hot.off("vite:error", onError);
        hot.off("vite:beforeFullReload", onBeforeFullReload);
        document.getElementById(indicatorId)?.remove();
      },
    };
  })();
}
`;
}
