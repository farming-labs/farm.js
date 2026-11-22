import type { PageProps } from "@farm.js/core";
import { notFound } from "@farm.js/core/navigation";
import { CROPS } from "../../../server/crops";

type CropProps = PageProps<"/crops/[name]">;

export function generateMetadata({ params }: CropProps) {
  return { title: `Crop: ${params.name}` };
}

export default function CropPage({ params }: CropProps) {
  if (!(CROPS as readonly string[]).includes(params.name)) notFound();
  return (
    <section>
      <h1 id="crop">Crop: {params.name}</h1>
    </section>
  );
}
