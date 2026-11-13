"use client";
import { useState, type ReactNode } from "react";
import { echo, join, run } from "./actions";

class Point {
  constructor(readonly x: number) {}
}
const pick = () => "picked";

export function RoundTripView({ greet }: { greet: (...names: string[]) => Promise<string> }) {
  const [echoed, setEchoed] = useState<{ text: string; badge: ReactNode } | null>(null);
  const [ran, setRan] = useState("");
  const [greeted, setGreeted] = useState("");
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const point = new Point(1);
          const badge = <b data-testid="badge">sent from the browser</b>;
          const reply = await echo({ point, pick, badge });
          setEchoed({
            text: [reply.point === point, reply.pick === pick, reply.badge === badge]
              .map(String)
              .join(" "),
            badge: reply.badge as ReactNode,
          });
        }}
      >
        Echo
      </button>
      <p data-testid="echo">{echoed?.text}</p>
      {echoed?.badge}
      <button type="button" onClick={async () => setRan(await run(join.bind(null, "bound"), "call"))}>
        Run
      </button>
      <p data-testid="run">{ran}</p>
      <button
        type="button"
        onClick={async () =>
          setGreeted(`${await greet("kinfe")}, ${await run(greet.bind(null, "bound"), "call")}`)
        }
      >
        Greet
      </button>
      <p data-testid="greet">{greeted}</p>
    </div>
  );
}
