"use client";
import { useState } from "react";
import { echo, type GraphNode } from "./actions";

const keepsCycle = (node: GraphNode) => node.self === node && node.children[0]?.parent === node;

export function Graph({ node }: { node: GraphNode }) {
  const [clicks, setClicks] = useState(0);
  const [reply, setReply] = useState("");
  return (
    <div>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        {`${node.name} ${keepsCycle(node)} ${clicks}`}
      </button>
      <button
        type="button"
        onClick={async () => {
          const answer = await echo(node);
          setReply(`${answer.name} ${keepsCycle(answer)}`);
        }}
      >
        Echo
      </button>
      <p data-testid="echo">{reply}</p>
    </div>
  );
}
