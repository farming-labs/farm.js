import { defineAgent } from "agent-unit";

// Pauses for a person's approval, then finishes; the pause survives restarts and redeploys.
export default defineAgent(async (input: { orderId: string }, run) => {
  const order = await run.step("look up order", async () => ({ id: input.orderId, total: 42 }));
  const { approved } = await run.interrupt<{ approved: boolean }>("approve-refund", order);
  return approved ? `refunded ${order.id}` : `kept ${order.id}`;
});
