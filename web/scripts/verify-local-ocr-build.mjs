import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(webRoot, ".next");
const prohibitedRemoteOcrHost =
  /cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com|googleapis[^\s"']*vision|azure[^\s"']*vision|textract/i;
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".txt",
]);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (textExtensions.has(path.extname(entry.name))) {
      yield entryPath;
    }
  }
}

const offendingFiles = [];
for await (const filePath of walk(buildDirectory)) {
  const source = await readFile(filePath, "utf8");
  if (prohibitedRemoteOcrHost.test(source)) {
    offendingFiles.push(path.relative(webRoot, filePath));
  }
}

if (offendingFiles.length > 0) {
  throw new Error(
    `Production build contains remote OCR fallback endpoints: ${offendingFiles.join(", ")}`,
  );
}

console.log("Verified production build contains no remote OCR fallback endpoints.");
