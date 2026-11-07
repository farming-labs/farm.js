export interface ProgressOptions {
  delayMs?: number;
  color?: string;
  height?: number;
}

export interface ResolvedProgressOptions {
  delayMs: number;
  color: string;
  height: number;
}

export interface ProgressRuntime {
  show(): void;
  hide(): void;
  fail(): void;
  close(): void;
}
