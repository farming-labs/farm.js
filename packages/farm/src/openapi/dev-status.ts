import { logger } from "../utils";

interface OpenAPIDevStatusLogger {
  success(message: string): void;
  warn(message: string): void;
}

export function reportOpenAPIDevGenerationResult(
  spec: unknown,
  output: OpenAPIDevStatusLogger = logger,
): void {
  if (spec) {
    output.success("✅ OpenAPI documentation enabled");
    return;
  }

  output.warn("OpenAPI documentation is enabled, but its specification failed to generate.");
}
