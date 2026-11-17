"use client";

// A file tree drawn with real box-drawing connectors (├── └── │), the way
// `tree` prints. Expanding or collapsing a folder rewrites the connector
// glyphs themselves instead of moving static indent rules: collapsing a folder
// retracts its visible descendant rows one at a time, bottom row first, and
// the instant a row disappears its previous sibling becomes the last child on
// screen, so that sibling's connector flips from "├── " to "└── " and the "│"
// guides beneath it clear. Expanding reveals rows top to bottom into their
// final connectors, so only removal has a moving "which child is last" target.
//
// Each toggle runs one rAF loop over a snapshot of the affected rows at a fixed
// cadence, writing opacity and max-height straight to each row (and, while
// collapsing, the connector text of the sibling that just became last). React
// commits the settled expanded set when the sequence ends. A new toggle settles
// the running sequence first, so repeated clicks never strand a row half shown.
//
// WAI-ARIA tree pattern: role=tree/treeitem with aria-level, aria-setsize and
// aria-posinset, a roving tabindex, ArrowDown/Up to move, ArrowRight to open
// (or step into an open folder), ArrowLeft to close (or climb to the parent),
// Home/End for the first and last visible row, Enter or Space to choose.
// prefers-reduced-motion renders the settled state at once.

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type BoughNode = {
  id: string;
  label: string;
  /** A short trailing note, such as the route a file serves. */
  meta?: string;
  children?: readonly BoughNode[];
};

export interface BoughIndexProps {
  /** Accessible name for the tree, e.g. "Project files". */
  label: string;
  /** Root-level nodes of the tree. */
  nodes: readonly BoughNode[];
  /** Node ids expanded on first render, without a reveal sequence. */
  defaultExpandedIds?: readonly string[];
  /** The selected node id. Pass it with `onSelectedIdChange` to control selection. */
  selectedId?: string | null;
  /** The node selected on first render when selection is uncontrolled. */
  defaultSelectedId?: string | null;
  /** Called when a row is clicked or chosen with Enter or Space. */
  onSelectedIdChange?: (id: string) => void;
  /** Row height in pixels. Rows reveal and retract between 0 and this height. */
  rowHeight?: number;
  /** Extra classes merged onto the root element. */
  className?: string;
}

type Row = {
  node: BoughNode;
  parent: BoughNode | null;
  depth: number;
  /** One flag per ancestor, root first: true when that ancestor is its parent's last child. */
  ancestorLast: boolean[];
  /** Every ancestor id, root first, in the same order as `ancestorLast`. */
  ancestorIds: string[];
  isLast: boolean;
  /** 1-based position among its siblings. */
  position: number;
  setSize: number;
};

type Sequence = { frame: number | undefined; finish: () => void };

const STEP_MS = 42;

function flattenVisible(nodes: readonly BoughNode[], expandedIds: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (
    list: readonly BoughNode[],
    parent: BoughNode | null,
    depth: number,
    ancestorLast: boolean[],
    ancestorIds: string[],
  ) => {
    list.forEach((node, index) => {
      const isLast = index === list.length - 1;
      out.push({
        node,
        parent,
        depth,
        ancestorLast,
        ancestorIds,
        isLast,
        position: index + 1,
        setSize: list.length,
      });
      if (node.children?.length && expandedIds.has(node.id)) {
        walk(node.children, node, depth + 1, [...ancestorLast, isLast], [...ancestorIds, node.id]);
      }
    });
  };
  walk(nodes, null, 0, [], []);
  return out;
}

function collectAncestors(nodes: readonly BoughNode[]) {
  const ancestors = new Map<string, string[]>();
  const walk = (list: readonly BoughNode[], path: string[]) => {
    for (const node of list) {
      ancestors.set(node.id, path);
      if (node.children?.length) walk(node.children, [...path, node.id]);
    }
  };
  walk(nodes, []);
  return ancestors;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function BoughIndex({
  label,
  nodes,
  defaultExpandedIds = [],
  selectedId: selectedIdProp,
  defaultSelectedId = null,
  onSelectedIdChange,
  rowHeight = 22,
  className,
}: BoughIndexProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpandedIds),
  );
  // Folders mid-collapse keep their rows mounted so the retraction has something to animate.
  const [collapsingIds, setCollapsingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Rows inside folders mid-expand mount hidden until the reveal reaches them.
  const [expandingIds, setExpandingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [internalSelectedId, setInternalSelectedId] = useState(defaultSelectedId);
  const [focusedId, setFocusedId] = useState(() => nodes[0]?.id ?? "");
  const reduced = usePrefersReducedMotion();

  const isControlled = selectedIdProp !== undefined;
  const selectedId = isControlled ? selectedIdProp : internalSelectedId;

  const treeRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const connectorRefs = useRef(new Map<string, HTMLSpanElement>());
  // Toggles read and write the expanded set synchronously; state follows for rendering.
  const expandedRef = useRef(expandedIds);
  const sequenceRef = useRef<Sequence | null>(null);

  const renderExpandedIds = useMemo(() => {
    const ids = new Set(expandedIds);
    collapsingIds.forEach((id) => ids.add(id));
    return ids;
  }, [expandedIds, collapsingIds]);

  const visible = useMemo(
    () => flattenVisible(nodes, renderExpandedIds),
    [nodes, renderExpandedIds],
  );
  const steadyVisible = useMemo(() => flattenVisible(nodes, expandedIds), [nodes, expandedIds]);
  const ancestorsById = useMemo(() => collectAncestors(nodes), [nodes]);

  // The row that takes Tab. When the focused row was collapsed away, its nearest
  // visible ancestor takes over so the tree never loses its tab stop.
  const tabStopId = useMemo(() => {
    const visibleIds = new Set(steadyVisible.map((row) => row.node.id));
    if (visibleIds.has(focusedId)) return focusedId;
    const ancestors = ancestorsById.get(focusedId) ?? [];
    for (let index = ancestors.length - 1; index >= 0; index--) {
      if (visibleIds.has(ancestors[index]!)) return ancestors[index]!;
    }
    return steadyVisible[0]?.node.id ?? "";
  }, [ancestorsById, focusedId, steadyVisible]);

  const setExpanded = useCallback((next: ReadonlySet<string>) => {
    expandedRef.current = next;
    setExpandedIds(next);
  }, []);

  const runSequence = useCallback(
    (rows: Row[], mode: "expand" | "collapse", onDone: () => void) => {
      const ordered = mode === "collapse" ? [...rows].reverse() : rows;
      let applied = 0;

      const applyStep = (row: Row) => {
        const element = rowRefs.current.get(row.node.id);
        if (element) {
          element.style.maxHeight = mode === "expand" ? `${rowHeight}px` : "0px";
          element.style.opacity = mode === "expand" ? "1" : "0";
        }
        // This row just vanished, and every later sibling went before it, so the
        // previous sibling is now the last child on screen.
        if (mode === "collapse" && row.parent && row.position > 1) {
          const previous = row.parent.children?.[row.position - 2];
          if (!previous) return;
          const connector = connectorRefs.current.get(previous.id);
          if (connector) connector.textContent = "└── ";
          treeRef.current
            ?.querySelectorAll(`[data-guide-for="${CSS.escape(previous.id)}"]`)
            .forEach((guide) => {
              guide.textContent = "    ";
            });
        }
      };

      const sequence: Sequence = {
        frame: undefined,
        finish: () => {
          if (sequence.frame !== undefined) cancelAnimationFrame(sequence.frame);
          sequence.frame = undefined;
          while (applied < ordered.length) applyStep(ordered[applied++]!);
          if (sequenceRef.current === sequence) sequenceRef.current = null;
          onDone();
        },
      };
      sequenceRef.current = sequence;

      if (reduced || ordered.length === 0) {
        sequence.finish();
        return;
      }

      let start: number | undefined;
      const tick = (now: number) => {
        start ??= now;
        const through = Math.min(ordered.length, Math.floor((now - start) / STEP_MS) + 1);
        while (applied < through) applyStep(ordered[applied++]!);
        if (applied < ordered.length) sequence.frame = requestAnimationFrame(tick);
        else sequence.finish();
      };
      // Revealed rows mount hidden in this commit; wait a frame so the browser has
      // their hidden style to transition from.
      sequence.frame = requestAnimationFrame(() => {
        sequence.frame = requestAnimationFrame(tick);
      });
    },
    [reduced, rowHeight],
  );

  const toggle = useCallback(
    (node: BoughNode) => {
      sequenceRef.current?.finish();
      const isOpen = expandedRef.current.has(node.id);

      if (isOpen) {
        const rows = flattenVisible(nodes, expandedRef.current).filter((row) =>
          row.ancestorIds.includes(node.id),
        );
        const next = new Set(expandedRef.current);
        next.delete(node.id);
        setCollapsingIds((current) => new Set(current).add(node.id));
        setExpanded(next);
        runSequence(rows, "collapse", () => {
          setCollapsingIds((current) => {
            const remaining = new Set(current);
            remaining.delete(node.id);
            return remaining;
          });
        });
        return;
      }

      const next = new Set(expandedRef.current).add(node.id);
      const rows = flattenVisible(nodes, next).filter((row) => row.ancestorIds.includes(node.id));
      setExpandingIds((current) => new Set(current).add(node.id));
      setExpanded(next);
      runSequence(rows, "expand", () => {
        setExpandingIds((current) => {
          const remaining = new Set(current);
          remaining.delete(node.id);
          return remaining;
        });
      });
    },
    [nodes, runSequence, setExpanded],
  );

  const select = useCallback(
    (id: string) => {
      setFocusedId(id);
      if (!isControlled) setInternalSelectedId(id);
      onSelectedIdChange?.(id);
    },
    [isControlled, onSelectedIdChange],
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = steadyVisible.findIndex((row) => row.node.id === tabStopId);
    const row = steadyVisible[index];
    if (!row) return;
    const { node, parent } = row;
    const hasChildren = Boolean(node.children?.length);
    const isOpen = expandedRef.current.has(node.id);

    switch (event.key) {
      case "ArrowDown": {
        const next = steadyVisible[index + 1];
        if (next) focusRow(next.node.id);
        break;
      }
      case "ArrowUp": {
        const previous = steadyVisible[index - 1];
        if (previous) focusRow(previous.node.id);
        break;
      }
      case "ArrowRight":
        if (hasChildren && !isOpen) toggle(node);
        else if (hasChildren && node.children?.[0]) focusRow(node.children[0].id);
        break;
      case "ArrowLeft":
        if (hasChildren && isOpen) toggle(node);
        else if (parent) focusRow(parent.id);
        break;
      case "Home": {
        const first = steadyVisible[0];
        if (first) focusRow(first.node.id);
        break;
      }
      case "End": {
        const last = steadyVisible[steadyVisible.length - 1];
        if (last) focusRow(last.node.id);
        break;
      }
      case "Enter":
      case " ":
        if (hasChildren) toggle(node);
        select(node.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  useEffect(
    () => () => {
      const sequence = sequenceRef.current;
      if (sequence?.frame !== undefined) cancelAnimationFrame(sequence.frame);
      sequenceRef.current = null;
    },
    [],
  );

  return (
    <div
      aria-label={label}
      className={cn("select-none font-mono", className)}
      onKeyDown={onKeyDown}
      ref={treeRef}
      role="tree"
    >
      {visible.map((row) => {
        const { node, depth, ancestorLast, ancestorIds, isLast, position, setSize } = row;
        const hasChildren = Boolean(node.children?.length);
        const isOpen = expandedIds.has(node.id);
        const isSelected = selectedId === node.id;
        const startsHidden = !reduced && ancestorIds.some((id) => expandingIds.has(id));

        return (
          <div
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-level={depth + 1}
            aria-posinset={position}
            aria-selected={isSelected}
            aria-setsize={setSize}
            className={cn(
              "group/row flex cursor-default items-center overflow-hidden whitespace-pre outline-none",
              "transition-[opacity,max-height] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-white/60",
            )}
            key={node.id}
            onClick={() => {
              if (hasChildren) toggle(node);
              select(node.id);
            }}
            onFocus={() => setFocusedId(node.id)}
            ref={(element) => {
              if (element) rowRefs.current.set(node.id, element);
              else rowRefs.current.delete(node.id);
            }}
            role="treeitem"
            style={{
              lineHeight: `${rowHeight}px`,
              maxHeight: startsHidden ? 0 : rowHeight,
              opacity: startsHidden ? 0 : 1,
            }}
            tabIndex={node.id === tabStopId ? 0 : -1}
          >
            <span aria-hidden className="shrink-0 text-white/24">
              {ancestorLast.slice(1).map((last, level) => (
                <span data-guide-for={ancestorIds[level + 1]} key={ancestorIds[level + 1]}>
                  {last ? "    " : "│   "}
                </span>
              ))}
              <span
                ref={(element) => {
                  if (element) connectorRefs.current.set(node.id, element);
                  else connectorRefs.current.delete(node.id);
                }}
              >
                {depth === 0 ? "" : isLast ? "└── " : "├── "}
              </span>
            </span>
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center rounded-[3px] px-1 transition-[background-color,color] duration-150",
                isSelected && "bg-white/[0.055] text-white/88",
                !isSelected && hasChildren && "text-white/62 group-hover/row:text-white/88",
                !isSelected && !hasChildren && "text-white/40 group-hover/row:text-white/72",
              )}
            >
              <span aria-hidden className="shrink-0 text-white/34">
                {hasChildren ? (isOpen ? "▾ " : "▸ ") : "· "}
              </span>
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              {node.meta ? (
                <span
                  className={cn(
                    "ml-2 shrink-0 text-[8px] uppercase",
                    isSelected ? "text-white/62" : "text-white/28",
                  )}
                >
                  {node.meta}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default BoughIndex;
