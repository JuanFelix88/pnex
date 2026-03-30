const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
  entryPoints: [
    path.join(__dirname, '..', 'src', 'renderer', 'app.ts'),
  ],
  bundle: true,
  outfile: path.join(
    __dirname,
    '..',
    'dist',
    'renderer',
    'app.js'
  ),
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  loader: { '.ts': 'ts' },
  external: [],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

console.log('Renderer bundle built successfully.');
