import type { PageProps } from "@farmjs/core";
import { DocsOverview } from "../../components/docs/article";

export const metadata = {
  title: "Docs - Farm.js",
  description: "Farm.js documentation - Getting started, routing, layouts, and more.",
};

export default function DocsIndexPage(_props: PageProps) {
  return <DocsOverview />;
}
