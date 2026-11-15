import * as Dialog from "@radix-ui/react-dialog";

// Radix parts composed in a server component, as in RSC apps, including one destructured from the
// namespace.
const { Close } = Dialog;

export default function DialogPage() {
  return (
    <section>
      <h1>Radix dialog</h1>
      <Dialog.Root>
        <Dialog.Trigger>Open radix</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Radix title</Dialog.Title>
            <Dialog.Description>Rendered by a server component.</Dialog.Description>
            <Close>Close radix</Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {/* asChild: the trigger gives its props and handlers to the server-rendered button. */}
      <Dialog.Root>
        <Dialog.Trigger asChild>
          <button type="button" className="as-child-trigger">
            Open as child
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>As child title</Dialog.Title>
            <Dialog.Description>Opened from a server button.</Dialog.Description>
            <Close>Close as child</Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
