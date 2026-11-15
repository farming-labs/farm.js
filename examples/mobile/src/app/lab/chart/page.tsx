"use client";

import { useEffect, useRef } from "react";

const READINGS = [12, 9, 14, 18, 15, 11];

/**
 * Deliberately web-only: a canvas drawn through a DOM ref, a table, and window. The report lists
 * each blocker with its file, line, and column.
 */
export default function ChartPage() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const scale = window.devicePixelRatio || 1;
    context.scale(scale, scale);
    READINGS.forEach((value, index) => {
      context.fillStyle = "#1f6f43";
      context.fillRect(index * 40 + 10, 120 - value * 5, 28, value * 5);
    });
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1>Temperature</h1>
      <canvas ref={canvas} width={260} height={130} data-testid="chart" />
      <table>
        <tbody>
          {READINGS.map((value, index) => (
            <tr key={index}>
              <td>{`${6 + index * 2}:00`}</td>
              <td>{value} °C</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
