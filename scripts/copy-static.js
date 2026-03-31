const fs = require("fs");
const path = require("path");

/**
 * Copy static files (HTML, CSS) from src/renderer to dist/renderer
 */
const srcDir = path.join(__dirname, "..", "src", "renderer");
const distDir = path.join(__dirname, "..", "dist", "renderer");

const filesToCopy = [
  {
    src: path.join(srcDir, "index.html"),
    dest: path.join(distDir, "index.html"),
    label: "index.html",
  },
  {
    src: path.join(srcDir, "styles", "terminal.css"),
    dest: path.join(distDir, "styles", "terminal.css"),
    label: "styles/terminal.css",
  },
  {
    src: path.join(__dirname, "..", "assets", "icon.png"),
    dest: path.join(distDir, "assets", "icon.png"),
    label: "assets/icon.png",
  },
  {
    src: path.join(__dirname, "..", "assets", "p.svg"),
    dest: path.join(distDir, "assets", "p.svg"),
    label: "assets/p.svg",
  },
];

for (const file of filesToCopy) {
  const { src, dest, label } = file;
  const destDir = path.dirname(dest);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${label}`);
  }
}

// Copy xterm.css from node_modules
const xtermCssSrc = path.join(
  __dirname,
  "..",
  "node_modules",
  "@xterm",
  "xterm",
  "css",
  "xterm.css",
);
const xtermCssDest = path.join(distDir, "styles", "xterm.css");

if (fs.existsSync(xtermCssSrc)) {
  fs.copyFileSync(xtermCssSrc, xtermCssDest);
  console.log("Copied: xterm.css");
}

console.log("Static files copied successfully.");
