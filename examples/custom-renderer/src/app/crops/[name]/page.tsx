import type { PageProps } from "@farm.js/core";
import { notFound } from "@farm.js/core/navigation";
import { useRouter } from "farm-leaf/bindings";
import { CROPS } from "../../../server/crops";

type CropProps = PageProps<"/crops/[name]">;

export function generateMetadata({ params }: CropProps) {
  return { title: `Crop: ${params.name}` };
}

export default function CropPage({ params }: CropProps) {
  if (!(CROPS as readonly string[]).includes(params.name)) notFound();
  // The page doesn't hydrate, so this is the router as the server reads it.
  const router = useRouter();
  return (
    <section>
      <h1 id="crop">Crop: {params.name}</h1>
      <p id="crop-path">path: {router.pathname}</p>
    </section>
  );
}
