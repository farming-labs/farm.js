"use client";
import { useState } from "react";
import styles from "./styled.module.css";

export function StyledToggle() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" className={styles.toggle} data-testid="styled-toggle" onClick={() => setOn(!on)}>
      {on ? "styled on" : "styled off"}
    </button>
  );
}
