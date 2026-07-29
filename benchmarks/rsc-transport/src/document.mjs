const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const BLOCK = Object.freeze({
  heading: 1,
  paragraph: 2,
  code: 3,
  callout: 4,
  list: 5,
});

const MAGIC = encoder.encode("FUI1");

function uint8(value) {
  return Uint8Array.of(value);
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function stringBytes(value) {
  const bytes = encoder.encode(value);
  return [uint32(bytes.byteLength), bytes];
}

function concatenate(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function encodeDocument(document) {
  const chunks = [MAGIC, uint32(document.blocks.length)];

  for (const block of document.blocks) {
    if (block.type === "heading") {
      chunks.push(uint8(BLOCK.heading), uint8(block.level), ...stringBytes(block.text));
      continue;
    }

    if (block.type === "paragraph") {
      chunks.push(uint8(BLOCK.paragraph), ...stringBytes(block.text));
      continue;
    }

    if (block.type === "code") {
      chunks.push(uint8(BLOCK.code), ...stringBytes(block.language), ...stringBytes(block.source));
      continue;
    }

    if (block.type === "callout") {
      chunks.push(
        uint8(BLOCK.callout),
        uint8(block.tone),
        ...stringBytes(block.title),
        ...stringBytes(block.body),
      );
      continue;
    }

    if (block.type === "list") {
      chunks.push(uint8(BLOCK.list), uint32(block.items.length));
      for (const item of block.items) chunks.push(...stringBytes(item));
      continue;
    }

    throw new Error(`Unknown block type: ${block.type}`);
  }

  return concatenate(chunks);
}

class Cursor {
  constructor(input) {
    const bytes =
      input instanceof Uint8Array
        ? input
        : input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  take(length) {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error("Truncated Farm UI IR payload");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  uint8() {
    return this.take(1)[0];
  }

  uint32() {
    if (this.offset + 4 > this.bytes.byteLength) {
      throw new Error("Truncated Farm UI IR payload");
    }
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  string() {
    return decoder.decode(this.take(this.uint32()));
  }
}

export function decodeDocument(input) {
  const cursor = new Cursor(input);
  const magic = decoder.decode(cursor.take(4));
  if (magic !== "FUI1") throw new Error(`Unsupported UI IR magic: ${magic}`);

  const blocks = [];
  const blockCount = cursor.uint32();

  for (let index = 0; index < blockCount; index += 1) {
    const type = cursor.uint8();

    if (type === BLOCK.heading) {
      blocks.push({
        type: "heading",
        level: cursor.uint8(),
        text: cursor.string(),
      });
      continue;
    }

    if (type === BLOCK.paragraph) {
      blocks.push({ type: "paragraph", text: cursor.string() });
      continue;
    }

    if (type === BLOCK.code) {
      blocks.push({
        type: "code",
        language: cursor.string(),
        source: cursor.string(),
      });
      continue;
    }

    if (type === BLOCK.callout) {
      blocks.push({
        type: "callout",
        tone: cursor.uint8(),
        title: cursor.string(),
        body: cursor.string(),
      });
      continue;
    }

    if (type === BLOCK.list) {
      const itemCount = cursor.uint32();
      const items = [];
      for (let item = 0; item < itemCount; item += 1) items.push(cursor.string());
      blocks.push({ type: "list", items });
      continue;
    }

    throw new Error(`Unsupported UI IR block tag: ${type}`);
  }

  if (cursor.offset !== cursor.bytes.byteLength) {
    throw new Error("Farm UI IR payload contains trailing bytes");
  }

  return { blocks };
}

const concepts = [
  "streaming",
  "reconciliation",
  "serialization",
  "caching",
  "hydration",
  "invalidation",
  "scheduling",
  "composition",
  "observability",
  "authorization",
  "preloading",
  "compression",
];

const outcomes = [
  "predictable navigation",
  "smaller recurring payloads",
  "stable client ownership",
  "fewer rendering waterfalls",
  "cache-aware delivery",
  "bounded main-thread work",
  "safer server projections",
  "measurable transport choices",
];

function sectionCode(index, concept) {
  const name = concept.replaceAll("-", "_");
  return [
    `export async function load_${name}_${index}(request) {`,
    `  const response = await fetch("/api/resource/${index}", {`,
    `    headers: { "x-render-mode": request.mode },`,
    "  })",
    `  const payload_${index} = await response.json()`,
    `  return payload_${index}.items.map((item, position) => ({`,
    `    id: \`\${item.id}-${index}-\${position}\`,`,
    `    score: item.value * ${index + 3},`,
    "  }))",
    "}",
  ].join("\n");
}

export function generateDocument(sectionCount, variant = 0) {
  const blocks = [
    {
      type: "heading",
      level: 1,
      text: `Representation-aware rendering with ${sectionCount} sections, variant ${variant}`,
    },
    {
      type: "paragraph",
      text: "This fixture compares **rendered Flight**, `native HTML`, and a [reusable renderer](https://example.test/renderer) while escaping <unsafe> & quoted content.",
    },
  ];

  for (let index = 0; index < sectionCount; index += 1) {
    const variantIndex = index + variant * 997;
    const concept = concepts[variantIndex % concepts.length];
    const outcome = outcomes[(variantIndex * 5 + 3) % outcomes.length];
    const fingerprint = (((variantIndex + 11) * 2654435761) >>> 0).toString(36);

    blocks.push(
      {
        type: "heading",
        level: 2 + (index % 2),
        text: `${index + 1}. ${concept} profile ${fingerprint}`,
      },
      {
        type: "paragraph",
        text: `The **${concept}** path evaluates \`segment_${fingerprint}\` against ${outcome}. Its request ${index + 101} keeps the source compact while the rendered structure includes semantic nodes, highlighted tokens, and escaped values such as <${fingerprint}> & "quotes".`,
      },
      {
        type: "paragraph",
        text: `A [transport trace](https://example.test/traces/${fingerprint}) records server work, transfer bytes, reconstruction, and commit time. Reusing the renderer matters only when those recurring savings repay its initial download.`,
      },
      {
        type: "code",
        language: "typescript",
        source: sectionCode(variantIndex, concept),
      },
      {
        type: "list",
        items: [
          `Measure **${concept}** payload ${fingerprint}`,
          `Compare \`Flight_${variantIndex}\` with compact UI data`,
          `Validate [cache partition ${variantIndex % 7}](https://example.test/cache/${variantIndex % 7})`,
          `Preserve interactive state outside segment_${fingerprint}`,
        ],
      },
    );

    if (index % 3 === 0) {
      blocks.push({
        type: "callout",
        tone: index % 2,
        title: `Constraint ${fingerprint}`,
        body: `Optimization ${index + 1} is accepted only when compressed bytes and client time improve without exposing server-only input.`,
      });
    }
  }

  return { blocks };
}
