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
import { useEffect, useMemo, useState } from "react";

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
          "group/file relative flex h-7 w-full min-w-0 items-center gap-1.5 border border-transparent px-2 text-left font-mono text-[9px] font-normal tracking-normal transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-white sm:text-[10px]",
          isFolder && !isSelected && "text-white/68 hover:bg-white/[0.045] hover:text-white",
          !isFolder &&
            !isSelected &&
            "text-white/42 hover:border-white/8 hover:bg-white/[0.04] hover:text-white/74",
          isSelected &&
            "border-white/16 bg-white/[0.075] text-white shadow-[inset_2px_0_0_rgba(255,255,255,0.78)]",
        )}
        onClick={() => {
          if (isFolder) setIsOpen((current) => !current);
          else onSelect(path);
        }}
        type="button"
      >
        {depth > 0 ? (
          <span
            aria-hidden
            className="absolute -left-px top-1/2 h-px w-2 bg-white/14 transition-colors duration-150 group-hover/file:bg-white/28"
          />
        ) : null}

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
          <ul className="ml-4 min-h-0 overflow-hidden border-l border-white/10">
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
}: FileTreeProps) {
  const filePaths = useMemo(() => collectFilePaths(data), [data]);
  const routeCount = useMemo(() => countFiles(data), [data]);
  const [activePath, setActivePath] = useState(defaultSelectedPath ?? filePaths[0] ?? "");
  const [isPaused, setIsPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

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

      <ul className="min-h-0 flex-1 overflow-hidden px-2 py-1.5">
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
