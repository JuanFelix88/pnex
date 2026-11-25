import type { Particle } from "./terminal-particles";

const FLOATS_PER_PARTICLE = 12;
const TIME_WINDOW_SECONDS = 60;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec4 a_birth;  // x, y, time, lifetime
layout(location = 1) in vec4 a_motion; // font size, radius, rise, drift
layout(location = 2) in vec4 a_look;   // phase, red, green, blue
uniform vec2 u_size;
uniform float u_time;
uniform float u_padding;
out vec2 v_offset;
flat out vec3 v_color;
flat out float v_radius;
flat out float v_halfStroke;
flat out float v_opacity;

void main() {
  float age = max(u_time - a_birth.z, 0.0);
  float progress = clamp(age / a_birth.w, 0.0, 1.0);
  vec2 center = a_birth.xy + vec2(
    a_motion.w * age + sin(a_look.x + age * 4.0) * a_motion.x * 0.13,
    -a_motion.z * age
  );
  v_radius = a_motion.y * (0.7 + progress * 0.6);
  v_halfStroke = max(0.5, a_motion.x * 0.05) * 0.5;
  v_opacity = min(1.0, progress * 8.0) * (1.0 - progress) * 0.55;
  v_color = a_look.yzw;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  v_offset = corner * (v_radius + v_halfStroke + u_padding);
  vec2 position = (center + v_offset) / u_size;
  gl_Position = vec4(position * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_offset;
flat in vec3 v_color;
flat in float v_radius;
flat in float v_halfStroke;
flat in float v_opacity;
out vec4 outColor;

void main() {
  float distanceToCenter = length(v_offset);
  float edge = max(fwidth(distanceToCenter) * 0.5, 0.001);
  float signedDistance = v_radius - distanceToCenter;
  float fill = smoothstep(-edge, edge, signedDistance) * v_opacity * 0.22;
  float outer = smoothstep(-edge, edge, signedDistance + v_halfStroke);
  float inner = v_radius > v_halfStroke ? smoothstep(-edge, edge, signedDistance - v_halfStroke) : 0.0;
  float stroke = (outer - inner) * v_opacity;
  float alpha = stroke + fill * (1.0 - stroke);
  outColor = vec4(v_color * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not allocate the particle shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Could not compile the particle shader.");
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not allocate the particle program.");
  let vertex: WebGLShader | undefined;
  let fragment: WebGLShader | undefined;
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Could not link the particle shaders.");
    }
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    return program;
  } catch (error: unknown) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

export class ParticleWebglRenderer {
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly sizeUniform: WebGLUniformLocation | null;
  private readonly timeUniform: WebGLUniformLocation | null;
  private readonly paddingUniform: WebGLUniformLocation | null;
  private readonly data: Float32Array;
  private timeOrigin?: number;

  constructor(private readonly gl: WebGL2RenderingContext, maxParticles: number) {
    this.program = createProgram(gl);
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!buffer || !vao) {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(this.program);
      throw new Error("Could not allocate the particle instance buffer.");
    }
    this.buffer = buffer;
    this.vao = vao;
    this.data = new Float32Array(maxParticles * FLOATS_PER_PARTICLE);
    this.sizeUniform = gl.getUniformLocation(this.program, "u_size");
    this.timeUniform = gl.getUniformLocation(this.program, "u_time");
    this.paddingUniform = gl.getUniformLocation(this.program, "u_padding");
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const bytes = Float32Array.BYTES_PER_ELEMENT;
    for (let attribute = 0; attribute < 3; attribute++) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, FLOATS_PER_PARTICLE * bytes, attribute * 4 * bytes);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(canvas: HTMLCanvasElement, width: number, height: number, ratio: number): void {
    this.gl.viewport(0, 0, canvas.width, canvas.height);
    this.gl.uniform2f(this.sizeUniform, width, height);
    this.gl.uniform1f(this.paddingUniform, 2 / ratio);
  }

  clear(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  render(particles: readonly Particle[], time: number, margin: number, changed: boolean): void {
    const gl = this.gl;
    // Keep GPU timestamps close to zero so long sessions retain sub-frame precision.
    if (this.timeOrigin === undefined || time < this.timeOrigin || time - this.timeOrigin >= TIME_WINDOW_SECONDS) {
      this.timeOrigin = time;
      changed = true;
    }
    if (changed) {
      let index = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        this.data[index++] = p.x + margin;
        this.data[index++] = p.y + margin;
        this.data[index++] = p.bornAt - this.timeOrigin;
        this.data[index++] = p.lifetime;
        this.data[index++] = p.fontSize;
        this.data[index++] = p.radius;
        this.data[index++] = p.rise;
        this.data[index++] = p.drift;
        this.data[index++] = p.phase;
        this.data[index++] = (p.rgb >>> 16) / 255;
        this.data[index++] = (p.rgb >>> 8 & 255) / 255;
        this.data[index++] = (p.rgb & 255) / 255;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, index);
    }
    gl.uniform1f(this.timeUniform, time - this.timeOrigin);
    this.clear();
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, particles.length);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
