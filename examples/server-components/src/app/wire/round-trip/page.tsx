import { RoundTripView } from "./round-trip-view";

export default function RoundTripPage() {
  const prefix = "hello";
  return (
    <section>
      <h1>Round trip</h1>
      <RoundTripView
        greet={async (...names: string[]) => {
          "use server";
          return [prefix, ...names].join(" ");
        }}
      />
    </section>
  );
}
