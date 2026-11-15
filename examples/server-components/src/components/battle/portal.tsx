"use client";
import { useState } from "react";
import { createPortal } from "react-dom";

export function PortalDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open
        ? createPortal(
            <div role="dialog" aria-label="Battle dialog">
              <p>Portal content</p>
              <button type="button" onClick={() => setOpen(false)}>
                Close dialog
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
