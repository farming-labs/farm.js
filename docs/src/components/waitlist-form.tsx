"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api-client";
import { DitherShader } from "./ui/dither-shader";

type WaitlistResult = NonNullable<Awaited<ReturnType<typeof api.waitlist.post>>["data"]>;

function EdgePlus({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-10 size-4 ${className}`}>
      <span className="absolute left-1/2 top-0 h-full -translate-x-1/2 border-l border-white/[0.34]" />
      <span className="absolute left-0 top-1/2 w-full -translate-y-1/2 border-t border-white/[0.34]" />
    </span>
  );
}

export function WaitlistForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const scrollStateRef = useRef<null | {
    htmlOverflow: string;
    bodyOverflow: string;
    htmlOverscrollBehavior: string;
    bodyOverscrollBehavior: string;
  }>(null);
  const [result, setResult] = useState<WaitlistResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const statusTone = result?.ok ? "success" : result?.ok === false ? "error" : "muted";
  const statusMessage = isSubmitting
    ? "Adding you to the list..."
    : result?.ok
      ? "You are on the list. We will reach out soon."
      : result?.error || "we read every note";

  function lockPageScroll() {
    if (scrollStateRef.current || typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    scrollStateRef.current = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "contain";
    body.style.overscrollBehavior = "contain";
  }

  function unlockPageScroll() {
    if (!scrollStateRef.current || typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    html.style.overflow = scrollStateRef.current.htmlOverflow;
    body.style.overflow = scrollStateRef.current.bodyOverflow;
    html.style.overscrollBehavior = scrollStateRef.current.htmlOverscrollBehavior;
    body.style.overscrollBehavior = scrollStateRef.current.bodyOverscrollBehavior;
    scrollStateRef.current = null;
  }

  useEffect(() => unlockPageScroll, []);

  function openDialog() {
    const dialog = dialogRef.current;

    setResult(null);

    if (!dialog) {
      return;
    }

    lockPageScroll();

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    window.setTimeout(() => emailRef.current?.focus(), 40);
  }

  function closeDialog() {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }

    unlockPageScroll();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") || "");
    const description = String(formData.get("description") || "");

    setIsSubmitting(true);
    setResult(null);

    try {
      const { data, error } = await api.waitlist.post({
        body: {
          email,
          description,
        },
      });

      const nextResult =
        data ||
        ({
          ok: false,
          error: error?.message || "Could not join the waitlist yet. Please try again in a moment.",
        } satisfies WaitlistResult);

      if (error && !data) {
        setResult(nextResult);
        return;
      }

      setResult(nextResult);

      if (nextResult.ok) {
        form.reset();
      }
    } catch (error) {
      setResult({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not join the waitlist yet. Please try again in a moment.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-9 w-full max-w-xs sm:mt-12">
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-none border border-white bg-white px-6 font-mono text-xs font-bold uppercase tracking-[0.1em] text-black transition hover:bg-black hover:text-white sm:min-w-64 sm:px-9 sm:py-5 sm:text-sm sm:tracking-[0.12em]"
      >
        <span aria-hidden>~/</span>
        join waitlist
      </button>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-white/42 sm:mt-5 sm:text-xs sm:tracking-[0.12em]">
        this website runs on{" "}
        <span className="border-b border-dotted border-white/35 pb-0.5 text-white/62">farm.js</span>
      </p>

      <dialog
        ref={dialogRef}
        onClose={unlockPageScroll}
        onCancel={unlockPageScroll}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
        className="relative w-[min(92vw,38rem)] max-w-none overflow-visible rounded-none border-0 bg-transparent p-0 text-white shadow-none backdrop:bg-black/72 backdrop:backdrop-blur-md"
      >
        <div className="relative">
          <EdgePlus className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
          <EdgePlus className="bottom-0 right-0 translate-x-1/2 translate-y-1/2" />
          <div className="pointer-events-none absolute inset-y-0 left-0 border-l border-white/[0.12]" />
          <div className="pointer-events-none absolute inset-y-0 right-0 border-r border-white/[0.12]" />
          <div className="pointer-events-none absolute left-1/2 top-0 h-full border-l border-dashed border-white/[0.08]" />

          <div className="relative max-h-[92dvh] overflow-y-auto overflow-x-hidden rounded-none border border-white/15 bg-black/90 shadow-[0_0_100px_rgba(255,255,255,0.16)]">
            <div className="relative overflow-hidden rounded-none border border-white/10 bg-[radial-gradient(35%_80%_at_25%_0%,rgba(255,255,255,0.055),transparent),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] p-4 text-left sm:p-7">
              <button
                type="button"
                onClick={closeDialog}
                className="absolute right-4 top-4 z-20 rounded-none border border-white/15 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white/62 transition hover:border-white/35 hover:text-white"
              >
                close
              </button>

              <div className="relative -mx-4 -mt-4 overflow-hidden border-b border-white/[0.07] px-4 pb-5 pt-5 sm:-mx-7 sm:-mt-7 sm:px-7 sm:pb-6 sm:pt-7">
                <DitherShader
                  aria-hidden
                  animated
                  animationSpeed={0.02}
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-45 [mask-image:linear-gradient(to_bottom,black_0%,black_72%,transparent_100%)]"
                  colorMode="duotone"
                  ditherMode="bayer"
                  gridSize={3}
                  primaryColor="#000000"
                  secondaryColor="#ffffff"
                  threshold={0.52}
                />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_90%_at_25%_0%,rgba(255,255,255,0.08),transparent_65%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.52))]" />

                <div className="relative z-10 pr-16">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/58">
                    // waitlists
                  </p>
                  <h2 className="mt-4 max-w-xl font-geist-pixel text-[1.6rem] font-medium leading-none tracking-[-0.01em] text-white sm:text-4xl">
                    Tell us what Farm.js should unlock.
                  </h2>
                  <p className="mt-3 max-w-lg font-sans text-sm leading-6 text-white/56 sm:text-base sm:leading-7">
                    We are shaping the framework around the product work that slows teams down.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="mt-4 grid gap-3 sm:mt-5 sm:gap-3.5">
                <label className="grid gap-2" htmlFor="waitlist-email">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white/52">
                    Email
                  </span>
                  <input
                    id="waitlist-email"
                    name="email"
                    type="email"
                    ref={emailRef}
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="min-h-12 rounded-none border border-white/10 bg-white/[0.055] px-4 font-mono text-[13px] text-white outline-none transition placeholder:text-white/34 focus:border-white/45 focus:bg-white/[0.09]"
                  />
                </label>

                <label className="grid gap-2" htmlFor="waitlist-description">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white/52">
                    What do you want to see from Farm.js?
                  </span>
                  <textarea
                    id="waitlist-description"
                    name="description"
                    required
                    rows={4}
                    maxLength={1200}
                    placeholder="auth, data, mobile, deployment, billing, docs, anything..."
                    className="min-h-28 resize-none rounded-none border border-white/10 bg-white/[0.055] px-4 py-3 font-mono text-[13px] leading-6 text-white outline-none transition placeholder:text-white/34 focus:border-white/45 focus:bg-white/[0.09]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 items-center justify-center rounded-none border border-white bg-white px-6 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-black hover:text-white disabled:cursor-wait disabled:opacity-70"
                >
                  {isSubmitting ? "joining..." : "join waitlist"}
                </button>

                <p
                  data-tone={statusTone}
                  aria-live="polite"
                  className="min-h-5 font-mono text-[11px] uppercase tracking-[0.1em] text-white/45 data-[tone=error]:text-white data-[tone=success]:text-white"
                >
                  {statusMessage}
                </p>
              </form>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
