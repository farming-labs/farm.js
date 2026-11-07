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
    </section>
  );
}
