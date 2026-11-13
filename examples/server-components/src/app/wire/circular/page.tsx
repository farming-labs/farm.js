import type { GraphNode } from "./actions";
import { Graph } from "./graph";

export default function CircularPage() {
  const node: GraphNode = { name: "root", children: [] };
  node.self = node;
  node.children.push({ parent: node });
  return (
    <section>
      <h1>Circular</h1>
      <Graph node={node} />
    </section>
  );
}
