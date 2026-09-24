// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSyncStore, startSyncRuntime } from "./client.js";
import { useLiveQuery } from "./react.js";

type Row = { id: string; status: string };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  startSyncRuntime({
    path: "/_farm/sync",
    models: { tasks: { key: "id", access: "write" } },
  } as never);
  const store = getSyncStore("tasks");
  store.applyServerRows(
    [
      { id: "1", status: "open" },
      { id: "2", status: "done" },
      { id: "3", status: "open" },
    ],
    { full: true, cursor: null },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useLiveQuery freshness", () => {
  it("recomputes when an inline predicate closes over changed state", async () => {
    let setFilter!: (value: string) => void;
    function List() {
      const [filter, set] = React.useState("open");
      setFilter = set;
      // The documented pattern: an inline predicate over component state.
      const tasks = useLiveQuery("tasks" as never, (row: Row) => row.status === filter);
      return <output>{(tasks.rows as Row[]).map((row) => row.id).join(",")}</output>;
    }

    await act(async () => root.render(<List />));
    expect(container.querySelector("output")?.textContent).toBe("1,3");

    // No row changed - only the state the predicate closes over.
    await act(async () => setFilter("done"));
    expect(container.querySelector("output")?.textContent).toBe("2");
  });

  it("recomputes when options change without a row change", async () => {
    let setLimit!: (value: number) => void;
    function List() {
      const [limit, set] = React.useState(1);
      setLimit = set;
      const tasks = useLiveQuery("tasks" as never, undefined, { limit });
      return <output>{tasks.rows.length}</output>;
    }

    await act(async () => root.render(<List />));
    expect(container.querySelector("output")?.textContent).toBe("1");

    await act(async () => setLimit(3));
    expect(container.querySelector("output")?.textContent).toBe("3");
  });
});
