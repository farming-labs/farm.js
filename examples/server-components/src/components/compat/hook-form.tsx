"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";

export function HookForm() {
  const { register, handleSubmit } = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const [sent, setSent] = useState("none");
  return (
    <form onSubmit={handleSubmit((values) => setSent(values.name))}>
      <input aria-label="hook name" {...register("name")} />
      <button type="submit">Send hook form</button>
      <p data-testid="hook-form">sent: {sent}</p>
    </form>
  );
}
