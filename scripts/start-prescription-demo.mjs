import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

if (process.env.VERCEL || process.env.NODE_ENV === "production") {
  console.error("This command is only for an isolated local fictional-data demo.");
  process.exit(1);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "development",
  // Use the existing local demo mode, with no remote database or staff identities.
  // Empty process variables prevent Next's dotenv loader from loading saved secrets.
  DATABASE_URL: "", NEON_DB: "", POSTGRES_URL: "",
  NEON_AUTH_BASE_URL: "", NEON_AUTH_COOKIE_SECRET: "",
  PHARMACY_STAFF_EMAILS: "", PHARMACY_STAFF_USER_IDS: "",
  PHARMACY_DATABASE_PATH: "./data/prescription-demo.sqlite",
  PADDLEOCR_SERVICE_URL: "http://127.0.0.1:8001",
  PADDLEOCR_SERVICE_TOKEN: process.env.PADDLEOCR_SERVICE_TOKEN ?? "",
};
// Next normalizes its development request origin to localhost; use that same
// browser hostname so the existing same-origin protection stays intact.
console.log("Local fictional-data demo: http://localhost:3001/prescriptions");
console.log("Uses the existing local demo access mode; remote database/auth settings and .env.local remain unchanged.");
console.log("Start PaddleOCR in another terminal with: npm run ocr:serve");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3001"], {
  cwd: root, env, stdio: "inherit", windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Could not start the local prescription demo."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 0; });
