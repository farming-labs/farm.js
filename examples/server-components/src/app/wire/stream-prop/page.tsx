import { Words } from "../../../components/wire/words";

export const dynamic = "force-dynamic";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readable(words: string[]) {
  return new ReadableStream<string>({
    async start(controller) {
      for (const word of words) {
        await wait(50);
        controller.enqueue(word);
      }
      controller.close();
    },
  });
}

async function* generate(words: string[]) {
  for (const word of words) {
    await wait(50);
    yield word;
  }
}

export default function StreamPropPage() {
  return (
    <section>
      <h1>Stream prop</h1>
      <Words label="readable" words={readable(["alpha", "beta", "gamma"])} />
      <Words label="iterable" words={generate(["one", "two"])} />
    </section>
  );
}
