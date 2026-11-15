import { SalesChart } from "../../../components/compat/chart";

// recharts draws in a client component; the data comes from the server component.
export default function ChartPage() {
  const data = [
    { month: "Jan", sales: 12 },
    { month: "Feb", sales: 19 },
    { month: "Mar", sales: 7 },
  ];
  return <SalesChart data={data} />;
}
