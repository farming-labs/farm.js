import type { ReactNode } from "react";

export default function SlotLabLayout({
  children,
  activity,
  modal,
}: {
  children: ReactNode;
  activity?: ReactNode;
  modal?: ReactNode;
}) {
  return (
    <main className="mx-auto grid max-w-4xl gap-6 p-8">
      <header>
        <h1>Route slot lab</h1>
      </header>
      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <section>{children}</section>
        <aside>{activity}</aside>
      </div>
      {modal}
    </main>
  );
}
