"use server";
import { createElement } from "react";
import { Counter } from "../../../components/counter";

// Answers with what React Server Components send besides plain JSON.
export async function kinds() {
  const form = new FormData();
  form.append("name", "reply");
  return {
    panels: new Map([["main", createElement(Counter, { start: 5, label: "Mapped" })]]),
    symbol: Symbol.for("farm.kinds"),
    error: new Error("kept on the server"),
    items: (function* () {
      yield "x";
      yield "y";
    })(),
    blob: new Blob(["four"], { type: "text/plain" }),
    form,
  };
}
