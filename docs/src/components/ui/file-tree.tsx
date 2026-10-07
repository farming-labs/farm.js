"use client";

import {
  Atom,
  Braces,
  Check,
  ChevronRight,
  File,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Route,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type FileTreeNode = {
  name: string;
  type: "file" | "folder";
  children?: readonly FileTreeNode[];
  extension?: string;
  meta?: string;
  defaultOpen?: boolean;
};

export type FileTreeProps = {
  data: readonly FileTreeNode[];
  className?: string;
  defaultSelectedPath?: string;
  label?: string;
  /**
   * A pane beside the tree that shows what the selected file becomes. A wire
   * draws from the selected row into the pane each time the selection moves.
   */
  explorer?: (activePath: string) => ReactNode;
};

type FileTreeItemProps = {
  node: FileTreeNode;
  path: string;
  depth: number;
  activePath: string;
  onSelect: (path: string) => void;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function collectFilePaths(nodes: readonly FileTreeNode[], parentPath = "") {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === "file") return [path];
    return collectFilePaths(node.children ?? [], path);
  });
}

function countFiles(nodes: readonly FileTreeNode[]): number {
  return nodes.reduce(
    (count, node) => count + (node.type === "file" ? 1 : countFiles(node.children ?? [])),
    0,
  );
}

/** A wire from a row to a point, with one rounded elbow where it turns. */
function routeWire([x0, y0]: [number, number], [x1, y1]: [number, number], end: [number, number]) {
  const radius = Math.min(6, Math.abs(y1 - y0) / 2);
  const down = y1 >= y0 ? 1 : -1;
  if (radius < 0.5) return `M${x0},${y0}H${end[0]}`;
  return [
    `M${x0},${y0}`,
    `H${x1 - radius}`,
    `Q${x1},${y0} ${x1},${y0 + down * radius}`,
    `V${y1 - down * radius}`,
    `Q${x1},${y1} ${x1 + radius},${y1}`,
    `H${end[0]}`,
  ].join("");
}

function getFileIcon(extension?: string): LucideIcon {
  if (extension === "tsx" || extension === "jsx") return Atom;
  if (extension === "ts" || extension === "js") return FileCode2;
  if (extension === "json") return FileJson2;
  if (extension === "md" || extension === "mdx") return FileText;
  if (extension === "route") return Braces;
  return File;
}

function FileTreeItem({ node, path, depth, activePath, onSelect }: FileTreeItemProps) {
  const isFolder = node.type === "folder";
  const hasChildren = isFolder && Boolean(node.children?.length);
  const [isOpen, setIsOpen] = useState(node.defaultOpen ?? true);
  const isSelected = !isFolder && activePath === path;
  const FileIcon = getFileIcon(node.extension);
  const FolderIcon = isOpen ? FolderOpen : Folder;

  return (
    <li className="min-w-0">
      <button
        aria-current={isSelected ? "true" : undefined}
        aria-expanded={isFolder ? isOpen : undefined}
        aria-label={
          isFolder ? `${node.name} folder` : `${path}${node.meta ? `, ${node.meta}` : ""}`
        }
        className={cn(
          "group/file relative flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[3px] px-2 text-left font-mono text-[9px] font-normal tracking-normal transition-[background-color,color] duration-150 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-white/60 sm:text-[10px]",
          isFolder && !isSelected && "text-white/62 hover:bg-white/[0.035] hover:text-white/88",
          !isFolder && !isSelected && "text-white/40 hover:bg-white/[0.035] hover:text-white/72",
          isSelected && "bg-white/[0.055] text-white/92",
        )}
        onClick={() => {
          if (isFolder) setIsOpen((current) => !current);
          else onSelect(path);
        }}
        type="button"
      >
        {isFolder ? (
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3 shrink-0 text-white/34 transition-transform duration-200 motion-reduce:transition-none",
              isOpen && "rotate-90",
            )}
            strokeWidth={1.5}
          />
        ) : (
          <span aria-hidden className="size-3 shrink-0" />
        )}

        {isFolder ? (
          <FolderIcon aria-hidden className="size-3.5 shrink-0 text-white/62" strokeWidth={1.4} />
        ) : (
          <FileIcon
            aria-hidden
            className={cn("size-3.5 shrink-0", isSelected ? "text-white/88" : "text-white/46")}
            strokeWidth={1.35}
          />
        )}

        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.meta ? (
          <span
            className={cn(
              "ml-2 shrink-0 text-[8px] uppercase",
              isSelected ? "text-white/64" : "text-white/28",
            )}
          >
            {node.meta}
          </span>
        ) : null}
      </button>

      {hasChildren ? (
        <div
          aria-hidden={!isOpen}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            isOpen
              ? "grid-rows-[1fr] opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0",
          )}
          inert={!isOpen}
        >
          <ul className="farm-tree-guide ml-[13.5px] min-h-0 overflow-hidden border-l border-white/[0.08] pl-px">
            {node.children?.map((child) => {
              const childPath = `${path}/${child.name}`;
              return (
                <FileTreeItem
                  key={childPath}
                  activePath={activePath}
                  depth={depth + 1}
                  node={child}
                  onSelect={onSelect}
                  path={childPath}
                />
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function FileTree({
  data,
  className,
  defaultSelectedPath,
  label = "Application route file tree",
  explorer,
}: FileTreeProps) {
  const filePaths = useMemo(() => collectFilePaths(data), [data]);
  const routeCount = useMemo(() => countFiles(data), [data]);
  const [activePath, setActivePath] = useState(defaultSelectedPath ?? filePaths[0] ?? "");
  const [isPaused, setIsPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const hasExplorer = Boolean(explorer);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [wireAt, setWireAt] = useState<{
    row: number;
    edge: number;
    to: number;
    end: number;
  } | null>(null);

  // Where the wire runs: from the selected row's right end, across the divider,
  // down or up to the explorer's address bar.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const list = listRef.current;
    if (!hasExplorer || !body || !list) return;
    const measure = () => {
      const row = list.querySelector<HTMLElement>('[aria-current="true"]');
      const target = body.querySelector<HTMLElement>("[data-route-explorer-anchor]");
      if (!row || !target) return setWireAt(null);
      const box = body.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const next = {
        row: Math.round(rowBox.top + rowBox.height / 2 - box.top),
        edge: Math.round(list.getBoundingClientRect().right - box.left),
        to: Math.round(targetBox.top + targetBox.height / 2 - box.top),
        end: Math.round(targetBox.left - box.left),
      };
      setWireAt((current) =>
        current?.row === next.row &&
        current.edge === next.edge &&
        current.to === next.to &&
        current.end === next.end
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [activePath, hasExplorer]);

  const wireStart: [number, number] = wireAt ? [wireAt.edge - 4, wireAt.row] : [0, 0];
  const wire = wireAt
    ? routeWire(wireStart, [wireAt.edge + 8, wireAt.to], [wireAt.end, wireAt.to])
    : null;

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(motionQuery.matches);

    updateMotionPreference();
    motionQuery.addEventListener("change", updateMotionPreference);
    return () => motionQuery.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (isPaused || reducedMotion || filePaths.length < 2) return;

    const interval = window.setInterval(() => {
      setActivePath((currentPath) => {
        const currentIndex = filePaths.indexOf(currentPath);
        return filePaths[(currentIndex + 1) % filePaths.length] ?? filePaths[0] ?? "";
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [filePaths, isPaused, reducedMotion]);

  return (
    <div
      aria-label={label}
      className={cn(
        "flex min-w-0 select-none flex-col overflow-hidden border border-white/12 bg-black font-mono",
        className,
      )}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsPaused(false);
      }}
      onFocusCapture={() => setIsPaused(true)}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      role="region"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3 text-[9px] uppercase tracking-normal text-white/38 sm:px-3.5 sm:text-[10px]">
        <span className="flex items-center gap-2 text-white/68">
          <FolderTree aria-hidden className="size-3.5" strokeWidth={1.4} />
          app
        </span>
        <span className="flex items-center gap-1.5">
          <Route aria-hidden className="size-3" strokeWidth={1.4} />
          route explorer
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1" ref={bodyRef}>
        <ul
          className={cn(
            "min-h-0 flex-1 overflow-hidden px-2 py-1.5",
            explorer && "sm:max-w-[54%] sm:flex-none sm:basis-[54%]",
          )}
          ref={listRef}
        >
          {data.map((node) => (
            <FileTreeItem
              key={node.name}
              activePath={activePath}
              depth={0}
              node={node}
              onSelect={setActivePath}
              path={node.name}
            />
          ))}
        </ul>
        {explorer ? (
          <>
            <div className="hidden min-w-0 flex-1 border-l border-white/10 sm:block">
              {explorer(activePath)}
            </div>
            {wire ? (
              <svg
                aria-hidden
                className="farm-route-wire pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
                key={activePath}
              >
                <path d={wire} pathLength={1} />
                <circle cx={wireStart[0]} cy={wireStart[1]} r={1.75} />
                <rect
                  height={3}
                  width={3}
                  x={(wireAt?.end ?? 0) - 1.5}
                  y={(wireAt?.to ?? 0) - 1.5}
                />
              </svg>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-white/10 px-3 text-[8px] uppercase tracking-normal text-white/34 sm:px-3.5">
        <span className="flex items-center gap-1.5">
          <Route aria-hidden className="size-3" strokeWidth={1.4} />
          {String(routeCount).padStart(2, "0")} routes
        </span>
        <span className="flex items-center gap-1.5 text-white/58">
          <Check aria-hidden className="size-3" strokeWidth={1.5} />
          manifest synced
        </span>
      </div>
    </div>
  );
}
