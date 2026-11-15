// Each test's own list, by the `list` query parameter, so runs do not share state.
const lists = new Map<string, string[]>();

export function listKeyedItems(list: string): string[] {
  if (!lists.has(list)) lists.set(list, ["Ada", "Grace", "Linus"]);
  return [...lists.get(list)!];
}

export function removeFirstKeyedItem(list: string): void {
  lists.set(list, listKeyedItems(list).slice(1));
}
