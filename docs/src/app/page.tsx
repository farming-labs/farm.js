import type { PageProps } from "@farmjs/core";
import { ConsoleAscii } from "../components/console-ascii";
import { WaitlistForm } from "../components/waitlist-form";
import { DitherShader } from "../components/ui/dither-shader";

export const metadata = {
  title: "farmjs.dev - React framework for integrated apps",
  description:
    "Farm.js is the comprehensive JavaScript framework for shipping full products with React, with auth, data, billing, and deployment working as one system.",
};

const asciiRows = [
  "              . .     . .       . .     .     . .             . .       . .     . .       . .       . .     .",
  "     . . .     ? ?   .   + +       . .   ? ?     . .     + +       . .     ? ?       . .       + +     . .",
  "   . . ? ? + + # #   . . ? ? + +   . .   # #   ? ? + +   . .   @ @   . .   + +   ? ?   . .   # #   . .",
  " . . + + ? ? # # @ @ . . + + ? ? # #   . . + + ? ? # #   . . @ @ # #   . . + + ? ? # #   . . @ @",
  "? ? + + # # @ @ $ $ ? ? + + # # @ @   ? ? + + # # @ @   ? ? # # @ @ $ $   ? ? + + # # @ @   ? ?",
  "+ + # # @ @ $ $ % % + + # # @ @ $ $   + + # # @ @ $ $   + + @ @ $ $ % %   + + # # @ @ $ $   + +",
  "# # @ @ $ $ % % S S # # @ @ $ $ % %   # # @ @ $ $ % %   # # $ $ % % S S   # # @ @ $ $ % %   # #",
  "@ @ $ $ % % S S ? ? @ @ $ $ % % S S   @ @ $ $ % % S S   @ @ % % S S ? ?   @ @ $ $ % % S S   @ @",
  "$ $ % % S S ? ? + + $ $ % % S S ? ?   $ $ % % S S ? ?   $ $ S S ? ? + +   $ $ % % S S ? ?   $ $",
  "% % S S ? ? + + # # % % S S ? ? + +   % % S S ? ? + +   % % ? ? + + # #   % % S S ? ? + +   % %",
  "S S ? ? + + # # @ @ S S ? ? + + # #   S S ? ? + + # #   S S + + # # @ @   S S ? ? + + # #   S S",
  "? ? + + # # @ @ $ $ ? ? + + # # @ @   ? ? + + # # @ @   ? ? # # @ @ $ $   ? ? + + # # @ @   ? ?",
  "+ + # # @ @ $ $ % % + + # # @ @ $ $   + + # # @ @ $ $   + + @ @ $ $ % %   + + # # @ @ $ $   + +",
  "# # @ @ $ $ % % S S # # @ @ $ $ % %   # # @ @ $ $ % %   # # $ $ % % S S   # # @ @ $ $ % %   # #",
  "@ @ $ $ % % S S @ @ @ @ $ $ % % S S   @ @ $ $ % % S S   @ @ % % S S @ @   @ @ $ $ % % S S   @ @",
];

const asciiField = asciiRows.map((row) => `${row}     ${row}`).join("\n");
const heroGridCells = Array.from({ length: 8 }, (_, index) => index);

function HeroGridRow({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`hidden md:flex ${className}`}>
      {heroGridCells.map((cell) => (
        <div
          key={cell}
          className="h-6 flex-1 border-l border-white/[0.105] last:border-r md:h-8 lg:h-9"
        />
      ))}
    </div>
  );
}

function HeroSideRail({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`hidden border-white/[0.105] md:grid md:grid-rows-8 ${className}`}>
      {heroGridCells.map((cell) => (
        <div key={cell} className="border-b border-white/[0.105] last:border-b-0" />
      ))}
    </div>
  );
}

function HeroCornerMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute z-20 size-5 ${className}`}>
      <span className="absolute left-1/2 top-0 h-full -translate-x-1/2 border-l border-white/25" />
      <span className="absolute left-0 top-1/2 w-full -translate-y-1/2 border-t border-white/25" />
    </span>
  );
}

export default function HomePage(_props: PageProps) {
  return (
    <div className="relative isolate min-h-screen min-h-dvh overflow-hidden bg-black font-mono text-white">
      <ConsoleAscii />
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,#000_0%,#020202_56%,#000_100%)]" />
      <DitherShader
        aria-hidden
        animated
        animationSpeed={0.03}
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-70 [mask-image:linear-gradient(to_bottom,transparent_0%,transparent_24%,black_43%,black_100%)]"
        colorMode="duotone"
        ditherMode="bayer"
        gridSize={3}
        primaryColor="#000000"
        secondaryColor="#ffffff"
        threshold={0.53}
      />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[62vh] bg-gradient-to-b from-transparent via-white/[0.02] to-white/[0.04]" />

      <pre
        aria-hidden
        className="pointer-events-none absolute inset-x-1/2 bottom-[-0.5rem] -z-10 w-[86rem] -translate-x-1/2 select-none whitespace-pre font-mono text-[9px] leading-[1.1] tracking-[0.04em] text-white/[0.22] [mask-image:linear-gradient(to_bottom,transparent_0%,black_18%,black_100%)] sm:w-[140rem] sm:text-[13px] md:w-[190rem] md:text-[18px]"
        children={asciiField}
      />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[52vh] bg-gradient-to-b from-black via-black/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-black to-transparent" />

      <section className="mx-auto flex min-h-screen min-h-dvh w-full max-w-[92rem] flex-col items-center justify-center px-3 py-4 text-center sm:px-6 sm:py-6 lg:px-8">
        <div className="relative grid min-h-[calc(100dvh-2rem)] w-full grid-cols-10 border-y border-white/[0.12] bg-black/15 sm:min-h-[min(46rem,calc(100dvh-3rem))] md:border-x">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(65%_90%_at_50%_100%,rgba(255,255,255,0.07),transparent_70%)] [mask-image:linear-gradient(to_top,black_0%,transparent_72%)]" />
          <HeroCornerMark className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
          <HeroCornerMark className="bottom-0 right-0 translate-x-1/2 translate-y-1/2" />

          <HeroSideRail className="border-r" />

          <div className="col-span-10 flex min-h-0 flex-col md:col-span-8">
            <HeroGridRow className="border-b border-white/[0.105]" />

            <div className="relative flex min-h-[calc(100dvh-2rem)] flex-1 flex-col items-center justify-center overflow-hidden border border-white/[0.09] bg-black/30 px-4 py-8 text-center sm:min-h-[24rem] sm:px-8 md:min-h-[27rem] md:px-12 lg:px-16">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_70%_at_50%_0%,rgba(255,255,255,0.07),transparent_68%)]" />
              <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed border-white/[0.105]" />

              <div className="relative z-10 flex flex-col items-center">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white/80 sm:text-base sm:tracking-[0.18em]">
                  [ farm.js ]
                </p>

                <h1 className="mt-6 max-w-6xl text-balance font-sans text-[clamp(2.75rem,14vw,4.8rem)] font-medium leading-[0.92] tracking-[-0.045em] text-white sm:mt-8 sm:text-7xl md:text-8xl">
                  Accelerate your product shipping.
                </h1>

                <p className="mt-5 max-w-4xl text-balance font-sans text-base leading-7 text-white/58 sm:mt-7 sm:text-2xl sm:leading-10">
                  A comprehensive JavaScript metaframework with a lightweight core. Auth, data,
                  billing, and deployment are built into one system that runs anywhere.
                </p>

                <WaitlistForm />
              </div>
            </div>

            <div className="relative hidden md:block">
              <HeroGridRow className="border-b border-white/[0.105]" />
              <HeroGridRow className="border-b border-white/[0.105]" />
              <HeroGridRow />
            </div>
          </div>

          <HeroSideRail className="border-l" />
        </div>
      </section>
    </div>
  );
}
