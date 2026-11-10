"use client";
import { useFormStatus } from "react-dom";

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" data-testid="pending" data-pending={String(pending)}>
      {pending ? "Saving" : "Finish"}
    </button>
  );
}

// React reads useFormStatus from a form it renders, so the form is part of the client component.
export function PendingForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Pending />
    </form>
  );
}
