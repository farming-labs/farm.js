import net from "node:net";

export async function devPortOpen(port, output) {
  // Vite briefly listens on wildcard addresses before binding the actual HTTP server.
  if (!output.join("").includes(`http://localhost:${port}/`)) return false;
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
