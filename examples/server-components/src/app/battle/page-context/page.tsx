import { ThemeLabel, ThemeProvider, ThemeToggle } from "../../../components/theme";

// The provider sits in the page, not a layout, with server output between it and its consumers.
export default function PageContextPage() {
  return (
    <section>
      <h1>Page context</h1>
      <ThemeProvider>
        <ThemeToggle />
        <article>
          <p>Static server text between the provider and its consumer.</p>
          <ThemeLabel />
        </article>
      </ThemeProvider>
    </section>
  );
}
