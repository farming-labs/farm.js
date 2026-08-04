export default function NotFound() {
  return (
    <section
      aria-describedby="docs-not-found-description"
      aria-labelledby="docs-not-found-title"
      className="grid min-h-screen min-h-[100svh] place-items-center bg-[#0a0a0a] px-6 text-[#ededed]"
    >
      <div className="flex w-full max-w-[280px] flex-col items-center">
        <h1
          className="-translate-x-[3px] font-mono text-[clamp(88px,20vw,140px)] font-extrabold leading-[0.75] tracking-[-0.1em] text-[#0a0a0a] [-webkit-text-stroke:2px_#ededed] [text-shadow:5px_5px_0_#ededed]"
          id="docs-not-found-title"
        >
          404
        </h1>

        <p
          className="mb-[30px] mt-[34px] flex w-full items-center gap-3 whitespace-nowrap font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-[#a1a1a1] before:h-px before:flex-1 before:bg-white/20 before:content-[''] after:h-px after:flex-1 after:bg-white/20 after:content-['']"
          id="docs-not-found-description"
        >
          Not found
        </p>

        <a
          className="inline-flex min-h-11 min-w-[132px] items-center justify-center border border-[#ededed] bg-[#ededed] px-5 text-sm font-medium leading-none text-[#0a0a0a] no-underline transition-[opacity,transform] duration-150 hover:opacity-[0.78] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#ededed] motion-reduce:transition-none motion-reduce:active:translate-y-0"
          href="/"
        >
          Go home
        </a>
      </div>
    </section>
  );
}
