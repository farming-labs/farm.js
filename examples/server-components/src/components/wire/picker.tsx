"use client";

export function Picker({ onPick }: { onPick: () => void }) {
  return (
    <button type="button" onClick={onPick}>
      Pick
    </button>
  );
}
