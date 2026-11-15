"use client";
import { toast } from "sonner";

export function ToastButton() {
  return (
    <button type="button" onClick={() => toast("Saved from a client component")}>
      Show toast
    </button>
  );
}
