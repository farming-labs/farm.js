export type Row = { id: number; label: string };

const ADJECTIVES = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
];

const NOUNS = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
];

let nextId = 1;

export function buildRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = nextId++;
    rows.push({
      id,
      label: `${ADJECTIVES[id % ADJECTIVES.length]} ${NOUNS[id % NOUNS.length]} ${id}`,
    });
  }
  return rows;
}
