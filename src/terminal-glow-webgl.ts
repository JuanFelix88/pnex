// The mask is rasterized at 1/2 CSS resolution; the blur runs at 1/4.
const MARGIN = 48;
const MASK_PADDING = MARGIN / 2;
const BLUR_PADDING = MARGIN / 4;

const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

function fragmentSource(): string {
  // Pair adjacent Gaussian weights into bilinear taps. Sigma matches CSS blur(15px).
  const weights = Array.from({ length: 13 }, (_, x) => Math.exp(-0.5 * (x / 3.75) ** 2));
  const sum = 2 * weights.reduce((total, weight) => total + weight, 0) - weights[0];
  const taps: string[] = [];
  for (let x = 1; x < weights.length; x += 2) {
    const pair = weights[x] + weights[x + 1];
    const offset = (x + weights[x + 1] / pair).toFixed(8);
    taps.push(`color += (texture(u_source, p + u_step * ${offset})
      + texture(u_source, p - u_step * ${offset})) * ${(pair / sum).toFixed(8)};`);
  }
  return `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_step;
uniform bool u_flip;
in vec2 uv;
out vec4 color;
void main() {
  vec2 p = vec2(uv.x, u_flip ? 1.0 - uv.y : uv.y);
  color = texture(u_source, p) * ${(weights[0] / sum).toFixed(8)};
  ${taps.join("\n  ")}
}`;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not allocate the terminal glow program.");
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragmentSource()]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not allocate a terminal glow shader.");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || shaders.map((shader) => gl.getShaderInfoLog(shader)).join("\n"));
    }
    for (const shader of shaders) gl.detachShader(program, shader);
    return program;
  } catch (error: unknown) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

export class TerminalGlowWebgl {
  private readonly program: WebGLProgram;
  private readonly source: WebGLTexture;
  private readonly horizontal: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private readonly step: WebGLUniformLocation | null;
  private readonly flip: WebGLUniformLocation | null;
  private readonly maxSize: number;
  private fullUpload = true;

  constructor(readonly canvas: HTMLCanvasElement, private readonly gl: WebGL2RenderingContext) {
    this.program = link(gl);
    const source = gl.createTexture();
    const horizontal = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!source || !horizontal || !framebuffer) {
      gl.deleteProgram(this.program);
      gl.deleteTexture(source);
      gl.deleteTexture(horizontal);
      gl.deleteFramebuffer(framebuffer);
      throw new Error("Could not allocate terminal glow textures.");
    }
    this.source = source;
    this.horizontal = horizontal;
    this.framebuffer = framebuffer;
    this.step = gl.getUniformLocation(this.program, "u_step");
    this.flip = gl.getUniformLocation(this.program, "u_flip");
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.useProgram(this.program);
    for (const texture of [source, horizontal]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  resize(mask: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
    const gl = this.gl;
    const width = mask.width + MASK_PADDING * 2;
    const height = mask.height + MASK_PADDING * 2;
    if (Math.max(width, height) > this.maxSize) throw new Error("Terminal glow exceeds the WebGL texture limit.");
    this.canvas.width = Math.ceil(mask.width / 2) + BLUR_PADDING * 2;
    this.canvas.height = Math.ceil(mask.height / 2) + BLUR_PADDING * 2;
    this.canvas.style.width = `${cssWidth + MARGIN * 2}px`;
    this.canvas.style.height = `${cssHeight + MARGIN * 2}px`;
    this.canvas.style.left = `${-MARGIN}px`;
    this.canvas.style.top = `${-MARGIN}px`;
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, this.horizontal);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.horizontal, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE || gl.getError() !== gl.NO_ERROR) {
      throw new Error("Could not initialize the terminal glow framebuffer.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.fullUpload = true;
  }

  render(mask: HTMLCanvasElement, top: number, bottom: number): void {
    const gl = this.gl;
    if (this.fullUpload) {
      top = 0;
      bottom = mask.height;
      this.fullUpload = false;
    }
    if (bottom <= top) return;
    gl.bindTexture(gl.TEXTURE_2D, this.source);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, top);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, MASK_PADDING, MASK_PADDING + top, mask.width, bottom - top, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    // Downsampling can sample one source row on either side of the dirty band.
    const scale = this.canvas.height / (mask.height + MASK_PADDING * 2);
    const first = Math.max(0, Math.floor((MASK_PADDING + top - 1) * scale));
    const end = Math.min(this.canvas.height, Math.ceil((MASK_PADDING + bottom + 1) * scale));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, first, this.canvas.width, end - first);
    gl.uniform2f(this.step, 1 / this.canvas.width, 0);
    gl.uniform1i(this.flip, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindTexture(gl.TEXTURE_2D, this.horizontal);
    gl.uniform2f(this.step, 0, 1 / this.canvas.height);
    gl.uniform1i(this.flip, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.source);
    gl.deleteTexture(this.horizontal);
    gl.deleteProgram(this.program);
    if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
