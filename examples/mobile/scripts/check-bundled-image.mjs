// CI evidence check for an image bundled with a React Native screen: /map shows blaze@2x.png and
// blaze@3x.png (src/app/(styled)/map/), a solid orange trail blaze, from the app itself in a
// farm build --mobile app. Nothing else on the screen is orange, so the screenshot shows the blaze
// exactly when React Native found the file the build put in the app.
//
//   node scripts/check-bundled-image.mjs <screenshot.png>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const file = process.argv[2];
assert(file, "Pass the screenshot to `check-bundled-image.mjs`.");

/** The pixels of an 8- or 16-bit RGB or RGBA PNG without interlacing, as RGBA bytes. */
function decodePng(data) {
  assert.equal(data.subarray(1, 4).toString("latin1"), "PNG", `${file} is not a PNG.`);
  let offset = 8;
  let header;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("latin1");
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert(header, `${file} has no IHDR.`);
  const { width, height, depth, color, interlace } = header;
  assert(
    (color === 2 || color === 6) && (depth === 8 || depth === 16) && interlace === 0,
    `${file}: unsupported PNG (color type ${color}, depth ${depth}, interlace ${interlace}).`,
  );
  const channels = color === 6 ? 4 : 3;
  const bpp = (channels * depth) / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = previous[x];
      const corner = x >= bpp ? previous[x - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      row[x] = (line[x] + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        // 16-bit samples: the high byte.
        out[(y * width + x) * 4 + c] = row[x * bpp + (c * depth) / 8];
      }
      out[(y * width + x) * 4 + 3] = channels === 4 ? row[x * bpp + (3 * depth) / 8] : 255;
    }
    previous = row;
  }
  return { width, height, pixels: out };
}

const { width, height, pixels } = decodePng(await readFile(file));
// The blaze is #E8590C: (232, 89, 12) in an sRGB screenshot (Android), about (215, 98, 43) in a
// Display P3 one (iOS). The band excludes the screen's red error text, #B3261E, which is
// (187, 62, 54) in P3, and its anti-aliased edges, which blend towards the light background.
let orange = 0;
for (let i = 0; i < pixels.length; i += 4) {
  const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
  if (r > 200 && g > 75 && g < 125 && b < 70) orange++;
}
// The blaze is 24 by 36 points: 864 pixels at the lowest scale either platform renders it at.
const minimum = 500;
console.log(`${file}: ${width}x${height}, ${orange} pixels of the trail blaze (need ${minimum}).`);
assert(
  orange >= minimum,
  `${file} does not show the bundled trail blaze: React Native did not find blaze.png in the app.`,
);
