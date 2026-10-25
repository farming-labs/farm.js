import Module from "node:module";

/**
 * `pnpm exec` exports NODE_PATH pointing at the workspace's hoisted
 * `.pnpm/node_modules`, so every package resolves from any directory inside
 * the test process. Apps do not run with it; clear it to test missing packages.
 */
export async function withoutNodePath<T>(run: () => T | Promise<T>): Promise<T> {
  const nodePath = process.env.NODE_PATH;
  const initPaths = (Module as unknown as { _initPaths(): void })._initPaths;
  delete process.env.NODE_PATH;
  initPaths();
  try {
    return await run();
  } finally {
    if (nodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = nodePath;
    initPaths();
  }
}
