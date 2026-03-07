import pc from "picocolors";

export const logger = {
  info: (message: string) => console.log(`${pc.blue("ℹ")} ${message}`),
  success: (message: string) => console.log(`${pc.green("✓")} ${message}`),
  warn: (message: string) => console.warn(`${pc.yellow("⚠")} ${message}`),
  error: (message: string) => console.error(`${pc.red("✗")} ${message}`),
};

export function showBanner() {
  const art = [
    " _______                         ",
    "|  ___  |__ _ _ __ _ __ ___     ",
    "| |_ /| / _` | '__| '_ ` _ \\ ",
    "|  _ \\| | (_| | |  | | | | | | ",
    "|_| \\_\\_|\\__,_|_|  |_| |_| |_|",
  ];

  console.log("");
  for (const line of art) {
    console.log(pc.cyan(line));
  }
  console.log(pc.bold(pc.green("Create Farm.js App")) + pc.dim("  modern React meta-framework"));
  console.log("");
}
