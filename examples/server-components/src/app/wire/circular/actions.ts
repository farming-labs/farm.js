"use server";

export type GraphNode = { name: string; self?: GraphNode; children: Array<{ parent: GraphNode }> };

// Answers with a node that refers to itself, after checking the one it received does.
export async function echo(node: GraphNode) {
  const reply: GraphNode = {
    name: `${node.name} ${node.self === node && node.children[0]?.parent === node}`,
    children: [],
  };
  reply.self = reply;
  reply.children.push({ parent: reply });
  return reply;
}
