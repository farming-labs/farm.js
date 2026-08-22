import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { DefaultErrorSourceFrame } from "../components/error-page";

export interface DefaultErrorDiagnostics {
  name: string;
  message: string;
  stack?: string;
  sourceFrame?: DefaultErrorSourceFrame;
}

interface StackLocation {
  absolutePath: string;
  displayPath: string;
  line: number;
  column: number;
}

const SECRET_VALUE_PATTERN =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

function redactErrorText(value: string): string {
  return value
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(SECRET_VALUE_PATTERN, "$1=[REDACTED]");
}

function isPathInsideRoot(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeStackPath(value: string): string | undefined {
  const withoutQuery = value.replace(/[?#].*$/, "");
  try {
    return withoutQuery.startsWith("file://") ? fileURLToPath(withoutQuery) : withoutQuery;
  } catch {
    return undefined;
  }
}

function findStackLocation(stack: string, root: string): StackLocation | undefined {
  for (const stackLine of stack.split("\n")) {
    const match = stackLine.match(
      /(?:\()?((?:file:\/\/\/|\/|[A-Za-z]:[\\/])[^\n()]+):(\d+):(\d+)\)?$/,
    );
    if (!match) continue;

    const candidate = normalizeStackPath(match[1]);
    if (!candidate || candidate.includes(`${path.sep}node_modules${path.sep}`)) continue;

    const absolutePath = path.resolve(candidate);
    if (!isPathInsideRoot(root, absolutePath) || !fs.existsSync(absolutePath)) continue;

    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    return {
      absolutePath,
      displayPath: relativePath || path.basename(absolutePath),
      line: Number(match[2]),
      column: Number(match[3]),
    };
  }
  return undefined;
}

function createSourceFrame(location: StackLocation): DefaultErrorSourceFrame | undefined {
  try {
    const sourceLines = fs.readFileSync(location.absolutePath, "utf8").split(/\r?\n/);
    if (location.line < 1 || location.line > sourceLines.length) return undefined;

    const start = Math.max(1, location.line - 2);
    const end = Math.min(sourceLines.length, location.line + 2);
    const lines = [];
    for (let line = start; line <= end; line++) {
      lines.push({
        number: line,
        content: sourceLines[line - 1],
        highlight: line === location.line,
      });
    }

    return {
      file: location.displayPath,
      line: location.line,
      column: location.column,
      lines,
    };
  } catch {
    return undefined;
  }
}

function sanitizeStack(stack: string, root: string): string {
  const normalizedRoot = path.resolve(root);
  return (
    redactErrorText(stack)
      .split(normalizedRoot)
      .join("<project>")
      // Match displayPath, which reports project-relative paths with POSIX separators.
      .replace(/<project>[^\s)]*/g, (segment) => segment.split("\\").join("/"))
      .split("\n")
      .filter((line, index) => index === 0 || !line.includes("node:internal"))
      .slice(0, 14)
      .join("\n")
  );
}

export function createDefaultErrorDiagnostics(
  error: unknown,
  root: string,
): DefaultErrorDiagnostics {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Unknown server rendering error");
  const rawStack = normalizedError.stack || `${normalizedError.name}: ${normalizedError.message}`;
  const location = findStackLocation(rawStack, path.resolve(root));

  return {
    name: redactErrorText(normalizedError.name || "Error"),
    message: redactErrorText(normalizedError.message || "Unknown server rendering error"),
    stack: sanitizeStack(rawStack, root),
    sourceFrame: location ? createSourceFrame(location) : undefined,
  };
}
