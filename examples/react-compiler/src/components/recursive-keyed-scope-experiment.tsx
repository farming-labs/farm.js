"use client";

import { useState } from "react";

interface RecursiveCard {
  id: string;
  label: string;
  done: boolean;
}

interface RecursiveColumn {
  id: string;
  label: string;
  cards: RecursiveCard[];
}

interface RecursiveBoard {
  id: string;
  label: string;
  columns: RecursiveColumn[];
}

const initialBoards: RecursiveBoard[] = Array.from({ length: 48 }, (_, boardIndex) => ({
  id: `recursive-board-${boardIndex}`,
  label: `Board ${boardIndex}`,
  columns: Array.from({ length: 6 }, (_, columnIndex) => ({
    id: `recursive-column-${boardIndex}-${columnIndex}`,
    label: `Column ${boardIndex}.${columnIndex}`,
    cards: Array.from({ length: 8 }, (_, cardIndex) => ({
      id: `recursive-card-${boardIndex}-${columnIndex}-${cardIndex}`,
      label: `Card ${boardIndex}.${columnIndex}.${cardIndex}`,
      done: cardIndex % 2 === 0,
    })),
  })),
}));

let recursiveKeyedOwnerExecutions = 0;

export function RecursiveKeyedScopeExperiment() {
  const [boards, setBoards] = useState(initialBoards);
  const [updates, setUpdates] = useState(0);

  function reorderEveryLevel() {
    setBoards((current) => {
      const rotatedBoards = [...current.slice(1), current[0]];
      return rotatedBoards.map((board) => {
        if (board.id !== "recursive-board-12") return board;
        const rotatedColumns = [board.columns[5], ...board.columns.slice(0, 5)];
        return {
          ...board,
          label: "Board 12 · updated",
          columns: rotatedColumns.map((column) => {
            if (column.id !== "recursive-column-12-3") return column;
            const lastCard = column.cards[column.cards.length - 1];
            return {
              ...column,
              label: "Column 12.3 · updated",
              cards: [
                { ...lastCard, label: `${lastCard.label} · moved`, done: true },
                ...column.cards.slice(0, -1),
              ],
            };
          }),
        };
      });
    });
    setUpdates((value) => value + 1);
  }

  function replaceDeepestRow() {
    setBoards((current) =>
      current.map((board) =>
        board.id === "recursive-board-12"
          ? {
              ...board,
              columns: board.columns.map((column) =>
                column.id === "recursive-column-12-3"
                  ? {
                      ...column,
                      cards: [
                        ...column.cards.filter(
                          (card) => card.id !== "recursive-card-12-3-1",
                        ),
                        {
                          id: `recursive-inserted-card-${updates}`,
                          label: `Inserted after update ${updates}`,
                          done: false,
                        },
                      ],
                    }
                  : column,
              ),
            }
          : board,
      ),
    );
    setUpdates((value) => value + 1);
  }

  return (
    <section className="heavy-benchmark" data-experiment="recursive-keyed-scopes">
      <header className="heavy-heading">
        <div>
          <span className="experiment-number">12</span>
          <div>
            <p className="heavy-kicker">RECURSIVE KEYED SCOPES</p>
            <h2>Every stable parent key owns the next keyed level</h2>
          </div>
        </div>
        <span className="node-badge">48 BOARDS / 288 COLUMNS / 2,304 CARDS</span>
      </header>

      <p className="heavy-copy">
        The compiler recursively prepares boards, columns, and cards. Each level gets its own key
        table and LIS pass, so one deep update preserves every surviving DOM node without rerunning
        this component.
      </p>

      <dl className="heavy-metrics" aria-live="polite">
        <div>
          <dt>Owner executions</dt>
          <dd data-metric="recursive-keyed-owner-executions">
            {typeof window === "undefined" ? 1 : ++recursiveKeyedOwnerExecutions}
          </dd>
        </div>
        <div>
          <dt>Boards</dt>
          <dd data-metric="recursive-keyed-boards">{boards.length}</dd>
        </div>
        <div>
          <dt>Columns</dt>
          <dd data-metric="recursive-keyed-columns">{boards.length * 6}</dd>
        </div>
        <div>
          <dt>Cards</dt>
          <dd data-metric="recursive-keyed-cards">{boards.length * 6 * 8}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd data-metric="recursive-keyed-updates">{updates}</dd>
        </div>
      </dl>

      <div className="heavy-controls composable-controls">
        <button data-action="recursive-keyed-reorder" type="button" onClick={reorderEveryLevel}>
          Reorder every level <span aria-hidden="true">↗</span>
        </button>
        <button data-action="recursive-keyed-replace" type="button" onClick={replaceDeepestRow}>
          Replace one card
        </button>
      </div>

      <ol className="keyed-host-row-list" data-recursive-board-list>
        {boards.map((board, boardIndex) => (
          <li data-recursive-board={board.id} data-board-index={boardIndex} key={board.id}>
            <h3>{board.label}</h3>
            <div data-recursive-column-list={board.id}>
              <i data-recursive-static="columns-before">COLUMNS</i>
              {board.columns.map((column, columnIndex) => (
                <article
                  data-recursive-column={column.id}
                  data-column-index={columnIndex}
                  key={column.id}
                >
                  <h4>{column.label}</h4>
                  <ul data-recursive-card-list={column.id}>
                    <li data-recursive-static="cards-before">CARDS</li>
                    {column.cards.map((card, cardIndex) => (
                      <li
                        data-recursive-card={card.id}
                        data-card-index={cardIndex}
                        key={card.id}
                        style={{ opacity: card.done ? 1 : 0.72 }}
                        title={card.label}
                      >
                        {card.label}
                      </li>
                    ))}
                    <li data-recursive-static="cards-after">END</li>
                  </ul>
                </article>
              ))}
              <b data-recursive-static="columns-after">END COLUMNS</b>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
