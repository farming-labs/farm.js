export function formatCompactPreviewDuration(durationMs: number) {
  if (durationMs % 86_400_000 === 0) return `${durationMs / 86_400_000}d`;
  if (durationMs % 3_600_000 === 0) return `${durationMs / 3_600_000}h`;
  return `${Math.ceil(durationMs / 60_000)}m`;
}
