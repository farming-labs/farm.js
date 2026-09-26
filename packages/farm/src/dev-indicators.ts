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
      min-height: 34px;
      padding: 0 11px;
      border: 1px solid rgb(255 255 255 / 0.16);
      border-radius: 6px;
      background: rgb(8 8 8 / 0.94);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
      color: rgb(250 250 250);
      font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0;
      opacity: 0;
      pointer-events: none;
      transform: translateY(4px);
      transition: opacity 120ms ease-out, transform 120ms ease-out;
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
    #__farm_build_activity__[data-visible="true"] {
      opacity: 1;
      transform: translateY(0);
    }
    .farm-build-activity__brand {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex: none;
    }
    .farm-build-activity__mark {
      width: 17px;
      height: 16px;
      flex: none;
    }
    .farm-build-activity__wordmark {
      color: rgb(255 255 255);
      font-size: 11px;
      font-weight: 400;
      line-height: 1;
    }
    .farm-build-activity__wordmark-suffix { color: rgb(255 255 255 / 0.52); }
    .farm-build-activity__divider {
      width: 1px;
      height: 14px;
      margin: 0 9px;
      flex: none;
      background: rgb(255 255 255 / 0.14);
    }
    .farm-build-activity__loader {
      display: grid;
      width: 15px;
      grid-template-columns: repeat(3, 4px);
      gap: 1.5px;
      flex: none;
    }
    .farm-build-activity__cell {
      width: 4px;
      height: 4px;
      border-radius: 1px;
      background: currentColor;
      opacity: 0.15;
    }
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell {
      animation: farm-build-activity-pixel-on 650ms ease-in-out infinite;
    }
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(1),
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(5),
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(7) {
      animation-delay: 90ms;
    }
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(2),
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(6),
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(8) {
      animation-delay: 180ms;
    }
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(3),
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(9) {
      animation-delay: 270ms;
    }
    #__farm_build_activity__[data-state="building"] .farm-build-activity__cell:nth-child(4) {
      animation-delay: 0ms;
    }
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell,
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell {
      opacity: 0.08;
    }
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell:nth-child(3),
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell:nth-child(5),
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell:nth-child(6),
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell:nth-child(7),
    #__farm_build_activity__[data-state="ready"] .farm-build-activity__cell:nth-child(8),
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell:nth-child(1),
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell:nth-child(3),
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell:nth-child(5),
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell:nth-child(7),
    #__farm_build_activity__[data-state="error"] .farm-build-activity__cell:nth-child(9) {
      opacity: 1;
    }
    .farm-build-activity__label {
      margin-left: 7px;
      color: rgb(255 255 255 / 0.62);
      font-size: 9px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .farm-build-activity__sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    #__farm_build_activity__[data-state="error"] {
      border-color: rgb(248 113 113 / 0.55);
    }
    #__farm_build_activity__[data-state="error"] .farm-build-activity__loader,
    #__farm_build_activity__[data-state="error"] .farm-build-activity__label {
      color: rgb(254 202 202);
    }
    @keyframes farm-build-activity-pixel-on {
      0%, 32%, 100% { opacity: 0.15; }
      14% { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      #__farm_build_activity__ { transition: none; }
      #__farm_build_activity__[data-state="building"] .farm-build-activity__cell {
        animation: none;
        opacity: 0.28;
      }
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

    const createBrandMark = () => {
      const namespace = "http://www.w3.org/2000/svg";
      const mark = document.createElementNS(namespace, "svg");
      mark.setAttribute("class", "farm-build-activity__mark");
      mark.setAttribute("viewBox", "125 68 161 152");
      mark.setAttribute("fill", "none");
      mark.setAttribute("aria-hidden", "true");

      const shapes = [
        ["M157 68H133C128.582 68 125 71.5817 125 76V100C125 104.418 128.582 108 133 108H157C161.418 108 165 104.418 165 100V76C165 71.5817 161.418 68 157 68Z", "#F5F5F4"],
        ["M182.383 68H280.617C282.045 68 283.414 68.8429 284.423 70.3431C285.433 71.8434 286 73.8783 286 76V100C286 102.122 285.433 104.157 284.423 105.657C283.414 107.157 282.045 108 280.617 108H182.383C180.955 108 179.586 107.157 178.577 105.657C177.567 104.157 177 102.122 177 100V76C177 73.8783 177.567 71.8434 178.577 70.3431C179.586 68.8429 180.955 68 182.383 68ZM271.852 81C270.747 81 269.852 81.8954 269.852 83V93C269.852 94.1046 270.747 95 271.852 95H277.272C278.376 95 279.272 94.1046 279.272 93V83C279.272 81.8954 278.376 81 277.272 81H271.852Z", "#F5F5F4"],
        ["M157 124H133C128.582 124 125 127.582 125 132V156C125 160.418 128.582 164 133 164H157C161.418 164 165 160.418 165 156V132C165 127.582 161.418 124 157 124Z", "#A3A3A3"],
        ["M280.334 124H182.666C179.537 124 177 127.582 177 132V156C177 160.418 179.537 164 182.666 164H280.334C283.463 164 286 160.418 286 156V132C286 127.582 283.463 124 280.334 124Z", "#A3A3A3"],
        ["M157 180H133C128.582 180 125 183.582 125 188V212C125 216.418 128.582 220 133 220H157C161.418 220 165 216.418 165 212V188C165 183.582 161.418 180 157 180Z", "#595959"],
        ["M230.189 180H182.811C179.602 180 177 183.582 177 188V212C177 216.418 179.602 220 182.811 220H230.189C233.398 220 236 216.418 236 212V188C236 183.582 233.398 180 230.189 180Z", "#595959"],
      ];
      for (const [index, [pathData, fill]] of shapes.entries()) {
        const path = document.createElementNS(namespace, "path");
        path.setAttribute("d", pathData);
        path.setAttribute("fill", fill);
        if (index === 1) {
          path.setAttribute("fill-rule", "evenodd");
          path.setAttribute("clip-rule", "evenodd");
        }
        mark.appendChild(path);
      }
      return mark;
    };

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

        const brand = document.createElement("span");
        brand.className = "farm-build-activity__brand";
        brand.setAttribute("aria-hidden", "true");
        const wordmark = document.createElement("span");
        wordmark.className = "farm-build-activity__wordmark";
        const suffix = document.createElement("span");
        suffix.className = "farm-build-activity__wordmark-suffix";
        suffix.textContent = ".JS";
        wordmark.append("FARM", suffix);
        brand.append(createBrandMark(), wordmark);

        const divider = document.createElement("span");
        divider.className = "farm-build-activity__divider";
        divider.setAttribute("aria-hidden", "true");

        const loader = document.createElement("span");
        loader.className = "farm-build-activity__loader";
        loader.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 9; index += 1) {
          const cell = document.createElement("span");
          cell.className = "farm-build-activity__cell";
          loader.appendChild(cell);
        }

        const label = document.createElement("span");
        label.className = "farm-build-activity__label";
        label.setAttribute("aria-hidden", "true");
        label.dataset.farmBuildLabel = "";
        const message = document.createElement("span");
        message.className = "farm-build-activity__sr-only";
        message.dataset.farmBuildMessage = "";
        indicator.append(loader, label, divider, brand, message);
        document.body.appendChild(indicator);
      }
      return indicator;
    };

    const show = (state, label, message) => {
      window.clearTimeout(hideTimer);
      const indicator = ensureIndicator();
      indicator.dataset.state = state;
      indicator.dataset.visible = "true";
      indicator.querySelector("[data-farm-build-label]").textContent = label;
      indicator.querySelector("[data-farm-build-message]").textContent = message;
    };
    const hide = () => {
      const indicator = document.getElementById(indicatorId);
      if (indicator) indicator.dataset.visible = "false";
    };
    const onBeforeUpdate = () => show("building", "Updating", "Farm.js updating");
    const onAfterUpdate = () => {
      show("ready", "Ready", "Farm.js ready");
      hideTimer = window.setTimeout(hide, 500);
    };
    const onError = () => show("error", "Build failed", "Farm.js build failed");
    const onBeforeFullReload = () => {
      try {
        window.sessionStorage.setItem(reloadMarker, "1");
      } catch {}
      show("building", "Updating", "Farm.js updating");
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
