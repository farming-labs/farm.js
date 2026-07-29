import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

// Server functions run on the server but can be called from forms and client components.
// Farm adds the underlying React "use server" boundary for createServerFn exports.

// Simulated database
const messages: { id: number; name: string; message: string; timestamp: string }[] = [];
let nextId = 1;

const publicMessageSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  message: z.string(),
  timestamp: z.string(),
});

/**
 * Submit a message - Server Action
 * This function runs on the server, even when called from a client component.
 */
export const submitMessage = createServerFn({
  input: z.object({
    name: z.string().trim().min(1, "Name is required"),
    message: z.string().trim().min(1, "Message is required"),
  }),
  output: z.object({
    success: z.literal(true),
    message: publicMessageSchema,
  }),
  async handler({ input }) {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // In a real app, you'd save to a database here
    const newMessage = {
      id: nextId++,
      name: input.name,
      message: input.message,
      timestamp: new Date().toISOString(),
    };
    messages.push(newMessage);

    return {
      success: true,
      message: newMessage,
    };
  },
});

/**
 * Get all messages - Server Action
 */
export async function getMessages() {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));
  return messages;
}

/**
 * Delete a message - Server Action
 */
export async function deleteMessage(id: number) {
  await new Promise((resolve) => setTimeout(resolve, 200));

  const index = messages.findIndex((m) => m.id === id);
  if (index === -1) {
    return { success: false, error: "Message not found" };
  }

  messages.splice(index, 1);

  return { success: true };
}
