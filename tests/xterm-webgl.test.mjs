import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const library = dirname(createRequire(import.meta.url).resolve("@xterm/addon-webgl"));

// Exercise the same private GlyphRenderer Vite bundles, plus the CommonJS entry.
function loadGlyphRenderer(file) {
  const source = readFileSync(join(library, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  let glyph;
  function visit(node) {
    if (ts.isClassLike(node) && node.members.some((member) => member.name?.getText(ast) === "_bindAtlasPageTexture")) {
      assert.equal(glyph, undefined);
      glyph = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(glyph);
  const tail = ast.statements.find(ts.isExportDeclaration)?.getStart(ast) ?? source.length;
  const scope = { process, queueMicrotask, setTimeout, clearTimeout };
  const instrumented = source.slice(0, glyph.end - 1)
    + "static{globalThis.GlyphRenderer=this;}" + source.slice(glyph.end - 1, tail);
  runInNewContext(instrumented, scope, { displayErrors: false });
  return scope.GlyphRenderer;
}

for (const file of ["addon-webgl.mjs", "addon-webgl.js"]) {
  test(`${file} reuses the packed glyph upload but still draws and refreshes atlas textures`, () => {
    const uploads = [];
    const draws = [];
    const textureUploads = [];
    const terminal = { cols: 4, rows: 2 };
    const atlas = {
      pages: [{ version: 1 }],
      getRasterizedGlyph: (code) => ({
        texturePage: 0,
        offset: { x: 0, y: 0 }, size: { x: code, y: 12 },
        texturePositionClipSpace: { x: 0, y: 0 }, sizeClipSpace: { x: 0.25, y: 0.25 },
      }),
    };
    const glyphs = Object.assign(Object.create(loadGlyphRenderer(file).prototype), {
      _terminal: terminal,
      _activeBuffer: 0,
      _vertices: { count: 0, attributesBuffers: [null, null] },
      _atlasTextures: [{ version: -1 }],
      _dimensions: { device: { cell: { width: 20 }, char: { width: 20, left: 0, top: 0 }, canvas: { width: 80, height: 24 } } },
      _optionsService: { rawOptions: { rescaleOverlappingGlyphs: false } },
      _gl: {
        canvas: { width: 80, height: 24 },
        useProgram() {}, bindVertexArray() {}, bindBuffer() {}, viewport() {}, uniform2f() {},
        bufferData(_target, data) { uploads.push([...data]); },
        drawElementsInstanced(_mode, _vertices, _type, _offset, count) { draws.push(count); },
      },
      _bindAtlasPageTexture(_gl, source, page) {
        textureUploads.push(source.pages[page].version);
        this._atlasTextures[page].version = source.pages[page].version;
      },
    });
    const model = { lineLengths: [2, 1] };
    const write = (x, y, code) => glyphs.updateCell(x, y, code, 0, 0, 0, "", 1, 0);
    glyphs.clear();
    glyphs.setAtlas(atlas);
    write(0, 0, 20);
    write(1, 0, 30);
    write(0, 1, 40);
    glyphs.render(model);
    atlas.pages[0].version++;
    glyphs.render(model);
    assert.deepEqual(draws, [3, 3]);
    assert.deepEqual(uploads.map((data) => data.length), [33]);
    assert.deepEqual(textureUploads, [1, 2]);

    write(0, 0, 40); // Replacing a glyph without growing the line invalidates the cached data.
    glyphs.render(model);
    assert.equal(uploads.length, 2);
    assert.equal(uploads[0][2], 0.25);
    assert.equal(uploads[1][2], 0.5);

    write(1, 0, 0); // Erase a cell; the next line moves earlier in the compact buffer.
    model.lineLengths[0] = 1;
    glyphs.render(model);
    assert.equal(draws.at(-1), 2);
    assert.equal(uploads.at(-1).length, 22);
    assert.equal(uploads.at(-1)[21], 0.5);

    glyphs.setAtlas(atlas);
    glyphs.render(model);
    assert.equal(uploads.length, 4);
    assert.deepEqual(textureUploads, [1, 2, 2]);

    terminal.cols = 3;
    glyphs.handleResize();
    model.lineLengths = [0, 0];
    glyphs.render(model);
    glyphs.render(model);
    assert.deepEqual(uploads.map((data) => data.length), [33, 33, 22, 22, 0]);
    assert.deepEqual(draws, [3, 3, 3, 2, 2, 0, 0]);
  });
}
