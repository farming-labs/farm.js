"use client";
import { Command } from "cmdk";

export function CommandMenu() {
  return (
    <Command label="Commands" data-testid="command">
      <Command.Input placeholder="Search" />
      <Command.List>
        <Command.Empty>No results</Command.Empty>
        <Command.Item>Apple</Command.Item>
        <Command.Item>Banana</Command.Item>
      </Command.List>
    </Command>
  );
}
