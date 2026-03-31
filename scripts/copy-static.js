const fs = require('fs');
const path = require('path');

/**
 * Copy static files (HTML, CSS) from src/renderer to dist/renderer
 */
const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const distDir = path.join(__dirname, '..', 'dist', 'renderer');

const filesToCopy = [
  'index.html',
  'styles/terminal.css',
];

for (const file of filesToCopy) {
  const src = path.join(srcDir, file);
  const dest = path.join(distDir, file);
  const destDir = path.dirname(dest);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
  }
}

// Copy xterm.css from node_modules
const xtermCssSrc = path.join(
  __dirname, '..', 'node_modules',
  '@xterm', 'xterm', 'css', 'xterm.css'
);
const xtermCssDest = path.join(
  distDir, 'styles', 'xterm.css'
);

if (fs.existsSync(xtermCssSrc)) {
  fs.copyFileSync(xtermCssSrc, xtermCssDest);
  console.log('Copied: xterm.css');
}

console.log('Static files copied successfully.');
