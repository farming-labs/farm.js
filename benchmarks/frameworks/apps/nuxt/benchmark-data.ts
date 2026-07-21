export const benchmarkItems = Array.from({ length: 120 }, (_, index) => ({
  id: index + 1,
  label: `Benchmark item ${String(index + 1).padStart(3, "0")}`,
}));
