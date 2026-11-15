import type { MobileGeneratedFile, MobilePageShells } from "@farm.js/core/mobile";

/** A shell's file name as core writes it: its content hash. */
const SHELL_FILE = /^[0-9a-f]{16}\.html$/;

/**
 * The page shells under `dir` in the native project, one file per distinct shell. The route map
 * travels in `farm-routes.json` (`shells`). Empty without shells.
 */
export function createPageShellFiles(
  shells: MobilePageShells | undefined,
  dir: string,
): MobileGeneratedFile[] {
  if (!shells) return [];
  return Object.entries(shells.files).map(([file, html]) => {
    if (!SHELL_FILE.test(file))
      throw new Error(`Refusing to write the page shell ${JSON.stringify(file)}.`);
    return { path: `${dir}/${file}`, contents: html };
  });
}
