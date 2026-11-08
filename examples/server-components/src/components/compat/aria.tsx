"use client";
import { Button, Dialog, DialogTrigger, Heading, Modal } from "react-aria-components";

// React Aria's entry imports `client-only`, so it runs in a client component.
export function AriaDialog({ title }: { title: string }) {
  return (
    <DialogTrigger>
      <Button data-testid="aria-open">Open</Button>
      <Modal>
        <Dialog data-testid="aria-dialog">
          <Heading slot="title">{title}</Heading>
          <Button slot="close">Close</Button>
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
}
