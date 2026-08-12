import { invoke } from "@tauri-apps/api/core";

const RING_MAGIC = 0x584e4550;
const RING_VERSION = 1;
const HEADER_SIZE = 64;
const MAGIC_INDEX = 0;
const VERSION_INDEX = 1;
const CAPACITY_INDEX = 2;
const WRITE_POSITION_INDEX = 4;
const READ_POSITION_INDEX = 5;
const PREPARE_TIMEOUT_MS = 2_000;

interface SharedBufferReceivedEvent extends Event {
  readonly additionalData?: unknown;
  getBuffer(): ArrayBuffer;
}

interface WebViewHost {
  addEventListener(
    type: "sharedbufferreceived",
    listener: (event: SharedBufferReceivedEvent) => void,
  ): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(
    type: "sharedbufferreceived",
    listener: (event: SharedBufferReceivedEvent) => void,
  ): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  releaseBuffer(buffer: ArrayBuffer): void;
}

declare global {
  interface Window {
    chrome?: {
      webview?: WebViewHost;
    };
  }
}

interface SharedBufferMetadata {
  kind: "pnex-terminal-output";
  token: string;
}

interface OutputReadyMessage {
  kind: "pnex-terminal-output-ready";
  token: string;
}

type TerminalWrite = (data: Uint8Array, onProcessed: () => void) => void;

export class SharedTerminalOutput {
  readonly token: string;
  private readonly host: WebViewHost;
  private readonly buffer: ArrayBuffer;
  private readonly header: Int32Array;
  private readonly data: Uint8Array;
  private readonly writeTerminal: TerminalWrite;
  private readonly onError: (message: string) => void;
  private inFlight = false;
  private finishing = false;
  private disposed = false;

  constructor(
    host: WebViewHost,
    buffer: ArrayBuffer,
    token: string,
    writeTerminal: TerminalWrite,
    onError: (message: string) => void,
  ) {
    const header = new Int32Array(buffer, 0, HEADER_SIZE / Int32Array.BYTES_PER_ELEMENT);
    const magic = Atomics.load(header, MAGIC_INDEX) >>> 0;
    const version = Atomics.load(header, VERSION_INDEX) >>> 0;
    const capacity = Atomics.load(header, CAPACITY_INDEX) >>> 0;
    if (
      magic !== RING_MAGIC
      || version !== RING_VERSION
      || capacity === 0
      || (capacity & (capacity - 1)) !== 0
      || buffer.byteLength < HEADER_SIZE + capacity
    ) {
      throw new Error("Shared terminal output buffer has an invalid layout.");
    }

    this.host = host;
    this.buffer = buffer;
    this.token = token;
    this.header = header;
    this.data = new Uint8Array(buffer, HEADER_SIZE, capacity);
    this.writeTerminal = writeTerminal;
    this.onError = onError;
    this.host.addEventListener("message", this.handleMessage);
  }

  closeAfterDrain(): void {
    if (this.disposed) return;
    this.finishing = true;
    this.drain();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host.removeEventListener("message", this.handleMessage);
    releaseSharedBuffer(this.host, this.buffer);
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (!isOutputReadyMessage(event.data) || event.data.token !== this.token) return;
    this.drain();
  };

  private drain(): void {
    if (this.disposed || this.inFlight) return;

    const writePosition = Atomics.load(this.header, WRITE_POSITION_INDEX) >>> 0;
    const readPosition = Atomics.load(this.header, READ_POSITION_INDEX) >>> 0;
    const available = (writePosition - readPosition) >>> 0;
    if (available > this.data.byteLength) {
      this.fail("Shared terminal output positions are invalid.");
      return;
    }
    if (available === 0) {
      if (this.finishing) this.dispose();
      return;
    }

    const offset = readPosition & (this.data.byteLength - 1);
    const length = Math.min(available, this.data.byteLength - offset);
    const bytes = this.data.subarray(offset, offset + length);
    this.inFlight = true;
    this.writeTerminal(bytes, () => {
      if (this.disposed) return;
      Atomics.store(this.header, READ_POSITION_INDEX, (readPosition + length) | 0);
      this.inFlight = false;
      this.drain();
    });
  }

  private fail(message: string): void {
    this.onError(message);
    this.dispose();
  }
}

export async function prepareSharedTerminalOutput(
  writeTerminal: TerminalWrite,
  onError: (message: string) => void,
): Promise<SharedTerminalOutput | null> {
  const host = window.chrome?.webview;
  if (!host) return null;

  const token = crypto.randomUUID();
  let resolveBuffer: ((buffer: ArrayBuffer) => void) | undefined;
  const bufferPromise = new Promise<ArrayBuffer>((resolve) => {
    resolveBuffer = resolve;
  });
  const handleSharedBuffer = (event: SharedBufferReceivedEvent): void => {
    if (!isSharedBufferMetadata(event.additionalData) || event.additionalData.token !== token) return;
    resolveBuffer?.(event.getBuffer());
  };
  host.addEventListener("sharedbufferreceived", handleSharedBuffer);

  let prepared = false;
  let receivedBuffer: ArrayBuffer | null = null;
  let timeout: number | null = null;
  try {
    prepared = await invoke<boolean>("prepare_terminal_output", { token });
    if (!prepared) return null;

    receivedBuffer = await Promise.race([
      bufferPromise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("Timed out while receiving shared terminal output.")),
          PREPARE_TIMEOUT_MS,
        );
      }),
    ]);
    return new SharedTerminalOutput(host, receivedBuffer, token, writeTerminal, onError);
  } catch (error: unknown) {
    if (receivedBuffer) {
      releaseSharedBuffer(host, receivedBuffer);
    }
    if (prepared) {
      void invoke("discard_terminal_output", { token }).catch(() => undefined);
    }
    console.warn("Shared terminal output unavailable; using Tauri channel.", error);
    return null;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
    host.removeEventListener("sharedbufferreceived", handleSharedBuffer);
  }
}

function releaseSharedBuffer(host: WebViewHost, buffer: ArrayBuffer): void {
  try {
    host.releaseBuffer(buffer);
  } catch (error: unknown) {
    console.warn("Could not release shared terminal output buffer.", error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSharedBufferMetadata(value: unknown): value is SharedBufferMetadata {
  return isRecord(value)
    && value.kind === "pnex-terminal-output"
    && typeof value.token === "string";
}

function isOutputReadyMessage(value: unknown): value is OutputReadyMessage {
  return isRecord(value)
    && value.kind === "pnex-terminal-output-ready"
    && typeof value.token === "string";
}
