// What /after's after() callback recorded, by token, for /api/after to report. Kept on globalThis
// so the page and the API route share it however the server loads their modules, on any runtime
// (a worker has no filesystem the test could read).
export interface AfterRecord {
  token: string;
  scheduledAt: number;
  completedAt: number;
}

const key = Symbol.for("farm.contract.after-log");

export function afterLog(): Map<string, AfterRecord> {
  const store = globalThis as { [key]?: Map<string, AfterRecord> };
  return (store[key] ??= new Map());
}
