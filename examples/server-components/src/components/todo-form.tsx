"use client";

// A client component that receives a server action as a prop.
export function TodoForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action}>
      <input name="title" aria-label="Item" />
      <button type="submit">Add item</button>
    </form>
  );
}
