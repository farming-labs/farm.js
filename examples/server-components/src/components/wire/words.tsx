"use client";
import { useEffect, useState } from "react";

async function* read(source: ReadableStream<string> | AsyncIterable<string>) {
  if (source instanceof ReadableStream) {
    const reader = source.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      yield chunk.value;
    }
    return;
  }
  yield* source;
}

// Shows each word as the stream delivers it, then "(done)".
export function Words({
  label,
  words,
}: {
  label: string;
  words: ReadableStream<string> | AsyncIterable<string>;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    let stopped = false;
    void (async () => {
      for await (const word of read(words)) {
        if (stopped) return;
        setText((shown) => (shown ? `${shown} ${word}` : word));
      }
      if (!stopped) setText((shown) => `${shown} (done)`);
    })();
    return () => {
      stopped = true;
    };
  }, [words]);
  return <p data-testid={label}>{text}</p>;
}
