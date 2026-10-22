import { build } from "esbuild";
await build({
  entryPoints: ["src/background.js", "src/palette.js"],
  outdir: "extension",
  bundle: true,
  format: "esm",
  target: "chrome127",
  minify: false,
  legalComments: "none",
});
console.log("Built Tablight (no runtime dependencies)");
