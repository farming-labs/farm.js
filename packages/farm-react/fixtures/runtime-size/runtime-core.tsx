import React from "react";
import { createRoot } from "react-dom/client";
import { createCompiledComponentWithFeatures } from "@farm.js/react/compiler-runtime";

const Counter = createCompiledComponentWithFeatures(
  {
    displayName: "RuntimeCoreCounter",
    initialize: () => [0],
    render(_props, state) {
      return (
        <button onClick={() => state[0].set((value) => Number(value) + 1)}>
          Count: {Number(state[0].get())}
        </button>
      );
    },
    bindings: [
      {
        kind: "text",
        path: [],
        dependencies: [0],
        read: (_props, state) => ["Count: ", state[0].get()],
      },
    ],
  },
  [],
);

createRoot(document.body).render(<Counter />);
