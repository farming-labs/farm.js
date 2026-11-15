import { ThemeProvider } from "next-themes";
import { ThemeName } from "../../../components/compat/theme-label";

// A package provider used straight from a server component, as its README shows for RSC.
export default function ThemesPage() {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      <section>
        <h1>next-themes</h1>
        <p>Server text inside the provider.</p>
        <ThemeName />
      </section>
    </ThemeProvider>
  );
}
