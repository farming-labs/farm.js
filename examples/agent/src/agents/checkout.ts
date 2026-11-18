import { defineAgent } from "agent-unit";

export default defineAgent(async (input: { orderId: string }, run) => {
  const payment = await run.waitFor<{ orderId: string; amount: number }>("payment.succeeded", {
    match: { orderId: input.orderId },
    timeout: "1h",
  });
  return { orderId: input.orderId, paid: payment.amount };
});
