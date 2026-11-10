const notes: string[] = ["Bring water"];

export function listNativeNotes(): string[] {
  return [...notes];
}

export function addNativeNote(title: string): void {
  notes.push(title);
}
