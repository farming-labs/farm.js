import type { CanvasHTMLAttributes } from "react";

export type DitherMode = "bayer" | "halftone" | "noise" | "crosshatch";
export type ColorMode = "original" | "grayscale" | "duotone" | "custom";

export interface DitherShaderProps extends Omit<
  CanvasHTMLAttributes<HTMLCanvasElement>,
  "children"
> {
  src?: string;
  gridSize?: number;
  ditherMode?: DitherMode;
  colorMode?: ColorMode;
  invert?: boolean;
  animated?: boolean;
  animationSpeed?: number;
  primaryColor?: string;
  secondaryColor?: string;
  threshold?: number;
}

interface DitherShaderScriptConfig {
  gridSize: number;
  ditherMode: DitherMode;
  colorMode: ColorMode;
  invert: boolean;
  animated: boolean;
  animationSpeed: number;
  primaryColor: string;
  secondaryColor: string;
  threshold: number;
}

function createDitherScript(config: DitherShaderScriptConfig) {
  const serializedConfig = JSON.stringify(config).replace(/</g, "\\u003c");

  return `
(function () {
  var script = document.currentScript;
  var canvas = script && script.previousElementSibling;
  var config = ${serializedConfig};

  if (!canvas || canvas.dataset.farmDitherMounted === "true") {
    return;
  }

  canvas.dataset.farmDitherMounted = "true";

  if (!window.__farmDitherShaderMount) {
    window.__farmDitherShaderMount = function (canvas, config) {
      var context = canvas.getContext("2d", { alpha: true });

      if (!context) {
        return;
      }

      var bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      var deviceScale = Math.min(window.devicePixelRatio || 1, 2);
      var resizeObserver = null;
      var frameId = 0;
      var lastRender = 0;
      var pointerX = 0.5;
      var pointerY = 0.72;
      var targetPointerX = 0.5;
      var targetPointerY = 0.72;
      var pointerActive = false;

      function clamp(value, min, max) {
        return Math.min(max == null ? 1 : max, Math.max(min == null ? 0 : min, value));
      }

      function smoothstep(edge0, edge1, value) {
        var t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
      }

      function hash(x, y, time) {
        var value = Math.sin(x * 127.1 + y * 311.7 + time * 43.13) * 43758.5453123;
        return value - Math.floor(value);
      }

      function handlePointerMove(event) {
        var rect = canvas.getBoundingClientRect();

        if (!rect.width || !rect.height) {
          return;
        }

        targetPointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        targetPointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        pointerActive = true;

        if (!config.animated) {
          pointerX = targetPointerX;
          pointerY = targetPointerY;
          render(performance.now());
        }
      }

      function parseHexColor(hex) {
        var normalized = String(hex || "").replace("#", "");

        if (normalized.length === 3) {
          normalized = normalized
            .split("")
            .map(function (part) {
              return part + part;
            })
            .join("");
        }

        normalized = (normalized + "000000").slice(0, 6);

        function channel(value) {
          var parsed = Number.parseInt(value, 16);
          return Number.isNaN(parsed) ? 255 : parsed;
        }

        return [
          channel(normalized.slice(0, 2)),
          channel(normalized.slice(2, 4)),
          channel(normalized.slice(4, 6)),
        ];
      }

      function getPatternThreshold(mode, x, y, threshold, time) {
        if (mode === "halftone") {
          var dot = Math.hypot((x % 7) - 3, (y % 7) - 3) / 4.4;
          return threshold + (dot - 0.5) * 0.52;
        }

        if (mode === "noise") {
          return threshold + (hash(x, y, time) - 0.5) * 0.56;
        }

        if (mode === "crosshatch") {
          var hatch = (x + y) % 9 === 0 || Math.abs(x - y) % 9 === 0 ? -0.2 : 0.18;
          return threshold + hatch;
        }

        var bayer = (bayer4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
        return threshold + (bayer - 0.5) * 0.5;
      }

      function render(timeMs) {
        var width = canvas.width;
        var height = canvas.height;
        var cellSize = Math.max(1, Math.round(config.gridSize * deviceScale));
        var time = config.animated ? timeMs * config.animationSpeed * 0.001 : 0;
        var lightColor =
          config.colorMode === "duotone" || config.colorMode === "custom"
            ? parseHexColor(config.secondaryColor)
            : [255, 255, 255];
        var darkColor =
          config.colorMode === "duotone" || config.colorMode === "custom"
            ? parseHexColor(config.primaryColor)
            : [0, 0, 0];

        pointerX += (targetPointerX - pointerX) * 0.16;
        pointerY += (targetPointerY - pointerY) * 0.16;

        context.clearRect(0, 0, width, height);

        for (var y = 0; y < height; y += cellSize) {
          for (var x = 0; x < width; x += cellSize) {
            var column = Math.floor(x / cellSize);
            var row = Math.floor(y / cellSize);
            var nx = width > 0 ? x / width : 0;
            var ny = height > 0 ? y / height : 0;
            var lowerFade = smoothstep(0.26, 1, ny);
            var heroGlow = 1 - Math.min(1, Math.hypot(nx - 0.5, (ny - 0.72) * 0.78) * 1.45);
            var cursorDistance = Math.hypot(nx - pointerX, (ny - pointerY) * 1.18);
            var cursorWake = pointerActive ? Math.max(0, 1 - cursorDistance * 3.15) : 0;
            var cursorRipple = Math.sin(cursorDistance * 44 - time * 130) * cursorWake * 0.16;
            var drift =
              Math.sin(nx * 18 + time * 42) * 0.09 +
              Math.sin((nx + ny) * 24 - time * 37) * 0.07 +
              Math.sin((nx - pointerX) * 36 + (ny - pointerY) * 20 + time * 62) * cursorWake * 0.08 +
              cursorRipple;
            var grain =
              hash(
                column + Math.floor(pointerX * 29),
                row + Math.floor(pointerY * 31),
                Math.floor(time * 5),
              ) *
              (0.36 + cursorWake * 0.16);
            var luminance = lowerFade * (0.18 + heroGlow * 0.42 + cursorWake * 0.34 + grain + drift);

            luminance = clamp(config.invert ? 1 - luminance : luminance, 0, 1);

            var patternThreshold = getPatternThreshold(
              config.ditherMode,
              column,
              row,
              config.threshold - cursorWake * 0.08,
              time,
            );

            if (luminance <= patternThreshold) {
              continue;
            }

            var alpha = clamp(
              (luminance - patternThreshold) * 2 + lowerFade * 0.04 + cursorWake * 0.12,
              0.04,
              0.62,
            );
            var color =
              config.colorMode === "original" && luminance < 0.68
                ? darkColor
                : config.colorMode === "grayscale"
                  ? [255, 255, 255]
                  : lightColor;

            context.fillStyle = "rgba(" + color[0] + ", " + color[1] + ", " + color[2] + ", " + alpha + ")";

            if (config.ditherMode === "halftone") {
              context.beginPath();
              context.arc(
                x + cellSize / 2,
                y + cellSize / 2,
                clamp(luminance, 0.18, 0.92) * cellSize * 0.48,
                0,
                Math.PI * 2,
              );
              context.fill();
            } else {
              context.fillRect(x, y, Math.ceil(cellSize * 0.88), Math.ceil(cellSize * 0.88));
            }
          }
        }
      }

      function resize() {
        var rect = canvas.getBoundingClientRect();
        var width = Math.max(1, Math.floor(rect.width * deviceScale));
        var height = Math.max(1, Math.floor(rect.height * deviceScale));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        render(performance.now());
      }

      function tick(timeMs) {
        if (timeMs - lastRender > 58) {
          render(timeMs);
          lastRender = timeMs;
        }

        if (config.animated) {
          frameId = requestAnimationFrame(tick);
        }
      }

      resize();

      if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
      } else {
        window.addEventListener("resize", resize);
      }

      window.addEventListener("pointermove", handlePointerMove, { passive: true });

      if (config.animated) {
        frameId = requestAnimationFrame(tick);
      }

      canvas.__farmDitherDestroy = function () {
        if (frameId) {
          cancelAnimationFrame(frameId);
        }

        if (resizeObserver) {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener("resize", resize);
        }

        window.removeEventListener("pointermove", handlePointerMove);
      };
    };
  }

  window.__farmDitherShaderMount(canvas, config);
})();
`;
}

export function DitherShader({
  className,
  gridSize = 3,
  ditherMode = "bayer",
  colorMode = "duotone",
  invert = false,
  animated = false,
  animationSpeed = 0.025,
  primaryColor = "#000000",
  secondaryColor = "#ffffff",
  threshold = 0.5,
  src: _src,
  ...props
}: DitherShaderProps) {
  const script = createDitherScript({
    gridSize,
    ditherMode,
    colorMode,
    invert,
    animated,
    animationSpeed,
    primaryColor,
    secondaryColor,
    threshold,
  });

  return (
    <>
      <canvas suppressHydrationWarning className={className} {...props} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
