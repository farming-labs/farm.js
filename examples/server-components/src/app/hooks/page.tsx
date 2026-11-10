import {
  BlockerProbe,
  LinkProbe,
  NavigationProbe,
  PageStateProbe,
  RouterProbe,
} from "../../components/hooks/probes";

export default function HooksPage() {
  return (
    <section>
      <h1>Hooks</h1>
      <RouterProbe />
      <NavigationProbe />
      <PageStateProbe />
      <BlockerProbe />
      <LinkProbe />
    </section>
  );
}
