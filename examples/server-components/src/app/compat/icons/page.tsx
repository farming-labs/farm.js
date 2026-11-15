import { Camera } from "lucide-react";
import { IconToggle } from "../../../components/compat/icons";

// lucide-react's entry re-exports every icon; a server component renders one as plain SVG.
export default function IconsPage() {
  return (
    <section>
      <Camera data-testid="icon-server" aria-label="camera" />
      <IconToggle />
    </section>
  );
}
