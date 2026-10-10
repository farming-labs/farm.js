// Runs the mock model for trying the example without a key:
//   node --experimental-strip-types test/serve-mock.ts
//   AI_BASE_URL=<printed url> pnpm dev
import { startMockOpenAI } from "./mock-openai.ts";

const mock = await startMockOpenAI(Number(process.env.PORT ?? 0));
console.log(`AI_BASE_URL=${mock.url}`);
