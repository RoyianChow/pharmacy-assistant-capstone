import { copyFile, mkdir, readFile } from "node:fs/promises";

// Serve the WASM binary from the same deployment as its npm-pinned JavaScript loader.
const project = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("node_modules/onnxruntime-web/package.json", project), "utf8"));
const output = new URL(`public/demo/classifier/ort/${pkg.version}/`, project);
const binary = "ort-wasm-simd-threaded.wasm";
await mkdir(output, { recursive: true });
await copyFile(new URL(`node_modules/onnxruntime-web/dist/${binary}`, project), new URL(binary, output));
