export const runtime = "auto";
export const regions = ["iad1", "fra1"];
export const maxDuration = 30;

export default function ReportsPage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "48px", lineHeight: 1.5 }}>
      <p style={{ color: "#525252", margin: "0 0 8px" }}>Route runtime controls</p>
      <h1 style={{ fontSize: "48px", margin: "0 0 16px" }}>Regional reports</h1>
      <p style={{ maxWidth: "680px", color: "#404040" }}>
        On Vercel, this dynamic route receives its own function configuration for iad1 and fra1
        with a 30-second maximum duration. Other adapters preserve the hints in Farm's route
        runtime manifest.
      </p>
    </main>
  );
}
