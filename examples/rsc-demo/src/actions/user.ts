"use server";

// Server Actions - Functions that run on the server but can be called from the client
// The "use server" directive marks this file (or function) as server-only

// Simulated database
const messages: { id: number; name: string; message: string; timestamp: string }[] = [];
let nextId = 1;

/**
 * Submit a message - Server Action
 * This function runs on the server, even when called from a client component
 */
export async function submitMessage(formData: FormData) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log({formData})
  const name = formData.get("name") as string;
  const message = formData.get("message") as string;

  if (!name || !message) {
    return { success: false, error: "Name and message are required" };
  }

  // In a real app, you'd save to a database here
  const newMessage = {
    id: nextId++,
    name,
    message,
    timestamp: new Date().toISOString(),
  };
  messages.push(newMessage);

  console.log("[Server Action] Message saved:", newMessage);

  return {
    success: true,
    message: newMessage,
  };
}

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
  console.log("[Server Action] Message deleted:", id);

  return { success: true };
}
