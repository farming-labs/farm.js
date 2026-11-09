import pc from "picocolors";

export const logger = {
  info: (message: string) => console.log(`${pc.blue("ℹ")} ${message}`),
  success: (message: string) => console.log(`${pc.green("✓")} ${message}`),
  warn: (message: string) => console.warn(`${pc.yellow("⚠")} ${message}`),
  error: (message: string) => console.error(`${pc.red("✗")} ${message}`),
};

export function showStarInvitation(isInteractive = Boolean(process.stdout.isTTY)) {
  if (!isInteractive) return;

  logger.info("");
  logger.info("Enjoying Farm? Star it: https://github.com/farming-labs/farm.js");
}

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
    pc.bold(pc.green("Create FARMJS App")) + pc.dim("  the framework for the web and agents"),
  );
  console.log("");
}
