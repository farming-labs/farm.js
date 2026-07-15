"use client";

import { useCallback, useEffect, useRef } from "react";

export type FlickeringGridProps = {
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
  maxOpacity?: number;
};

type GridState = {
  cols: number;
  rows: number;
  squares: Float32Array;
  width: number;
  height: number;
};

export function FlickeringGrid({
  squareSize = 4,
  gridGap = 6,
  flickerChance = 0.3,
  color = "rgb(255, 255, 255)",
  width,
  height,
  className,
  maxOpacity = 0.3,
}: FlickeringGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const setupCanvas = useCallback(
    (canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): GridState => {
      const dpr = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");

      canvas.width = Math.ceil(cssWidth * dpr);
      canvas.height = Math.ceil(cssHeight * dpr);
      canvas.style.width = cssWidth + "px";
      canvas.style.height = cssHeight + "px";
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cellSize = squareSize + gridGap;
      const cols = Math.ceil(cssWidth / cellSize);
      const rows = Math.ceil(cssHeight / cellSize);
      const squares = new Float32Array(cols * rows);

      for (let index = 0; index < squares.length; index += 1) {
        squares[index] = Math.random() * maxOpacity;
      }

      return { cols, rows, squares, width: cssWidth, height: cssHeight };
    },
    [gridGap, maxOpacity, squareSize],
  );

  const drawGrid = useCallback(
    (context: CanvasRenderingContext2D, grid: GridState) => {
      context.clearRect(0, 0, grid.width, grid.height);

      for (let col = 0; col < grid.cols; col += 1) {
        for (let row = 0; row < grid.rows; row += 1) {
          const opacity = grid.squares[col * grid.rows + row];
          context.globalAlpha = opacity;
          context.fillStyle = color;
          context.fillRect(
            col * (squareSize + gridGap),
            row * (squareSize + gridGap),
            squareSize,
            squareSize,
          );
        }
      }

      context.globalAlpha = 1;
    },
    [color, gridGap, squareSize],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !container || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let grid = setupCanvas(
      canvas,
      width || container.clientWidth,
      height || container.clientHeight,
    );
    let animationFrame: number | undefined;
    let isInView = false;
    let lastFrame = 0;

    const draw = () => drawGrid(context, grid);

    const stop = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    };

    const animate = (time: number) => {
      if (!isInView || reducedMotion.matches) {
        stop();
        return;
      }

      const elapsed = time - lastFrame;
      if (elapsed >= 42) {
        const chance = flickerChance * (elapsed / 1000);
        for (let index = 0; index < grid.squares.length; index += 1) {
          if (Math.random() < chance) grid.squares[index] = Math.random() * maxOpacity;
        }
        draw();
        lastFrame = time;
      }

      animationFrame = requestAnimationFrame(animate);
    };

    const start = () => {
      if (animationFrame !== undefined || !isInView || reducedMotion.matches) return;
      lastFrame = performance.now();
      animationFrame = requestAnimationFrame(animate);
    };

    const resize = () => {
      grid = setupCanvas(canvas, width || container.clientWidth, height || container.clientHeight);
      draw();
    };

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isInView = entry?.isIntersecting ?? false;
      if (isInView) start();
      else stop();
    });
    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        stop();
        draw();
      } else {
        start();
      }
    };

    draw();
    resizeObserver.observe(container);
    intersectionObserver.observe(canvas);
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      reducedMotion.removeEventListener("change", handleMotionPreference);
    };
  }, [drawGrid, flickerChance, height, maxOpacity, setupCanvas, width]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={["relative h-full w-full", className].filter(Boolean).join(" ")}
    >
      <canvas ref={canvasRef} className="pointer-events-none block size-full" />
    </div>
  );
}
