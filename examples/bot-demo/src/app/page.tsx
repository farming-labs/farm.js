import { useRef, useState, type FormEvent } from "react";
import { BotCheck, type BotCheckHandle } from "@farm.js/bot/react";

export default function SignupPage() {
  const check = useRef<BotCheckHandle>(null);
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/signup", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    const body = (await response.json()) as { created?: string; error?: string };
    setStatus(response.ok ? `${response.status}: created ${body.created}` : `${response.status}: ${body.error}`);
    // Tokens are single-use, so every attempt needs a new one.
    setVerified(false);
    check.current?.reset();
  }

  return (
    <form onSubmit={submit}>
      <h1>Create account</h1>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" defaultValue="ada@example.com" required />
      <BotCheck ref={check} theme="light" onVerify={() => setVerified(true)} onExpire={() => setVerified(false)} />
      <button disabled={!verified}>Sign up</button>
      <p role="status">{status}</p>
    </form>
  );
}
