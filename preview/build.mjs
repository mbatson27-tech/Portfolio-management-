// Builds a single-file, no-server preview of the app (demo data only) at preview/dist/index.html.
// Run: node preview/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const html = read("public/index.html");
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script src="app.js"><\/script>/, "");
const css = read("public/styles.css");
const demo = read("demo.js").replace(/^export /gm, "");
const mock = read("preview/mock-api.js");
const app = read("public/app.js");

const banner = `<div class="preview-banner">Preview with sample data. Prices, news and AI answers are made up, and trades use a pretend account.</div>`;

const out = `<title>Portfolio Pulse</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
.preview-banner { background: var(--demo-bg); color: var(--demo-fg); text-align: center; font-size: 13px; padding-block: 6px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
</style>
${banner}
${body}
<script>
(() => {
${demo}
${mock}
})();
</script>
<script>
${app}
</script>
`;

mkdirSync(new URL("preview/dist/", root), { recursive: true });
writeFileSync(new URL("preview/dist/index.html", root), out);
console.log("Wrote preview/dist/index.html", out.length, "bytes");
