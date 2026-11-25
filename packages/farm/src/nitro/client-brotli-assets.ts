import { readdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

const compress = promisify(brotliCompress);

/** The client files a page loads as text before it runs. */
const SCRIPT_OR_STYLESHEET = /\.(?:m?js|css)$/;

/** Nitro compresses no public file under 1 KB; the headers would outweigh the saving. */
const MIN_COMPRESSED_BYTES = 1024;

/**
 * Writes a brotli copy (`<file>.br`) of every client script and stylesheet, at brotli's top
 * quality, for a server that sends its static files itself. Nitro's static handler sends the copy
 * to a browser that accepts `br` and the gzip copy from `compressPublicAssets` to the rest.
 *
 * Scripts and stylesheets only: top-quality brotli on every public file, prerendered pages
 * included, cost a docs app about 20 s of build CPU. A `.br` file the app ships in `public/` is
 * kept, as Nitro keeps one.
 */
export async function writeFarmClientBrotliAssets(clientOutputDir: string): Promise<void> {
  const entries = await readdir(clientOutputDir, { recursive: true, withFileTypes: true });
  const files = new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name)),
  );
  const pending = [...files].filter(
    (file) => SCRIPT_OR_STYLESHEET.test(file) && !files.has(`${file}.br`),
  );
  const next = async (): Promise<void> => {
    const file = pending.pop();
    if (file === undefined) return;
    const source = await readFile(file);
    if (source.length >= MIN_COMPRESSED_BYTES) {
      const compressed = await compress(source, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      });
      await writeFile(`${file}.br`, compressed);
    }
    return next();
  };
  await Promise.all(Array.from({ length: availableParallelism() }, next));
}
