import type { ReactNode } from "react";

export default function SlotsLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel?: ReactNode;
}) {
  return (
    <section data-testid="slots-layout">
      {children}
      <aside data-testid="slot-host">{panel}</aside>
    </section>
  );
}
