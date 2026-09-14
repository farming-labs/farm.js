// @vitest-environment node
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it.each(["./types/client.d.ts", "./dist/client.d.ts"])(
  "preserves fetcher input and declared error narrowing through %s",
  (entry) => {
    const filename = path.resolve("fetcher-input-error.type-test.ts").replace(/\\/g, "/");
    const source = `
import { createAPIClient, useFetcher, useMutation, FetcherInputError } from "@farm.js/core/client";
import type { useFetcher as builtFetcher } from "./dist/client";
const publicAsBuilt: typeof builtFetcher = useFetcher;
const builtAsPublic: typeof useFetcher = {} as typeof builtFetcher;
type Router = { count: { post: { __types: {
  body: { count: number }; query: never; response: number;
  errors: { INVALID_COUNT: { data: { minimum: number }; status: 422 } };
} } } };
const api = createAPIClient<Router>();
const fetcher = useFetcher(api.count.post, {
  mapFormData: form => ({ body: { count: Number(form.get("count")) } }),
  onError(error, variables) {
    if (error instanceof FetcherInputError) {
      const code: "input_error" = error.code;
      const cause: unknown = error.cause;
    } else if (error.code === "INVALID_COUNT") {
      const minimum: number = error.data.minimum;
      const status: 422 = error.status;
      // @ts-expect-error declared error data must not be any
      const wrong: string = error.data.minimum;
    }
    const count: number | undefined = variables?.body.count;
  },
  request: { onError(error) {
    // @ts-expect-error local mapping errors never come from the HTTP client
    const local: "input_error" = error.code;
  } },
});
if (fetcher.error?.code === "INVALID_COUNT") {
  const minimum: number = fetcher.error.data.minimum;
}
fetcher.submit(new FormData());
fetcher.submit({ body: { count: 4 } });
// @ts-expect-error input inference is preserved
fetcher.submit({ body: { count: "4" } });
const mutation = useMutation(api.count.post);
if (mutation.error?.code === "INVALID_COUNT") {
  const minimum: number = mutation.error.data.minimum;
}
type ServerTarget = ((value: number) => Promise<number>) & {
  readonly __farmServerFnError: Error & { code: "REMOTE" };
};
const serverFetcher = useFetcher({} as ServerTarget);
if (serverFetcher.error?.code === "REMOTE") {
  const code: "REMOTE" = serverFetcher.error.code;
}
// The internal preparation hook is not a published API.
// @ts-expect-error internal lifecycle is not exported
import { useMutationLifecycle } from "@farm.js/core/client";
`;
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      baseUrl: process.cwd(),
      paths: { "@farm.js/core/client": [entry] },
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === filename
        ? ts.createSourceFile(name, source, languageVersion, true)
        : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram({ rootNames: [filename], options, host });
    const diagnostics = ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
    expect(diagnostics).toBe("");
  },
);
