"use client";
import { Suspense, use, useState } from "react";

type QuoteData = { text: string; at: Date };

function QuoteText({ quote }: { quote: Promise<QuoteData> }) {
  const { text, at } = use(quote);
  return <q data-testid="quote">{`${text} (${at.getUTCFullYear()})`}</q>;
}

// The page passes its data unawaited: the quote streams in, and the button works before it does.
export function Quote({ quote }: { quote: Promise<QuoteData> }) {
  const [likes, setLikes] = useState(0);
  return (
    <figure>
      <Suspense fallback={<p data-testid="quote-fallback">Loading quote</p>}>
        <QuoteText quote={quote} />
      </Suspense>
      <button type="button" onClick={() => setLikes(likes + 1)}>
        {`Likes: ${likes}`}
      </button>
    </figure>
  );
}
