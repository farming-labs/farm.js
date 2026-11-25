/** A `.leaf` file that can't compile. The message names the file, the line, and the fix. */
export declare class LeafCompileError extends Error {
  readonly code: "LEAF_COMPILE_ERROR";
  readonly file: string;
  readonly line: number;
  constructor(file: string, line: number, reason: string);
}

export declare function compileLeaf(source: string, name?: string, file?: string): string;
export declare function componentName(file: string): string;
