"use client";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

export function SalesChart({ data }: { data: Array<{ month: string; sales: number }> }) {
  return (
    <div data-testid="chart">
      <BarChart width={320} height={200} data={data}>
        <XAxis dataKey="month" />
        <YAxis />
        <Bar dataKey="sales" fill="#888" isAnimationActive={false} />
      </BarChart>
    </div>
  );
}
