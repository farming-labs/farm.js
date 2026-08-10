import pc from "picocolors";

export const logger = {
  info: (message: string) => console.log(`${pc.blue("ℹ")} ${message}`),
  success: (message: string) => console.log(`${pc.green("✓")} ${message}`),
  warn: (message: string) => console.warn(`${pc.yellow("⚠")} ${message}`),
  error: (message: string) => console.error(`${pc.red("✗")} ${message}`),
};

export function showBanner() {
  const art = [
    "░██████████   ░███    ░█████████  ░███     ░███         ░█████   ░██████",
    "░██          ░██░██   ░██     ░██ ░████   ░████           ░██   ░██   ░██",
    "░██         ░██  ░██  ░██     ░██ ░██░██ ░██░██           ░██  ░██",
    "░█████████ ░█████████ ░█████████  ░██ ░████ ░██           ░██   ░████████",
    "░██        ░██    ░██ ░██   ░██   ░██  ░██  ░██     ░██   ░██          ░██",
    "░██        ░██    ░██ ░██    ░██  ░██       ░██     ░██   ░██   ░██   ░██",
    "░██        ░██    ░██ ░██     ░██ ░██       ░██ ░██  ░██████     ░██████",
  ];

  console.log("");
  for (const line of art) {
    console.log(pc.cyan(line));
  }
  console.log("");
  console.log(
    pc.bold(pc.green("Create FARMJS App")) + pc.dim("  a framework for product-integrated apps"),
  );
  console.log("");
}
