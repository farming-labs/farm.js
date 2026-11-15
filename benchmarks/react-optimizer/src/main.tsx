import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Bench } from "virtual:bench-component";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing benchmark root");

createRoot(root).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
