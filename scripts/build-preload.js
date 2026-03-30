const esbuild = require("esbuild");
const path = require("path");

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "preload", "preload.ts")],
  bundle: true,
  outfile: path.join(__dirname, "..", "dist", "preload", "preload.js"),
  platform: "node",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  loader: { ".ts": "ts" },
});

console.log("Preload bundle built successfully.");
