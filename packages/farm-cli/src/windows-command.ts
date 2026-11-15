/** A program and its arguments, ready for `spawn` or `execFileSync`. */
export interface SpawnCommand {
  file: string;
  args: string[];
  /** Set when `file` is a complete, escaped cmd.exe command line. */
  shell?: true;
}

// The characters cmd.exe gives a meaning; a caret makes each one literal. This is the escaping
// cross-spawn uses, so spaces, &, ^, %, quotes and parentheses reach the program unchanged.
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeForCmd(value: string): string {
  return value.replace(CMD_METACHARACTERS, "^$1");
}

/**
 * Quote an argument the way the program's C runtime splits its command line, then escape it for
 * cmd.exe twice: once for the cmd.exe that runs the batch file and once for the batch file's own
 * `%*`, which cmd.exe parses again before it starts the real program.
 */
function quoteBatchArgument(argument: string): string {
  const quoted = `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return escapeForCmd(escapeForCmd(quoted));
}

/**
 * How to run `file` with `args`. Windows runs a .cmd or .bat file (an npm bin shim, gradlew.bat)
 * only through cmd.exe, and Node's `shell: true` joins the file and arguments without quoting
 * them, so a path with a space splits apart there. This escapes the command line itself and
 * hands it to the shell whole, with no arguments left for Node to join.
 */
export function createSpawnCommand(
  file: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SpawnCommand {
  if (platform !== "win32" || !/\.(?:bat|cmd)$/i.test(file)) return { file, args: [...args] };
  return {
    file: [escapeForCmd(file), ...args.map(quoteBatchArgument)].join(" "),
    args: [],
    shell: true,
  };
}
