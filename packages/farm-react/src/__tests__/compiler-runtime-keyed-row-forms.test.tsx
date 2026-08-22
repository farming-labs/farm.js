import React, { StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompilerKeyedRowElement,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface EditableItem {
  id: string;
  label: string;
  note: string;
  done: boolean;
  priority: "low" | "high";
}

interface EditableModel {
  items: EditableItem[];
  selected: string;
}

const roots = new Set<Root>();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function editableRowDescriptor(
  item: EditableItem,
  index: number,
  selected: string,
): CompilerKeyedRowElement {
  return {
    kind: "element",
    tag: "li",
    attributes: [{ name: "data-key", value: item.id }],
    styles: [],
    children: [
      {
        kind: "element",
        tag: "input",
        attributes: [
          { name: "aria-label", value: `Label ${item.id}` },
          { name: "value", value: item.label },
        ],
        styles: [],
        children: [],
      },
      {
        kind: "element",
        tag: "textarea",
        attributes: [
          { name: "aria-label", value: `Note ${item.id}` },
          { name: "value", value: item.note },
        ],
        styles: [],
        children: [],
      },
      {
        kind: "element",
        tag: "input",
        attributes: [
          { name: "aria-label", value: `Done ${item.id}` },
          { name: "checked", value: item.done },
          { name: "type", value: "checkbox" },
        ],
        styles: [],
        children: [],
      },
      {
        kind: "element",
        tag: "select",
        attributes: [
          { name: "aria-label", value: `Priority ${item.id}` },
          { name: "value", value: item.priority },
        ],
        styles: [],
        children: [
          {
            kind: "element",
            tag: "option",
            attributes: [{ name: "value", value: "low" }],
            styles: [],
            children: ["Low"],
          },
          {
            kind: "element",
            tag: "option",
            attributes: [{ name: "value", value: "high" }],
            styles: [],
            children: ["High"],
          },
        ],
      },
      {
        kind: "element",
        tag: "input",
        attributes: [
          { name: "aria-label", value: `Selected ${item.id}` },
          { name: "checked", value: selected === item.id },
          { name: "name", value: "selected-row" },
          { name: "type", value: "radio" },
        ],
        styles: [],
        children: [],
      },
      {
        kind: "element",
        tag: "output",
        attributes: [],
        styles: [],
        children: [
          `${index}:${item.label}:${item.note}:${item.done ? "done" : "open"}:${item.priority}:${selected === item.id ? "selected" : "idle"}`,
        ],
      },
    ],
  };
}

function defineEditableRows(metrics: { executions: number; listRenders: number }) {
  let updateModel: (next: CompilerStateUpdater) => void = () => undefined;
  let readModel: () => EditableModel = () => ({ items: [], selected: "" });
  const compositionEvents: string[] = [];
  const initial: EditableModel = {
    items: [
      { id: "a", label: "Alpha", note: "Ready", done: false, priority: "low" },
      { id: "b", label: "Beta", note: "Review", done: true, priority: "high" },
    ],
    selected: "a",
  };

  const EditableRows = createCompiledComponent({
    displayName: "EditableKeyedRows",
    initialize: () => [initial],
    render(_props: Record<string, never>, state, blocks) {
      metrics.executions += 1;
      updateModel = (next) => state[0].set(next);
      const model = () => state[0].get() as EditableModel;
      readModel = model;
      const items = () => model().items;
      const updateItem = (id: string, patch: Partial<EditableItem>) =>
        state[0].set((current) => {
          const value = current as EditableModel;
          return {
            ...value,
            items: value.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
          };
        });
      const KeyedRows = blocks.KeyedRows;
      return (
        <main>
          <KeyedRows
            bindings={[
              {
                kind: "attribute",
                name: "value",
                path: [0],
                read: (item) => (item as EditableItem).label,
              },
              {
                kind: "attribute",
                name: "value",
                path: [1],
                read: (item) => (item as EditableItem).note,
              },
              {
                kind: "attribute",
                name: "checked",
                path: [2],
                read: (item) => (item as EditableItem).done,
              },
              {
                kind: "attribute",
                name: "value",
                path: [3],
                read: (item) => (item as EditableItem).priority,
              },
              {
                kind: "attribute",
                name: "checked",
                path: [4],
                read: (item) => model().selected === (item as EditableItem).id,
              },
              {
                kind: "text",
                path: [5],
                read: (item, index) => {
                  const row = item as EditableItem;
                  return [
                    index,
                    ":",
                    row.label,
                    ":",
                    row.note,
                    ":",
                    row.done ? "done" : "open",
                    ":",
                    row.priority,
                    ":",
                    model().selected === row.id ? "selected" : "idle",
                  ];
                },
              },
            ]}
            create={(item, index) =>
              editableRowDescriptor(item as EditableItem, index, model().selected)
            }
            events={[
              {
                name: "onInput",
                invoke: (item, _index, event) =>
                  updateItem((item as EditableItem).id, {
                    label: (event.currentTarget as HTMLInputElement).value,
                  }),
              },
              {
                name: "onInput",
                invoke: (item, _index, event) =>
                  updateItem((item as EditableItem).id, {
                    note: (event.currentTarget as HTMLTextAreaElement).value,
                  }),
              },
              {
                name: "onChange",
                invoke: (item, _index, event) =>
                  updateItem((item as EditableItem).id, {
                    done: (event.currentTarget as HTMLInputElement).checked,
                  }),
              },
              {
                name: "onChange",
                invoke: (item, _index, event) =>
                  updateItem((item as EditableItem).id, {
                    priority: (event.currentTarget as HTMLSelectElement)
                      .value as EditableItem["priority"],
                  }),
              },
              {
                name: "onChange",
                invoke: (item) =>
                  state[0].set((current) => ({
                    ...(current as EditableModel),
                    selected: (item as EditableItem).id,
                  })),
              },
              {
                name: "onCompositionStart",
                invoke: (item) => compositionEvents.push(`start:${(item as EditableItem).id}`),
              },
              {
                name: "onCompositionUpdate",
                invoke: (item) => compositionEvents.push(`update:${(item as EditableItem).id}`),
              },
              {
                name: "onCompositionEnd",
                invoke: (item) => compositionEvents.push(`end:${(item as EditableItem).id}`),
              },
            ]}
            id={0}
            items={items}
            render={(rowEvent) => {
              metrics.listRenders += 1;
              return (
                <ul>
                  {items().map((item, index) => (
                    <li data-key={item.id} key={item.id}>
                      <input
                        aria-label={`Label ${item.id}`}
                        onInput={rowEvent(item, index, 0)}
                        value={item.label}
                      />
                      <textarea
                        aria-label={`Note ${item.id}`}
                        onCompositionEnd={rowEvent(item, index, 7)}
                        onCompositionStart={rowEvent(item, index, 5)}
                        onCompositionUpdate={rowEvent(item, index, 6)}
                        onInput={rowEvent(item, index, 1)}
                        value={item.note}
                      />
                      <input
                        aria-label={`Done ${item.id}`}
                        checked={item.done}
                        onChange={rowEvent(item, index, 2)}
                        type="checkbox"
                      />
                      <select
                        aria-label={`Priority ${item.id}`}
                        onChange={rowEvent(item, index, 3)}
                        value={item.priority}
                      >
                        <option value="low">Low</option>
                        <option value="high">High</option>
                      </select>
                      <input
                        aria-label={`Selected ${item.id}`}
                        checked={model().selected === item.id}
                        name="selected-row"
                        onChange={rowEvent(item, index, 4)}
                        type="radio"
                      />
                      <output>
                        {index}:{item.label}:{item.note}:{item.done ? "done" : "open"}:
                        {item.priority}:{model().selected === item.id ? "selected" : "idle"}
                      </output>
                    </li>
                  ))}
                </ul>
              );
            }}
            rowKey={(item) => (item as EditableItem).id}
          />
        </main>
      );
    },
    bindings: [{ kind: "block", id: 0, dependencies: [0] }],
  });

  return {
    EditableRows,
    compositionEvents,
    initial,
    readModel: () => readModel(),
    updateModel: (next: CompilerStateUpdater) => updateModel(next),
  };
}

describe("compiled editable keyed-row runtime", () => {
  it("patches text, textarea, checkbox, select, and radio state by key without rerendering", async () => {
    const metrics = { executions: 0, listRenders: 0 };
    const { EditableRows } = defineEditableRows(metrics);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<EditableRows />));
    const initialExecutions = metrics.executions;
    const initialListRenders = metrics.listRenders;
    const alphaRow = container.querySelector<HTMLLIElement>('[data-key="a"]')!;
    const betaRow = container.querySelector<HTMLLIElement>('[data-key="b"]')!;
    const alphaLabel = alphaRow.querySelector<HTMLInputElement>('[aria-label="Label a"]')!;

    await act(async () => {
      alphaLabel.focus();
      alphaLabel.value = "AlXpha";
      alphaLabel.setSelectionRange(3, 3);
      alphaLabel.dispatchEvent(new InputEvent("input", { bubbles: true, data: "X" }));
      alphaLabel.value = "Alpha";
      await flushCompilerUpdates();
    });
    expect(alphaLabel.value).toBe("AlXpha");
    expect(alphaLabel.selectionStart).toBe(3);
    expect(alphaLabel.selectionEnd).toBe(3);

    await act(async () => {
      alphaRow.querySelector<HTMLInputElement>('[aria-label="Done a"]')!.click();
      const priority = alphaRow.querySelector<HTMLSelectElement>('[aria-label="Priority a"]')!;
      priority.value = "high";
      priority.dispatchEvent(new Event("change", { bubbles: true }));
      betaRow.querySelector<HTMLInputElement>('[aria-label="Selected b"]')!.click();
      await flushCompilerUpdates();
    });

    expect(alphaRow.querySelector<HTMLInputElement>('[aria-label="Done a"]')!.checked).toBe(true);
    expect(alphaRow.querySelector<HTMLSelectElement>('[aria-label="Priority a"]')!.value).toBe(
      "high",
    );
    expect(alphaRow.querySelector<HTMLInputElement>('[aria-label="Selected a"]')!.checked).toBe(
      false,
    );
    expect(betaRow.querySelector<HTMLInputElement>('[aria-label="Selected b"]')!.checked).toBe(
      true,
    );
    expect(alphaRow.querySelector("output")?.textContent).toBe("0:AlXpha:Ready:done:high:idle");
    expect(metrics.executions).toBe(initialExecutions);
    expect(metrics.listRenders).toBe(initialListRenders);
  });

  it("keeps IME composition order, the final value, and caret under React ownership", async () => {
    const metrics = { executions: 0, listRenders: 0 };
    const { EditableRows, compositionEvents } = defineEditableRows(metrics);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<EditableRows />));
    const note = container.querySelector<HTMLTextAreaElement>('[aria-label="Note a"]')!;
    const initialExecutions = metrics.executions;

    await act(async () => {
      note.focus();
      note.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      note.value = "Ready 日本";
      note.setSelectionRange(8, 8);
      note.dispatchEvent(
        new CompositionEvent("compositionupdate", { bubbles: true, data: "日本" }),
      );
      note.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "日本", isComposing: true }),
      );
      note.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
      note.value = "Ready";
      await flushCompilerUpdates();
    });

    expect(compositionEvents).toEqual(["start:a", "update:a", "end:a"]);
    expect(note.value).toBe("Ready 日本");
    expect(note.selectionStart).toBe(8);
    expect(note.selectionEnd).toBe(8);
    expect(container.querySelector('[data-key="a"] output')?.textContent).toContain("Ready 日本");
    expect(metrics.executions).toBe(initialExecutions);
  });

  it("preserves the focused control, selection, DOM identity, and latest index across reorders", async () => {
    const metrics = { executions: 0, listRenders: 0 };
    const { EditableRows, updateModel } = defineEditableRows(metrics);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.add(root);
    await act(async () => root.render(<EditableRows />));
    const betaRow = container.querySelector<HTMLLIElement>('[data-key="b"]')!;
    const betaInput = betaRow.querySelector<HTMLInputElement>('[aria-label="Label b"]')!;
    betaInput.focus();
    betaInput.setSelectionRange(1, 3);

    await act(async () => {
      updateModel((current) => ({
        ...(current as EditableModel),
        items: [...(current as EditableModel).items].reverse(),
      }));
      await flushCompilerUpdates();
    });

    expect(container.querySelector('[data-key="b"]')).toBe(betaRow);
    expect(container.querySelector('[aria-label="Label b"]')).toBe(betaInput);
    expect(document.activeElement).toBe(betaInput);
    expect(betaInput.selectionStart).toBe(1);
    expect(betaInput.selectionEnd).toBe(3);
    expect(betaRow.querySelector("output")?.textContent).toBe("0:Beta:Review:done:high:idle");
    expect(metrics.executions).toBe(1);
    expect(metrics.listRenders).toBe(2);

    await act(async () => {
      betaInput.value = "Beta moved";
      betaInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await flushCompilerUpdates();
    });
    expect(betaRow.querySelector("output")?.textContent).toContain("0:Beta moved:");
    expect(metrics.listRenders).toBe(2);
  });

  it("hydrates in StrictMode, recovers mismatches, and drops a queued edit after unmount", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const metrics = { executions: 0, listRenders: 0 };
    const { EditableRows } = defineEditableRows(metrics);
    const serverHtml = renderToString(
      <StrictMode>
        <EditableRows />
      </StrictMode>,
    );
    const container = document.createElement("div");
    container.innerHTML = serverHtml.replace(
      /<output>.*?<\/output>/,
      "<output>Server mismatch</output>",
    );
    document.body.append(container);
    const recoverable = vi.fn();
    const root = hydrateRoot(
      container,
      <StrictMode>
        <EditableRows />
      </StrictMode>,
      { onRecoverableError: recoverable },
    );
    roots.add(root);
    await act(async () => flushCompilerUpdates());

    const input = container.querySelector<HTMLInputElement>('[aria-label="Label a"]')!;
    expect(input.value).toBe("Alpha");
    expect(recoverable).toHaveBeenCalled();
    await act(async () => {
      input.value = "Hydrated";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await flushCompilerUpdates();
    });
    expect(input.value).toBe("Hydrated");

    await act(async () => {
      input.value = "Dropped";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      root.unmount();
      await flushCompilerUpdates();
    });
    roots.delete(root);
    expect(container.innerHTML).toBe("");
  });

  it("matches normal React across 2,000 deterministic edits and structural transitions", async () => {
    const metrics = { executions: 0, listRenders: 0 };
    const compiled = defineEditableRows(metrics);
    let normalModel = compiled.initial;
    let setNormal: React.Dispatch<React.SetStateAction<EditableModel>> = () => undefined;

    function NormalRows() {
      const [model, setModel] = useState(compiled.initial);
      normalModel = model;
      setNormal = setModel;
      return (
        <ul>
          {model.items.map((item, index) => (
            <li data-key={item.id} key={item.id}>
              <input aria-label={`Label ${item.id}`} readOnly value={item.label} />
              <textarea aria-label={`Note ${item.id}`} readOnly value={item.note} />
              <input aria-label={`Done ${item.id}`} checked={item.done} readOnly type="checkbox" />
              <select aria-label={`Priority ${item.id}`} readOnly value={item.priority}>
                <option value="low">Low</option>
                <option value="high">High</option>
              </select>
              <input
                aria-label={`Selected ${item.id}`}
                checked={model.selected === item.id}
                name="normal-selected-row"
                readOnly
                type="radio"
              />
              <output>
                {index}:{item.label}:{item.note}:{item.done ? "done" : "open"}:{item.priority}:
                {model.selected === item.id ? "selected" : "idle"}
              </output>
            </li>
          ))}
        </ul>
      );
    }

    const compiledContainer = document.createElement("div");
    const normalContainer = document.createElement("div");
    document.body.append(compiledContainer, normalContainer);
    const compiledRoot = createRoot(compiledContainer);
    const normalRoot = createRoot(normalContainer);
    roots.add(compiledRoot);
    roots.add(normalRoot);
    await act(async () => {
      compiledRoot.render(<compiled.EditableRows />);
      normalRoot.render(<NormalRows />);
    });

    let seed = 0x5a17c9e3;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const operations = Array.from({ length: 2000 }, (_, step) => ({
      operation: random() % 8,
      selector: random(),
      step,
    }));
    const update = (model: EditableModel, step: number): EditableModel => {
      const { operation, selector } = operations[step];
      if (operation <= 4 && model.items.length > 0) {
        const target = selector % model.items.length;
        const item = model.items[target];
        const items = model.items.map((row, index) => {
          if (index !== target) return row;
          if (operation === 0) return { ...row, label: `${row.label}.${step}` };
          if (operation === 1) return { ...row, note: step % 3 === 0 ? "" : `Note ${step}` };
          if (operation === 2) return { ...row, done: !row.done };
          if (operation === 3) {
            return { ...row, priority: row.priority === "low" ? "high" : "low" };
          }
          return row;
        });
        return operation === 4 ? { ...model, selected: item.id } : { ...model, items };
      }
      if (operation === 5 && model.items.length < 24) {
        const id = `n${step}`;
        return {
          ...model,
          items: [...model.items, { id, label: id, note: "", done: false, priority: "low" }],
        };
      }
      if (operation === 6 && model.items.length > 1) {
        return { ...model, items: [...model.items].reverse() };
      }
      if (model.items.length > 2) {
        const removed = selector % model.items.length;
        const items = model.items.filter((_, index) => index !== removed);
        return {
          items,
          selected: items.some((item) => item.id === model.selected) ? model.selected : items[0].id,
        };
      }
      return model;
    };
    const snapshot = (container: Element) =>
      [...container.querySelectorAll<HTMLLIElement>("li")].map((row) => {
        const inputs = row.querySelectorAll<HTMLInputElement>("input");
        return [
          row.dataset.key,
          inputs[0].value,
          row.querySelector("textarea")?.value,
          inputs[1].checked,
          row.querySelector("select")?.value,
          inputs[2].checked,
          row.querySelector("output")?.textContent,
        ];
      });

    for (let offset = 0; offset < 2000; offset += 20) {
      await act(async () => {
        for (let step = offset; step < offset + 20; step += 1) {
          const updater = (current: EditableModel) => update(current, step);
          compiled.updateModel((current) => updater(current as EditableModel));
          setNormal(updater);
        }
        await flushCompilerUpdates();
      });
      expect(compiled.readModel(), `model after batch ${offset}`).toEqual(normalModel);
      expect(snapshot(compiledContainer), `DOM after batch ${offset}`).toEqual(
        snapshot(normalContainer),
      );
    }

    expect(metrics.executions).toBe(1);
    expect(metrics.listRenders).toBeLessThanOrEqual(101);
  }, 30_000);
});
