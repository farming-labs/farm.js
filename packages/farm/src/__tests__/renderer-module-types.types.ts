import { expectTypeOf } from "vitest";
import type {
  FarmRendererClientModule,
  FarmRendererClientRuntime,
  FarmRendererServerModule,
  FarmServerRendererRuntime,
} from "../renderer-entry";

// The old names stay as aliases, so a renderer typed against either keeps compiling.
expectTypeOf<FarmServerRendererRuntime>().toEqualTypeOf<FarmRendererServerModule>();
expectTypeOf<FarmRendererClientRuntime>().toEqualTypeOf<FarmRendererClientModule>();
