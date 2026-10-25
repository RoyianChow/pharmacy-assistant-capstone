import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/site-brand.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const brandModule = { exports: {} };
new Function("require", "module", "exports", code)(require, brandModule, brandModule.exports);

test("shared site brand renders the Rx mark, wordmark and accessible home link", () => {
  const html = renderToStaticMarkup(brandModule.exports.default());
  assert.match(html, /href="\/"/);
  assert.match(html, /class="site-brand"/);
  assert.match(html, /aria-label="Pharmacy Assistant home"/);
  assert.match(html, /<span class="site-brand-mark" aria-hidden="true">Rx<\/span>/);
  assert.match(html, /<span>Pharmacy Assistant<\/span>/);
});

test("shared brand styles load from the root layout on every route", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/components/site-brand.css", import.meta.url), "utf8");
  assert.match(layout, /import ["']\.\/components\/site-brand\.css["']/);
  assert.match(css, /\.site-brand\s*\{/);
  assert.match(css, /\.site-brand-mark\s*\{/);
});

test("home, assessment, sign-in and pharmacy headers use the same brand component", () => {
  for (const file of ["page.tsx", "assessment/assessment-client.tsx", "auth/sign-in/page.tsx", "pharmacy/pharmacy-client.tsx"]) {
    const page = readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");
    assert.match(page, /import SiteBrand from ["'][^"']*components\/site-brand["']/);
    assert.match(page, /<SiteBrand\s*\/>/);
    assert.doesNotMatch(page, /className="(?:brand|assessment-brand|staff-auth-brand|ph-brand)(?:-mark)?"/);
  }
});
