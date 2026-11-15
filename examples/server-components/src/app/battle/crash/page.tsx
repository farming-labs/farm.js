import { Clicker, HydrationCrash } from "../../../components/battle/crash";

export default function CrashPage() {
  return (
    <section>
      <h1>Crash</h1>
      <Clicker name="before" />
      <HydrationCrash />
      <Clicker name="after" />
    </section>
  );
}
