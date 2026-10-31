"use client";

import { useEffect, useId, useRef, useState } from "react";

// Isometric projection: x runs down-right, y runs down-left, z runs up.
const C = Math.cos(Math.PI / 6);
const S = 0.5;
type P3 = [number, number, number];
const iso = ([x, y, z]: P3): [number, number] => [(x - y) * C, (x + y) * S - z];
const pts = (...corners: P3[]) =>
  corners
    .map((corner) =>
      iso(corner)
        .map((n) => n.toFixed(2))
        .join(","),
    )
    .join(" ");

// The computer: one box whose y = BODY.y1 face (down-left) carries the screen.
const BODY = { x0: 0, x1: 58, y0: 0, y1: 50, z0: 0, z1: 84 };
// The keyboard sits in front of the screen.
const KEYS = { x0: -8, x1: 60, y0: 62, y1: 86, z: 4 };
const ROWS = ["1234567890-=", "qwertyuiop[]", "asdfghjkl;'", "zxcvbnm,./"];
const MAX_LENGTH = 48;
const LINE = 19;

// A point on the screen face, in face units: u along x, v up the face.
const front = (u: number, v: number): P3 => [u, BODY.y1, v];
// Maps flat drawing units (u right, w down) onto the screen face.
const frontMatrix = `matrix(${C} ${S} 0 1 ${(-C * BODY.y1).toFixed(3)} ${(S * BODY.y1).toFixed(3)})`;
const GLASS = { u: 8, top: 75, width: 42, height: 36 };

const keyGeometry = (() => {
  const keys: Array<{ id: string; points: string }> = [];
  const rowDepth = (KEYS.y1 - KEYS.y0 - 6) / 5;
  const colWidth = (KEYS.x1 - KEYS.x0 - 6) / 13;
  const key = (id: string, row: number, col: number, span = 1) => {
    const x0 = KEYS.x0 + 3 + col * colWidth + 0.5;
    const x1 = x0 + span * colWidth - 1;
    const y0 = KEYS.y0 + 3 + row * rowDepth + 0.5;
    const y1 = y0 + rowDepth - 1;
    keys.push({
      id,
      points: pts([x0, y0, KEYS.z], [x1, y0, KEYS.z], [x1, y1, KEYS.z], [x0, y1, KEYS.z]),
    });
  };
  ROWS.forEach((row, index) => {
    [...row].forEach((char, col) => key(char, index, col + index * 0.25));
  });
  key("enter", 2, 11.6, 1.4);
  key(" ", 4, 3.5, 6);
  return keys;
})();

// A coiled cable from the back of the keyboard to the front of the computer, across the gap.
const cable = (() => {
  const [ax, ay] = iso([44, KEYS.y0, 2]);
  const [bx, by] = iso([50, BODY.y1, 3]);
  const [qx, qy] = [(ax + bx) / 2 + 6, (ay + by) / 2 + 5];
  const points: string[] = [];
  for (let step = 0; step <= 80; step++) {
    const t = step / 80;
    const x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * qx + t ** 2 * bx;
    const y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * qy + t ** 2 * by;
    const coil = t > 0.15 && t < 0.85 ? Math.sin(t * Math.PI * 14) * 1.2 : 0;
    points.push(`${x.toFixed(2)},${(y + coil).toFixed(2)}`);
  }
  return points.join(" ");
})();

const POWER: P3 = [BODY.x1, 9, 9];
const VIEW = (() => {
  const all = [
    ...[BODY.x0, BODY.x1].flatMap((x) =>
      [BODY.y0, BODY.y1].flatMap((y) => [BODY.z0, BODY.z1].map((z) => iso([x, y, z]))),
    ),
    ...[KEYS.x0, KEYS.x1].flatMap((x) => [KEYS.y0, KEYS.y1].map((y) => iso([x, y, 0]))),
  ];
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const pad = 8;
  return {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };
})();
const powerAt = iso(POWER);

type Screen =
  | { phase: "typing"; text: string }
  | { phase: "asking"; text: string }
  | { phase: "answered"; text: string; allowed: boolean };

const wrap = (text: string) => text.match(new RegExp(`.{1,${LINE}}`, "g")) ?? [""];

/**
 * An early all-in-one computer running Farm.js. Type a request for an agent; Enter asks whether
 * to allow it, and y or n answers. The switch on its side turns it off and on again.
 */
export function DeskComputer() {
  const input = useRef<HTMLInputElement>(null);
  const glow = `dc-glow-${useId().replace(/:/g, "")}`;
  const [on, setOn] = useState(true);
  const [focused, setFocused] = useState(false);
  const [screen, setScreen] = useState<Screen>({ phase: "typing", text: "" });
  const [pressed, setPressed] = useState<string>();

  useEffect(() => {
    if (!pressed) return;
    const release = setTimeout(() => setPressed(undefined), 140);
    return () => clearTimeout(release);
  }, [pressed]);
  useEffect(() => {
    if (screen.phase !== "answered") return;
    const reset = setTimeout(() => setScreen({ phase: "typing", text: "" }), 2600);
    return () => clearTimeout(reset);
  }, [screen]);

  const press = (key: string) => setPressed(key === "Enter" ? "enter" : key.toLowerCase());
  const lines: Array<{ text: string; tone?: "dim" | "bright" }> =
    screen.phase === "typing"
      ? screen.text
        ? wrap(screen.text).map((text) => ({ text }))
        : [{ text: focused ? "" : "click and type", tone: "dim" }]
      : screen.phase === "asking"
        ? [
            { text: "agent wants to:", tone: "dim" },
            ...wrap(screen.text)
              .slice(0, 2)
              .map((text) => ({ text })),
            { text: "allow? y/n", tone: "bright" },
          ]
        : [{ text: screen.allowed ? "✓ allowed" : "✕ denied", tone: "bright" }];
  const status =
    screen.phase === "asking"
      ? `The agent wants to: ${screen.text}. Allow? Press y or n.`
      : screen.phase === "answered"
        ? screen.allowed
          ? "Allowed."
          : "Denied."
        : "";

  return (
    <figure
      className="desk-computer"
      data-power={on ? "on" : "off"}
      data-focused={focused ? "" : undefined}
    >
      <svg
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="An early all-in-one computer showing the Farm.js logo, with a keyboard in front of it"
        onPointerDown={(event) => {
          if (!on) return;
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <defs>
          <radialGradient id={glow} cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <polygon
          className="dc-shadow"
          points={pts(
            [-10, -6, 0],
            [BODY.x1 + 8, -6, 0],
            [BODY.x1 + 8, KEYS.y1 + 6, 0],
            [-10, KEYS.y1 + 6, 0],
          )}
        />

        {/* Body */}
        <polygon
          className="dc-top"
          points={pts(
            [BODY.x0, BODY.y0, BODY.z1],
            [BODY.x1, BODY.y0, BODY.z1],
            [BODY.x1, BODY.y1, BODY.z1],
            [BODY.x0, BODY.y1, BODY.z1],
          )}
        />
        <polygon
          className="dc-side"
          points={pts(
            [BODY.x1, BODY.y0, BODY.z1],
            [BODY.x1, BODY.y1, BODY.z1],
            [BODY.x1, BODY.y1, BODY.z0],
            [BODY.x1, BODY.y0, BODY.z0],
          )}
        />
        <polygon
          className="dc-front"
          points={pts(
            front(BODY.x0, BODY.z1),
            front(BODY.x1, BODY.z1),
            front(BODY.x1, BODY.z0),
            front(BODY.x0, BODY.z0),
          )}
        />
        <polygon
          className="dc-handle"
          points={pts([18, 8, BODY.z1], [40, 8, BODY.z1], [40, 16, BODY.z1], [18, 16, BODY.z1])}
        />
        {Array.from({ length: 7 }, (_, index) => {
          const y = 12 + index * 4;
          return (
            <polyline
              key={y}
              className="dc-vent"
              points={pts([BODY.x1, y, 62], [BODY.x1, y, 70])}
            />
          );
        })}
        <polygon
          className="dc-switch"
          points={pts(
            [BODY.x1, POWER[1] - 1.6, POWER[2] + 1.4],
            [BODY.x1, POWER[1] + 1.6, POWER[2] + 1.4],
            [BODY.x1, POWER[1] + 1.6, POWER[2] - 1.4],
            [BODY.x1, POWER[1] - 1.6, POWER[2] - 1.4],
          )}
        />
        <polygon
          className="dc-led"
          points={pts(
            [BODY.x1, POWER[1] - 0.6, POWER[2] + 3.6],
            [BODY.x1, POWER[1] + 0.6, POWER[2] + 3.6],
            [BODY.x1, POWER[1] + 0.6, POWER[2] + 2.6],
            [BODY.x1, POWER[1] - 0.6, POWER[2] + 2.6],
          )}
        />
        <polygon
          className="dc-bezel"
          points={pts(front(5, 78), front(53, 78), front(53, 36), front(5, 36))}
        />
        <polygon
          className="dc-slot"
          points={pts(front(31, 21), front(50, 21), front(50, 18.6), front(31, 18.6))}
        />

        {/* Screen, drawn flat and mapped onto the front face */}
        <g transform={frontMatrix}>
          <g transform={`translate(${GLASS.u} ${-GLASS.top})`}>
            <rect className="dc-glass" width={GLASS.width} height={GLASS.height} rx="2.5" />
            <rect
              className="dc-glow"
              width={GLASS.width}
              height={GLASS.height}
              rx="2.5"
              fill={`url(#${glow})`}
            />
            <g className="dc-screen">
              {screen.phase === "typing" && !screen.text ? (
                <g
                  className="dc-mark"
                  transform={`translate(${(GLASS.width - 161 * 0.08) / 2} 7) scale(0.08) translate(-125 -68)`}
                >
                  <rect x="125" y="68" width="40" height="40" rx="8" fill="#f5f5f4" />
                  <rect x="177" y="68" width="109" height="40" rx="6" fill="#f5f5f4" />
                  <rect x="125" y="124" width="40" height="40" rx="8" fill="#a3a3a3" />
                  <rect x="177" y="124" width="109" height="40" rx="6" fill="#a3a3a3" />
                  <rect x="125" y="180" width="40" height="40" rx="8" fill="#595959" />
                  <rect x="177" y="180" width="59" height="40" rx="6" fill="#595959" />
                </g>
              ) : null}
              <text className="dc-meta" x="3" y="5">
                farm.js
              </text>
              {screen.phase === "typing" && screen.text ? (
                <text className="dc-meta" x={GLASS.width - 3} y="5" textAnchor="end">
                  {screen.text.length}/{MAX_LENGTH}
                </text>
              ) : null}
              <text
                className="dc-text"
                x="3"
                y={screen.phase === "typing" && !screen.text ? 26 : 12}
              >
                {lines.map((line, index) => (
                  <tspan key={index} x="3" dy={index === 0 ? 0 : 5} data-tone={line.tone}>
                    {index === 0 && screen.phase === "typing" ? "› " : ""}
                    {line.text}
                  </tspan>
                ))}
                {screen.phase === "typing" ? <tspan className="dc-cursor">▌</tspan> : null}
              </text>
            </g>
            <rect className="dc-off" width={GLASS.width} height={GLASS.height} rx="2.5" />
          </g>
          {/* Badge under the screen */}
          <g transform="translate(8 -13) scale(0.03) translate(-125 -68)" className="dc-badge">
            <rect x="125" y="68" width="40" height="40" rx="8" />
            <rect x="177" y="68" width="109" height="40" rx="6" />
            <rect x="125" y="124" width="40" height="40" rx="8" />
            <rect x="177" y="124" width="109" height="40" rx="6" />
          </g>
        </g>

        <polyline className="dc-cable" points={cable} />

        {/* Keyboard */}
        <polygon
          className="dc-side"
          points={pts(
            [KEYS.x1, KEYS.y0, KEYS.z],
            [KEYS.x1, KEYS.y1, KEYS.z],
            [KEYS.x1, KEYS.y1, 0],
            [KEYS.x1, KEYS.y0, 0],
          )}
        />
        <polygon
          className="dc-front"
          points={pts(
            [KEYS.x0, KEYS.y1, KEYS.z],
            [KEYS.x1, KEYS.y1, KEYS.z],
            [KEYS.x1, KEYS.y1, 0],
            [KEYS.x0, KEYS.y1, 0],
          )}
        />
        <polygon
          className="dc-top"
          points={pts(
            [KEYS.x0, KEYS.y0, KEYS.z],
            [KEYS.x1, KEYS.y0, KEYS.z],
            [KEYS.x1, KEYS.y1, KEYS.z],
            [KEYS.x0, KEYS.y1, KEYS.z],
          )}
        />
        {keyGeometry.map((key) => (
          <polygon
            key={key.id}
            className="dc-key"
            data-pressed={pressed === key.id ? "" : undefined}
            points={key.points}
          />
        ))}
      </svg>

      <button
        type="button"
        className="dc-power"
        aria-label={on ? "Turn the computer off" : "Turn the computer on"}
        aria-pressed={on}
        style={{
          left: `${((powerAt[0] - VIEW.x) / VIEW.width) * 100}%`,
          top: `${((powerAt[1] - VIEW.y) / VIEW.height) * 100}%`,
        }}
        onClick={() => {
          setOn((current) => !current);
          setScreen({ phase: "typing", text: "" });
          input.current?.blur();
        }}
      />

      <input
        ref={input}
        className="dc-input"
        aria-label="Type a request for an agent, then press Enter"
        maxLength={MAX_LENGTH}
        disabled={!on}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={screen.phase === "typing" ? screen.text : ""}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          if (screen.phase !== "typing") return;
          const text = event.currentTarget.value.slice(0, MAX_LENGTH);
          const last = text.at(-1);
          if (last && text.length > screen.text.length) press(last);
          setScreen({ phase: "typing", text });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            press("Enter");
            if (screen.phase === "typing" && screen.text.trim())
              setScreen({ phase: "asking", text: screen.text.trim() });
            return;
          }
          if (screen.phase !== "asking") return;
          const answer = event.key.toLowerCase();
          if (answer === "y" || answer === "n") {
            event.preventDefault();
            press(answer);
            setScreen({ phase: "answered", text: screen.text, allowed: answer === "y" });
          }
        }}
      />
      <p className="dc-status" role="status" aria-live="polite">
        {status}
      </p>
      <figcaption>Click the screen and type a request. Enter asks you to allow it.</figcaption>
    </figure>
  );
}
