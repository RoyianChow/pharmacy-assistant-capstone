import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = fileURLToPath(new URL(process.platform === "win32"
  ? "../services/paddleocr/.venv/Scripts/python.exe"
  : "../services/paddleocr/.venv/bin/python", import.meta.url));
if (!existsSync(python)) {
  console.error("Install the isolated OCR environment first. See services/paddleocr/README.md.");
  process.exit(1);
}
const child = spawn(python, ["services/paddleocr/app.py"], { cwd: root, stdio: "inherit", windowsHide: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Could not start the PaddleOCR service."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 0; });
