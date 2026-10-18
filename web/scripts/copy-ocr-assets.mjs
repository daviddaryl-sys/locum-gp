import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(webRoot, "public", "ocr");
const tesseractRoot = path.join(webRoot, "node_modules", "tesseract.js");
const coreRoot = path.join(webRoot, "node_modules", "tesseract.js-core");
const languageRoot = path.join(
  webRoot,
  "node_modules",
  "@tesseract.js-data",
  "eng",
  "4.0.0_best_int",
);

const dependencyFallbackReplacements = [
  {
    relativePath: path.join("src", "worker", "browser", "defaultOptions.js"),
    upstream:
      "`https://cdn.jsdelivr.net/npm/tesseract.js@v${version}/dist/worker.min.js`",
    local: '"/ocr/unconfigured-worker.js"',
  },
  {
    relativePath: path.join(
      "src",
      "worker-script",
      "browser",
      "getCore.js",
    ),
    upstream:
      "`https://cdn.jsdelivr.net/npm/tesseract.js-core@v${coreVersion.substring(1)}`",
    local: '"/ocr/unconfigured-core"',
  },
  {
    relativePath: path.join("src", "worker-script", "index.js"),
    upstream:
      "`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`",
    local: '"/ocr/unconfigured-language-fallback/4.0.0_best_int"',
  },
  {
    relativePath: path.join("src", "worker-script", "index.js"),
    upstream:
      "`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0`",
    local: '"/ocr/unconfigured-language-fallback/4.0.0"',
  },
];

for (const { relativePath, upstream, local } of dependencyFallbackReplacements) {
  const sourcePath = path.join(tesseractRoot, relativePath);
  let source = await readFile(sourcePath, "utf8");
  const upstreamOccurrences = source.split(upstream).length - 1;
  const localOccurrences = source.split(local).length - 1;
  if (upstreamOccurrences + localOccurrences !== 1) {
    throw new Error(
      `Expected exactly one configured OCR fallback token in ${relativePath}; found ${upstreamOccurrences} upstream and ${localOccurrences} local.`,
    );
  }
  if (upstreamOccurrences === 1) {
    source = source.replace(upstream, local);
    await writeFile(sourcePath, source, "utf8");
  }
}
for (const relativePath of new Set(
  dependencyFallbackReplacements.map(({ relativePath }) => relativePath),
)) {
  const source = await readFile(path.join(tesseractRoot, relativePath), "utf8");
  if (/cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com|https?:\/\//i.test(source)) {
    throw new Error(
      `Prepared OCR dependency still contains a remote endpoint: ${relativePath}`,
    );
  }
}

await mkdir(outputDirectory, { recursive: true });

const generatedFiles = (await readdir(outputDirectory)).filter(
  (name) => name !== "README.md",
);
await Promise.all(
  generatedFiles.map((name) =>
    rm(path.join(outputDirectory, name), { force: true, recursive: true }),
  ),
);

await copyFile(
  path.join(tesseractRoot, "dist", "worker.min.js"),
  path.join(outputDirectory, "worker.min.js"),
);
const workerPath = path.join(outputDirectory, "worker.min.js");
const fallbackReplacements = [
  {
    upstream: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/",
    local: "/ocr/unconfigured-language-fallback/",
  },
  {
    upstream: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v",
    local: "/ocr/unconfigured-core-fallback-v",
  },
];
let workerSource = await readFile(workerPath, "utf8");
for (const { upstream, local } of fallbackReplacements) {
  const occurrences = workerSource.split(upstream).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one upstream OCR fallback token, found ${occurrences}: ${upstream}`,
    );
  }
  workerSource = workerSource.replace(upstream, local);
}
if (/cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com|https?:\/\//i.test(workerSource)) {
  throw new Error("Generated OCR worker still contains a remote endpoint.");
}
await writeFile(workerPath, workerSource, "utf8");
await copyFile(
  path.join(languageRoot, "eng.traineddata.gz"),
  path.join(outputDirectory, "eng.traineddata.gz"),
);

const requiredCoreFiles = [
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
];
const installedCoreFiles = new Set(await readdir(coreRoot));
const missingCoreFiles = requiredCoreFiles.filter(
  (name) => !installedCoreFiles.has(name),
);
if (missingCoreFiles.length > 0) {
  throw new Error(
    `Installed Tesseract package is missing required LSTM core assets: ${missingCoreFiles.join(", ")}`,
  );
}
await Promise.all(
  requiredCoreFiles.map((name) =>
    copyFile(path.join(coreRoot, name), path.join(outputDirectory, name)),
  ),
);
await Promise.all(
  ["worker.min.js", "eng.traineddata.gz", ...requiredCoreFiles].map((name) =>
    chmod(path.join(outputDirectory, name), 0o644),
  ),
);

console.log(
  `Prepared ${requiredCoreFiles.length + 2} local OCR assets in public/ocr.`,
);
