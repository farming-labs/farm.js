import React, { Profiler, StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompiledComponent,
  type CompiledComponentDefinition,
  type CompilerHostElement,
  type CompilerKeyedRowBinding,
  type CompilerStateUpdater,
} from "../compiler-runtime";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface Card {
  id: string;
  title: string;
  done: boolean;
  fail?: boolean;
}

interface Column {
  id: string;
  name: string;
  cards: Card[];
}

interface Board {
  id: string;
  name: string;
  columns: Column[];
}

const initialBoards: Board[] = [
  {
    id: "a",
    name: "Alpha",
    columns: [
      {
        id: "a1",
        name: "Ideas",
        cards: [
          { id: "a1c1", title: "Explore", done: false },
          { id: "a1c2", title: "Draft", done: true },
        ],
      },
      {
        id: "a2",
        name: "Ready",
        cards: [
          { id: "a2c1", title: "Review", done: false },
          { id: "a2c2", title: "Approve", done: true },
        ],
      },
    ],
  },
  {
    id: "b",
    name: "Beta",
    columns: [
      {
        id: "b1",
        name: "Plan",
        cards: [
          { id: "b1c1", title: "Scope", done: false },
          { id: "b1c2", title: "Estimate", done: true },
        ],
      },
      {
        id: "b2",
        name: "Build",
        cards: [
          { id: "b2c1", title: "Compile", done: false },
          { id: "b2c2", title: "Test", done: true },
          { id: "b2c3", title: "Ship", done: false },
        ],
      },
      {
        id: "b3",
        name: "Observe",
        cards: [
          { id: "b3c1", title: "Measure", done: false },
          { id: "b3c2", title: "Report", done: true },
        ],
      },
    ],
  },
  {
    id: "c",
    name: "Gamma",
    columns: [
      {
        id: "c1",
        name: "Queue",
        cards: [
          { id: "c1c1", title: "One", done: false },
          { id: "c1c2", title: "Two", done: true },
        ],
      },
    ],
  },
];

const roots: Array<{ unmount(): void }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function flushCompilerUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function host(
  tag: string,
  children: readonly unknown[] = [],
  attributes: readonly { name: string; value: unknown }[] = [],
  styles: readonly { name: string; value: unknown }[] = [],
): CompilerHostElement {
  return { kind: "element", tag, attributes, styles, children };
}

function cardDescriptor(card: Card, index: number, prefix: string): CompilerHostElement {
  return host(
    "li",
    [host("span", [prefix, card.title]), host("small", [card.done ? "done" : "open"])],
    [
      { name: "data-card", value: card.id },
      { name: "data-card-index", value: index },
      { name: "title", value: card.title },
    ],
    [{ name: "opacity", value: card.done ? 1 : 0.7 }],
  );
}

function cardBindings(prefix: string): CompilerKeyedRowBinding[] {
  return [
    {
      kind: "attribute",
      path: [],
      name: "data-card-index",
      read: (_card, index) => index,
    },
    {
      kind: "attribute",
      path: [],
      name: "title",
      read: (card) => (card as Card).title,
    },
    {
      kind: "style",
      path: [],
      name: "opacity",
      read: (card) => ((card as Card).done ? 1 : 0.7),
    },
    {
      kind: "text",
      path: [0],
      read: (card) => {
        if ((card as Card).fail) throw new Error("recursive keyed binding failed");
        return [prefix, (card as Card).title];
      },
    },
    {
      kind: "text",
      path: [1],
      read: (card) => ((card as Card).done ? "done" : "open"),
    },
  ];
}

function columnDescriptor(column: Column, index: number, prefix: string): CompilerHostElement {
  return host(
    "article",
    [
      host("h3", [prefix, column.name]),
      {
        ...host("ul", [
          host("i", ["CARDS"]),
          ...column.cards.map((card, cardIndex) => cardDescriptor(card, cardIndex, prefix)),
          host("b", ["END CARDS"]),
        ]),
        block: {
          kind: "keyed-ranges",
          id: 2,
          ranges: [
            {
              before: 1,
              items: () => column.cards,
              rowKey: (card: unknown) => (card as Card).id,
              create: (card: unknown, cardIndex: number) =>
                cardDescriptor(card as Card, cardIndex, prefix),
              bindings: cardBindings(prefix),
            },
          ],
          trailing: 1,
        },
      },
    ],
    [
      { name: "data-column", value: column.id },
      { name: "data-column-index", value: index },
    ],
  );
}

function columnBindings(prefix: string): CompilerKeyedRowBinding[] {
  return [
    {
      kind: "attribute",
      path: [],
      name: "data-column-index",
      read: (_column, index) => index,
    },
    {
      kind: "text",
      path: [0],
      read: (column) => [prefix, (column as Column).name],
    },
  ];
}

function boardDescriptor(board: Board, index: number, prefix: string): CompilerHostElement {
  return host(
    "section",
    [
      host("h2", [prefix, board.name]),
      {
        ...host("div", [
          host("i", ["COLUMNS"]),
          ...board.columns.map((column, columnIndex) =>
            columnDescriptor(column, columnIndex, prefix),
          ),
          host("b", ["END COLUMNS"]),
        ]),
        block: {
          kind: "keyed-ranges",
          id: 1,
          ranges: [
            {
              before: 1,
              items: () => board.columns,
              rowKey: (column: unknown) => (column as Column).id,
              create: (column: unknown, columnIndex: number) =>
                columnDescriptor(column as Column, columnIndex, prefix),
              bindings: columnBindings(prefix),
            },
          ],
          trailing: 1,
        },
      },
    ],
    [
      { name: "data-board", value: board.id },
      { name: "data-board-index", value: index },
    ],
  );
}

function boardBindings(prefix: string): CompilerKeyedRowBinding[] {
  return [
    {
      kind: "attribute",
      path: [],
      name: "data-board-index",
      read: (_board, index) => index,
    },
    {
      kind: "text",
      path: [0],
      read: (board) => [prefix, (board as Board).name],
    },
  ];
}

function cardMarkup(card: Card, index: number, prefix: string): React.ReactElement {
  return (
    <li
      data-card={card.id}
      data-card-index={index}
      key={card.id}
      style={{ opacity: card.done ? 1 : 0.7 }}
      title={card.title}
    >
      <span>
        {prefix}
        {card.title}
      </span>
      <small>{card.done ? "done" : "open"}</small>
    </li>
  );
}

function columnMarkup(column: Column, index: number, prefix: string): React.ReactElement {
  return (
    <article data-column={column.id} data-column-index={index} key={column.id}>
      <h3>
        {prefix}
        {column.name}
      </h3>
      <ul>
        <i>CARDS</i>
        {column.cards.map((card, cardIndex) => cardMarkup(card, cardIndex, prefix))}
        <b>END CARDS</b>
      </ul>
    </article>
  );
}

function boardMarkup(board: Board, index: number, prefix: string): React.ReactElement {
  return (
    <section data-board={board.id} data-board-index={index} key={board.id}>
      <h2>
        {prefix}
        {board.name}
      </h2>
      <div>
        <i>COLUMNS</i>
        {board.columns.map((column, columnIndex) => columnMarkup(column, columnIndex, prefix))}
        <b>END COLUMNS</b>
      </div>
    </section>
  );
}

function createRecursiveFixture() {
  let executions = 0;
  let setBoards: (next: CompilerStateUpdater) => void = () => undefined;
  const Workspace = createCompiledComponent({
    displayName: "RecursiveKeyedWorkspace",
    initialize: () => [initialBoards],
    render(props: { prefix: string }, state, blocks) {
      executions += 1;
      setBoards = state[0].set;
      const boards = () => state[0].get() as Board[];
      const KeyedRows = blocks.KeyedRows;
      return (
        <main>
          <KeyedRows
            bindings={boardBindings(props.prefix)}
            create={(board, index) => boardDescriptor(board as Board, index, props.prefix)}
            hostBlocks
            id={0}
            items={boards}
            render={() => (
              <div data-boards>
                {boards().map((board, index) => boardMarkup(board, index, props.prefix))}
              </div>
            )}
            rowKey={(board) => (board as Board).id}
          />
        </main>
      );
    },
    bindings: [
      { kind: "block", id: 0, dependencies: [0] },
      { kind: "block", id: 1, parent: 0, dependencies: [] },
      { kind: "block", id: 2, parent: 1, dependencies: [] },
    ],
  });
  return {
    Workspace,
    executions: () => executions,
    setBoards: (next: CompilerStateUpdater) => setBoards(next),
  };
}

function semanticBoards(container: Element, owner: string) {
  return [...container.querySelectorAll<HTMLElement>(`${owner} [data-board]`)].map((board) => ({
    id: board.dataset.board,
    index: board.dataset.boardIndex,
    name: board.querySelector(":scope > h2")?.textContent,
    columns: [...board.querySelectorAll<HTMLElement>(":scope > div > [data-column]")].map(
      (column) => ({
        id: column.dataset.column,
        index: column.dataset.columnIndex,
        name: column.querySelector(":scope > h3")?.textContent,
        cards: [...column.querySelectorAll<HTMLElement>(":scope > ul > [data-card]")].map(
          (card) => ({
            id: card.dataset.card,
            index: card.dataset.cardIndex,
            title: card.getAttribute("title"),
            label: card.querySelector("span")?.textContent,
            status: card.querySelector("small")?.textContent,
            opacity: card.style.opacity,
          }),
        ),
      }),
    ),
  }));
}

class Boundary extends React.Component<React.PropsWithChildren, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    return this.state.message ? <p data-error>{this.state.message}</p> : this.props.children;
  }
}

describe("compiler-owned recursive keyed scopes runtime", () => {
  it("runs one independent LIS move at every keyed depth without React commits", async () => {
    let profilerCommits = 0;
    const fixture = createRecursiveFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <StrictMode>
          <Profiler id="recursive-keyed" onRender={() => (profilerCommits += 1)}>
            <fixture.Workspace prefix="Live: " />
          </Profiler>
        </StrictMode>,
      ),
    );

    const executionsAfterMount = fixture.executions();
    const commitsAfterMount = profilerCommits;
    const boardB = container.querySelector<HTMLElement>('[data-board="b"]')!;
    const columnB2 = boardB.querySelector<HTMLElement>('[data-column="b2"]')!;
    const cardB2C1 = columnB2.querySelector<HTMLElement>('[data-card="b2c1"]')!;
    const cardB2C2 = columnB2.querySelector<HTMLElement>('[data-card="b2c2"]')!;
    const boardStatic = boardB.querySelector(":scope > div > i");
    const columnStatic = columnB2.querySelector(":scope > ul > i");
    const boardsRoot = container.querySelector<HTMLElement>("[data-boards]")!;
    const columnsRoot = boardB.querySelector<HTMLElement>(":scope > div")!;
    const cardsRoot = columnB2.querySelector<HTMLElement>(":scope > ul")!;
    let boardMoves = 0;
    let columnMoves = 0;
    let cardMoves = 0;
    const boardInsertBefore = boardsRoot.insertBefore.bind(boardsRoot);
    boardsRoot.insertBefore = (node, anchor) => {
      if (node.parentNode === boardsRoot) boardMoves += 1;
      return boardInsertBefore(node, anchor);
    };
    const columnInsertBefore = columnsRoot.insertBefore.bind(columnsRoot);
    columnsRoot.insertBefore = (node, anchor) => {
      if (node.parentNode === columnsRoot && (node as Element).matches?.("[data-column]")) {
        columnMoves += 1;
      }
      return columnInsertBefore(node, anchor);
    };
    const cardInsertBefore = cardsRoot.insertBefore.bind(cardsRoot);
    cardsRoot.insertBefore = (node, anchor) => {
      if (node.parentNode === cardsRoot && (node as Element).matches?.("[data-card]")) {
        cardMoves += 1;
      }
      return cardInsertBefore(node, anchor);
    };

    await act(async () => {
      fixture.setBoards((current) => {
        const [a, b, c] = current as Board[];
        const [b1, b2, b3] = b.columns;
        const [first, second, third] = b2.cards;
        return [b, c, a].map((board) =>
          board.id === "b"
            ? {
                ...board,
                name: "Beta updated",
                columns: [
                  {
                    ...b2,
                    name: "Build updated",
                    cards: [{ ...third, title: "Ship now", done: true }, first, second],
                  },
                  b3,
                  b1,
                ],
              }
            : board,
        );
      });
      await flushCompilerUpdates();
    });

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-board]")].map(
        (board) => board.dataset.board,
      ),
    ).toEqual(["b", "c", "a"]);
    expect(
      [...boardB.querySelectorAll<HTMLElement>(":scope > div > [data-column]")].map(
        (column) => column.dataset.column,
      ),
    ).toEqual(["b2", "b3", "b1"]);
    expect(
      [...columnB2.querySelectorAll<HTMLElement>(":scope > ul > [data-card]")].map(
        (card) => card.dataset.card,
      ),
    ).toEqual(["b2c3", "b2c1", "b2c2"]);
    expect(container.querySelector('[data-board="b"]')).toBe(boardB);
    expect(boardB.querySelector('[data-column="b2"]')).toBe(columnB2);
    expect(columnB2.querySelector('[data-card="b2c1"]')).toBe(cardB2C1);
    expect(columnB2.querySelector('[data-card="b2c2"]')).toBe(cardB2C2);
    expect(boardB.querySelector(":scope > div > i")).toBe(boardStatic);
    expect(columnB2.querySelector(":scope > ul > i")).toBe(columnStatic);
    expect(columnB2.querySelector('[data-card="b2c3"] span')?.textContent).toBe("Live: Ship now");
    expect(boardMoves).toBe(1);
    expect(columnMoves).toBe(1);
    expect(cardMoves).toBe(1);
    expect(fixture.executions()).toBe(executionsAfterMount);
    expect(profilerCommits).toBe(commitsAfterMount);
  });

  it("combines parent props with deepest updates and drops queued work after unmount", async () => {
    const fixture = createRecursiveFixture();
    function Parent() {
      const [prefix, setPrefix] = useState("Before: ");
      return (
        <>
          <button data-parent onClick={() => setPrefix("After: ")} type="button" />
          <fixture.Workspace prefix={prefix} />
        </>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Parent />));
    const card = container.querySelector('[data-card="b2c2"]');

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-parent]")?.click();
      fixture.setBoards((current) =>
        (current as Board[]).map((board) =>
          board.id === "b"
            ? {
                ...board,
                columns: board.columns.map((column) =>
                  column.id === "b2"
                    ? {
                        ...column,
                        cards: column.cards.map((currentCard) =>
                          currentCard.id === "b2c2"
                            ? { ...currentCard, title: "Together", done: false }
                            : currentCard,
                        ),
                      }
                    : column,
                ),
              }
            : board,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-card="b2c2"]')).toBe(card);
    expect(container.querySelector('[data-card="b2c2"] span')?.textContent).toBe("After: Together");

    fixture.setBoards((current) => [...(current as Board[])].reverse());
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    await flushCompilerUpdates();
    expect(container.innerHTML).toBe("");
  });

  it("adopts recursive server rows and recovers from hydration mismatches", async () => {
    for (const mismatch of [false, true]) {
      const fixture = createRecursiveFixture();
      const container = document.createElement("div");
      const serverHtml = renderToString(<fixture.Workspace prefix="SSR: " />);
      container.innerHTML = mismatch
        ? serverHtml.replace("Compile</span>", "Server mismatch</span>")
        : serverHtml;
      document.body.append(container);
      const recoverable = vi.fn();
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <fixture.Workspace prefix="SSR: " />, {
          onRecoverableError: recoverable,
        });
        await flushCompilerUpdates();
      });
      roots.push(root);
      const card = container.querySelector('[data-card="b2c1"]');
      if (mismatch) expect(recoverable).toHaveBeenCalled();
      else expect(recoverable).not.toHaveBeenCalled();

      await act(async () => {
        fixture.setBoards((current) =>
          (current as Board[]).map((board) =>
            board.id === "b"
              ? {
                  ...board,
                  columns: board.columns.map((column) =>
                    column.id === "b2"
                      ? {
                          ...column,
                          cards: [
                            column.cards[2],
                            { ...column.cards[0], title: "Hydrated", done: true },
                            column.cards[1],
                          ],
                        }
                      : column,
                  ),
                }
              : board,
          ),
        );
        await flushCompilerUpdates();
      });
      expect(container.querySelector('[data-card="b2c1"]')).toBe(card);
      expect(container.querySelector('[data-card="b2c1"] span')?.textContent).toBe("SSR: Hydrated");

      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
      container.remove();
    }
  });

  it("falls back to React for duplicate deepest keys and remains live", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createRecursiveFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<fixture.Workspace prefix="Safe: " />));

    await act(async () => {
      fixture.setBoards((current) =>
        (current as Board[]).map((board) =>
          board.id === "b"
            ? {
                ...board,
                columns: board.columns.map((column) =>
                  column.id === "b2"
                    ? {
                        ...column,
                        cards: [
                          { ...column.cards[0], title: "First" },
                          { ...column.cards[0], title: "Duplicate" },
                        ],
                      }
                    : column,
                ),
              }
            : board,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelectorAll('[data-column="b2"] [data-card="b2c1"]')).toHaveLength(2);
    expect(container.textContent).toContain("Duplicate");

    await act(async () => {
      fixture.setBoards((current) =>
        (current as Board[]).map((board) =>
          board.id === "b"
            ? {
                ...board,
                columns: board.columns.map((column) =>
                  column.id === "b2"
                    ? {
                        ...column,
                        cards: [{ id: "safe", title: "Safe again", done: true }],
                      }
                    : column,
                ),
              }
            : board,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector('[data-card="safe"] span')?.textContent).toBe(
      "Safe: Safe again",
    );
  });

  it("routes deepest binding failures through React error boundaries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createRecursiveFixture();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <Boundary>
          <fixture.Workspace prefix="Error: " />
        </Boundary>,
      ),
    );
    await act(async () => {
      fixture.setBoards((current) =>
        (current as Board[]).map((board) =>
          board.id === "b"
            ? {
                ...board,
                columns: board.columns.map((column) =>
                  column.id === "b2"
                    ? {
                        ...column,
                        cards: column.cards.map((card) =>
                          card.id === "b2c1" ? { ...card, fail: true } : card,
                        ),
                      }
                    : column,
                ),
              }
            : board,
        ),
      );
      await flushCompilerUpdates();
    });
    expect(container.querySelector("[data-error]")?.textContent).toBe(
      "recursive keyed binding failed",
    );
  });

  it("matches normal React across 3,000 deterministic three-level mutations", async () => {
    type Action =
      | "board-reverse"
      | "board-rotate"
      | "column-reverse"
      | "column-rotate"
      | "column-add"
      | "column-remove"
      | "card-reverse"
      | "card-rotate"
      | "card-edit"
      | "card-toggle"
      | "card-add"
      | "card-remove";
    let normalSet: React.Dispatch<React.SetStateAction<Board[]>> = () => undefined;
    const fixture = createRecursiveFixture();

    function Normal() {
      const [boards, setBoards] = useState(initialBoards);
      normalSet = setBoards;
      return (
        <div data-normal>{boards.map((board, index) => boardMarkup(board, index, "Test: "))}</div>
      );
    }

    const transition = (boards: Board[], action: Action, step: number): Board[] => {
      if (action === "board-reverse") return [...boards].reverse();
      if (action === "board-rotate" && boards.length > 1) {
        return [...boards.slice(1), boards[0]];
      }
      if (boards.length === 0) return boards;
      const boardIndex = step % boards.length;
      return boards.map((board, currentBoardIndex) => {
        if (currentBoardIndex !== boardIndex) return board;
        const columns = board.columns;
        if (action === "column-reverse") return { ...board, columns: [...columns].reverse() };
        if (action === "column-rotate" && columns.length > 1) {
          return { ...board, columns: [...columns.slice(1), columns[0]] };
        }
        if (action === "column-add" && columns.length < 6) {
          return {
            ...board,
            columns: [
              ...columns,
              {
                id: `${board.id}-column-${step}`,
                name: `Column ${step}`,
                cards: [{ id: `${board.id}-card-${step}`, title: `Card ${step}`, done: false }],
              },
            ],
          };
        }
        if (action === "column-remove" && columns.length > 1) {
          return { ...board, columns: columns.slice(1) };
        }
        if (columns.length === 0) return board;
        const columnIndex = (step * 7) % columns.length;
        return {
          ...board,
          columns: columns.map((column, currentColumnIndex) => {
            if (currentColumnIndex !== columnIndex) return column;
            const cards = column.cards;
            if (action === "card-reverse") return { ...column, cards: [...cards].reverse() };
            if (action === "card-rotate" && cards.length > 1) {
              return { ...column, cards: [...cards.slice(1), cards[0]] };
            }
            if (action === "card-edit" && cards.length > 0) {
              return {
                ...column,
                cards: cards.map((card, cardIndex) =>
                  cardIndex === step % cards.length ? { ...card, title: `${card.title}!` } : card,
                ),
              };
            }
            if (action === "card-toggle" && cards.length > 0) {
              return {
                ...column,
                cards: cards.map((card, cardIndex) =>
                  cardIndex === step % cards.length ? { ...card, done: !card.done } : card,
                ),
              };
            }
            if (action === "card-add" && cards.length < 8) {
              return {
                ...column,
                cards: [
                  ...cards,
                  { id: `${column.id}-card-${step}`, title: `New ${step}`, done: step % 2 === 0 },
                ],
              };
            }
            if (action === "card-remove" && cards.length > 1) {
              return { ...column, cards: cards.slice(1) };
            }
            return column;
          }),
        };
      });
    };

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <>
          <div data-compiled>
            <fixture.Workspace prefix="Test: " />
          </div>
          <Normal />
        </>,
      ),
    );
    const executionsAfterMount = fixture.executions();
    const actions: Action[] = [
      "board-reverse",
      "board-rotate",
      "column-reverse",
      "column-rotate",
      "column-add",
      "column-remove",
      "card-reverse",
      "card-rotate",
      "card-edit",
      "card-toggle",
      "card-add",
      "card-remove",
    ];
    let random = 0x4f1bbcdc;
    for (let step = 0; step < 3000; step += 1) {
      random = (random * 1664525 + 1013904223) >>> 0;
      const action = actions[random % actions.length];
      await act(async () => {
        fixture.setBoards((current) => transition(current as Board[], action, step));
        normalSet((current) => transition(current, action, step));
        await flushCompilerUpdates();
      });
      expect(semanticBoards(container, "[data-compiled]")).toEqual(
        semanticBoards(container, "[data-normal]"),
      );
    }
    expect(fixture.executions()).toBe(executionsAfterMount);
  }, 60_000);

  it("preserves every keyed depth through compatible Fast Refresh", async () => {
    const hmrId = `recursive-keyed-refresh-${Math.random()}`;
    const definition = (prefix: string): CompiledComponentDefinition<Record<string, never>> => ({
      displayName: "RefreshRecursiveKeyed",
      hmrId,
      stateSignature: "boards",
      initialize: () => [initialBoards],
      render(_props, state, blocks) {
        const boards = () => state[0].get() as Board[];
        const KeyedRows = blocks.KeyedRows;
        return (
          <main>
            <KeyedRows
              bindings={boardBindings(prefix)}
              create={(board, index) => boardDescriptor(board as Board, index, prefix)}
              hostBlocks
              id={0}
              items={boards}
              render={() => (
                <div>{boards().map((board, index) => boardMarkup(board, index, prefix))}</div>
              )}
              rowKey={(board) => (board as Board).id}
            />
          </main>
        );
      },
      bindings: [
        { kind: "block", id: 0, dependencies: [0] },
        { kind: "block", id: 1, parent: 0, dependencies: [] },
        { kind: "block", id: 2, parent: 1, dependencies: [] },
      ],
    });

    const Initial = createCompiledComponent(definition("Before: "));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Initial />));
    const board = container.querySelector('[data-board="b"]');
    const column = container.querySelector('[data-column="b2"]');
    const card = container.querySelector('[data-card="b2c1"]');

    let Refreshed = Initial;
    await act(async () => {
      Refreshed = createCompiledComponent(definition("After: "));
      root.render(<Refreshed />);
      await flushCompilerUpdates();
    });
    expect(Refreshed).toBe(Initial);
    expect(container.querySelector('[data-board="b"]')).toBe(board);
    expect(container.querySelector('[data-column="b2"]')).toBe(column);
    expect(container.querySelector('[data-card="b2c1"]')).toBe(card);
    expect(container.querySelector('[data-card="b2c1"] span')?.textContent).toBe("After: Compile");
  });
});
