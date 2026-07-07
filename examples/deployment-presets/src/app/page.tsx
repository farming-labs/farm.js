const presetRows = [
  {
    platform: "Vercel",
    command: "pnpm build:vercel",
    output: ".vercel/output",
  },
  {
    platform: "Cloudflare Pages",
    command: "pnpm build:cloudflare",
    output: ".output/public",
  },
  {
    platform: "Netlify",
    command: "pnpm build:netlify",
    output: ".output",
  },
];

export default function DeploymentPresetShowcase() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "48px", lineHeight: 1.5 }}>
      <p style={{ color: "#525252", margin: "0 0 8px" }}>Farm.js deployment presets</p>
      <h1 style={{ fontSize: "48px", margin: "0 0 16px" }}>One config, multiple targets.</h1>
      <p style={{ maxWidth: "680px", color: "#404040" }}>
        This example uses <code>FARM_DEPLOY_TARGET</code> to switch between Vercel,
        Cloudflare Pages, and Netlify without adding provider config files to the app.
      </p>
      <table style={{ borderCollapse: "collapse", marginTop: "32px", minWidth: "720px" }}>
        <thead>
          <tr>
            <th style={cellHeader}>Platform</th>
            <th style={cellHeader}>Build command</th>
            <th style={cellHeader}>Output</th>
          </tr>
        </thead>
        <tbody>
          {presetRows.map((row) => (
            <tr key={row.platform}>
              <td style={cell}>{row.platform}</td>
              <td style={cell}>
                <code>{row.command}</code>
              </td>
              <td style={cell}>
                <code>{row.output}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const cellHeader = {
  borderBottom: "1px solid #d4d4d4",
  color: "#525252",
  padding: "10px 14px",
  textAlign: "left" as const,
};

const cell = {
  borderBottom: "1px solid #e5e5e5",
  padding: "12px 14px",
  textAlign: "left" as const,
};
