"use client";

import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

const styles = stylex.create({
  page: {
    alignItems: "center",
    display: "flex",
    justifyContent: "center",
    minHeight: "100vh",
    padding: 24,
  },
  card: {
    backgroundColor: "white",
    border: "1px solid #dce2d8",
    borderRadius: 18,
    boxShadow: "0 18px 48px rgba(41, 52, 38, 0.12)",
    display: "grid",
    gap: 18,
    maxWidth: 560,
    padding: 32,
    width: "100%",
  },
  eyebrow: {
    color: "#5b6757",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.12em",
    margin: 0,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 40,
    letterSpacing: "-0.04em",
    lineHeight: 1,
    margin: 0,
  },
  copy: {
    color: "#5b6757",
    lineHeight: 1.6,
    margin: 0,
  },
  button: {
    backgroundColor: "#1f2420",
    border: 0,
    borderRadius: 10,
    color: "white",
    cursor: "pointer",
    justifySelf: "start",
    paddingBlock: 11,
    paddingInline: 16,
    transition: "background-color 160ms ease, transform 160ms ease",

    ":hover": {
      backgroundColor: "#40513a",
      transform: "translateY(-1px)",
    },

    ":focus-visible": {
      outline: "3px solid #9fbd91",
      outlineOffset: 3,
    },
  },
});

export default function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.card)}>
        <p {...stylex.props(styles.eyebrow)}>Farm + StyleX</p>
        <h1 {...stylex.props(styles.title)}>One config entry.</h1>
        <p {...stylex.props(styles.copy)}>
          These styles are extracted at build time and update through CSS HMR during development.
        </p>
        <button {...stylex.props(styles.button)} onClick={() => setCount((value) => value + 1)}>
          Count: {count}
        </button>
      </section>
    </main>
  );
}
