"use server";
import { createElement } from "react";
import { Counter } from "../../../components/counter";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns before its elements are ready, as an RSC action can.
export async function reveal() {
  return {
    later: wait(50).then(() =>
      createElement("strong", null, "revealed ", createElement(Counter, { start: 7, label: "Revealed" })),
    ),
  };
}
