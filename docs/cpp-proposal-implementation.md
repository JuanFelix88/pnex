# C++ Desktop Runtime Proposal

## Status

Exploratory implementation proposal. This document does not approve a migration by itself.

## Objective

Evaluate replacing pnex's Tauri/Rust desktop runtime with a C++ runtime while preserving the existing Vite/TypeScript/xterm.js frontend.

The main motivations are:

- reduce initial and incremental native compilation time;
- reduce build-cache and toolchain disk usage;
- use the mature C/C++ desktop ecosystem;
- retain native WebViews instead of bundling a full browser;
- keep explicit control over native dependencies and platform code.

This proposal targets desktop systems only: Windows, macOS, and Linux. Mobile support is not included.

## Current System

The frontend in `src/` uses Vite, TypeScript, and xterm.js. It communicates directly with Tauri through commands, events, channels, and window APIs.

The Rust runtime in `src-tauri/` currently owns:

- application and WebView window lifecycle;
- multiple windows and inherited working directories;
- PTY creation, input, output, resizing, and shutdown;
- JSON configuration persistence;
- native notifications and click activation;
- opening the configuration file;
- Git branch and local user lookup;
- window activation and developer tools;
- application packaging and metadata.

The PTY is the most important migration area. It streams binary output to xterm.js and tracks each terminal session independently by window.

## Platform WebView Reality

There is no single native WebView API shared by all desktop operating systems.

| Platform | Native WebView | Native PTY |
| --- | --- | --- |
| Windows | WebView2 | ConPTY |
| macOS | WKWebView | `forkpty`/`openpty` |
| Linux | WebKitGTK | `forkpty`/`openpty` |

Tauri currently abstracts these differences. A C++ replacement must either use an existing abstraction or maintain one platform adapter per operating system.

## Options

### Option A: Keep a Minimal Tauri Shell and Move the Core to C++

Keep windowing, WebView integration, IPC, and packaging in Tauri. Move PTY, configuration, notifications, and other native logic into a C++ library called through a stable C ABI.

**Advantages**

- lowest migration risk;
- preserves Tauri plugins and packaging;
- allows the C++ core to be tested independently;
- avoids rebuilding Rust when only C++ core code changes, depending on build integration.

**Disadvantages**

- Rust and Cargo remain required;
- Tauri's build cache and initial compilation are not eliminated;
- FFI adds ownership and error-handling boundaries.

**Best use:** an incremental experiment or a compromise when eliminating Rust is not mandatory.

### Option B: Small C++ Runtime with `webview/webview`

Use the lightweight `webview/webview` library as the initial cross-platform WebView abstraction. Keep the frontend unchanged except for replacing Tauri-specific APIs with a pnex-owned bridge.

**Advantages**

- small runtime and dependency surface;
- native WebViews on supported platforms;
- much less framework code than Qt or CEF;
- direct control over CMake and native compilation.

**Disadvantages**

- provides fewer desktop services than Tauri;
- pnex must implement window management, IPC conventions, security checks, packaging, notifications, and updates;
- advanced behavior may still require platform-specific code.

**Best use:** the recommended proof of concept for a small, desktop-only native shell.

### Option C: Fully Native C++ Platform Adapters

Implement WebView2, WKWebView, and WebKitGTK adapters directly behind a common pnex interface.

**Advantages**

- maximum control over performance, binary composition, and platform behavior;
- no dependency on a desktop runtime framework;
- platform features can be integrated without waiting for an abstraction library.

**Disadvantages**

- highest engineering and maintenance cost;
- three windowing, event-loop, WebView, and IPC implementations;
- macOS requires Objective-C++ (`.mm`) at the AppKit/WKWebView boundary;
- Linux behavior varies with WebKitGTK and distribution packaging.

**Best use:** only after the lightweight proof of concept demonstrates a concrete limitation.

### Option D: Neutralinojs

Use Neutralinojs as the desktop runtime and add native extensions where required.

**Advantages**

- compact C++-based runtime;
- native WebViews;
- existing cross-platform window and JavaScript APIs;
- faster path than building a complete runtime.

**Disadvantages**

- introduces another framework and its extension protocol;
- PTY streaming and pnex-specific behavior still need native implementation;
- less direct control than a pnex-owned C++ shell.

**Best use:** when eliminating Rust matters more than owning the native runtime.

### Option E: Qt WebEngine

Build the desktop shell with Qt and Qt WebEngine.

**Advantages**

- mature cross-platform application framework;
- extensive APIs, documentation, tooling, and commercial support;
- strong windowing and native UI capabilities.

**Disadvantages**

- substantially larger runtime and deployment;
- Qt WebEngine bundles Chromium rather than relying only on native WebViews;
- licensing and deployment requirements must be reviewed;
- may replace Rust build cost with a larger C++ framework build and package.

**Best use:** applications needing a broad native widget framework beyond pnex's current scope.

### Option F: Chromium Embedded Framework (CEF)

Embed Chromium through CEF and implement the native shell in C++.

**Advantages**

- consistent browser engine and behavior across platforms;
- mature C++ integration and strong browser capabilities;
- avoids differences between WebView2, WKWebView, and WebKitGTK.

**Disadvantages**

- large binaries, downloads, and build artifacts;
- higher memory and packaging cost;
- works against the objective of a small native-WebView application.

**Best use:** only if consistent Chromium behavior is a hard requirement.

## Comparison

| Option | Removes Rust | Runtime size | Migration risk | Native control | Framework coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Minimal Tauri + C++ core | No | Small | Low | Medium | High |
| `webview/webview` + C++ | Yes | Small | Medium | High | Low |
| Direct platform adapters | Yes | Small | High | Very high | pnex-owned |
| Neutralinojs | Yes | Small | Medium | Medium | Medium |
| Qt WebEngine | Yes | Large | Medium | High | Very high |
| CEF | Yes | Very large | Medium | High | Browser-focused |

C++ does not guarantee fast or small builds. Template-heavy libraries, debug symbols, Qt, Boost, and CEF can also produce slow compilation and large build directories. The benefit comes from selecting a narrow dependency set and keeping platform boundaries explicit.

## Recommendation

Build a time-boxed proof of concept using **C++20, CMake, and `webview/webview`**. Do not remove `src-tauri/` until the proof of concept reaches feature parity and its measurements justify migration.

Use direct native APIs only for capabilities that the WebView abstraction does not provide. Keep those APIs behind platform adapters so the core remains portable.

Neutralinojs should be the fallback if implementing and maintaining the JavaScript bridge, window lifecycle, and packaging becomes more expensive than expected.

## Proposed Architecture

```text
src/                         Existing TypeScript/xterm.js frontend
  platform/
    backend.ts               pnex-owned API used by the frontend
    cpp-backend.ts           C++ bridge implementation
    tauri-backend.ts         temporary compatibility implementation

native/
  CMakeLists.txt
  cmake/
  include/pnex/
    application.hpp
    bridge.hpp
    config.hpp
    notification.hpp
    pty.hpp
    window.hpp
  src/
    application.cpp
    bridge.cpp
    config.cpp
    git_context.cpp
    main.cpp
    platform/
      windows/
      macos/
      linux/
  tests/
```

The frontend must depend on a pnex-owned backend interface instead of importing `@tauri-apps/api` throughout application code. During migration, the same frontend can run on either Tauri or C++.

### State Ownership

The native process remains authoritative for:

- active windows;
- active PTY sessions;
- session identifiers;
- persisted configuration;
- notification activation callbacks.

The frontend remains authoritative for terminal rendering, prompt HUD state, themes, and transient UI state.

Each window owns at most one active terminal session. Closing a window must stop its PTY, close its streams, unregister callbacks, and remove pending inherited-directory state.

## JavaScript Bridge

Use a small request/response and event protocol rather than exposing arbitrary native objects.

Example messages:

```json
{ "id": 7, "method": "terminal.resize", "params": { "cols": 120, "rows": 32 } }
{ "id": 7, "ok": true, "result": null }
{ "event": "terminal.exit", "payload": { "sessionId": 3 } }
```

Required methods based on the current Tauri commands:

- `config.get`
- `config.save`
- `config.open`
- `notification.show`
- `terminal.start`
- `terminal.write`
- `terminal.resize`
- `terminal.stop`
- `window.create`
- `window.closeApplication`
- `window.toggleDevTools`
- `git.context`

PTY output must use a binary-capable path when available. If the selected WebView bridge only accepts strings, encode chunks with base64 for the proof of concept, measure the overhead, and replace it with a native binary transport before production if necessary.

All requests must be validated in C++. The WebView must reject untrusted navigation, popups, and bridge calls from origins outside the packaged frontend or configured development server.

## Native Implementation Notes

### PTY

Create a common `PtySession` interface with platform implementations:

- Windows: `CreatePseudoConsole`, anonymous pipes, `CreateProcess`, `ResizePseudoConsole`, and `ClosePseudoConsole`;
- macOS/Linux: `forkpty` or `openpty`, `exec`, non-blocking reads, `ioctl(TIOCSWINSZ)`, and process-group termination.

Use one reader task per active session initially. Preserve raw bytes from the PTY to xterm.js. Associate every callback with a monotonically increasing session ID so output from an old process cannot affect a replacement session.

### Configuration

Continue using `~/pnex-config.json` for compatibility. Preserve unknown JSON fields when saving, validate font size and font family, and write through a temporary file followed by rename to avoid partial configuration files.

A small JSON dependency is acceptable, but it should be isolated behind the configuration module. Avoid introducing a general application framework for JSON alone.

### Notifications

Use platform adapters:

- Windows toast notifications with an AppUserModelID and Start Menu shortcut;
- macOS UserNotifications framework;
- Linux freedesktop notifications through D-Bus.

Notification click handlers must activate the originating window only while that window still exists.

### Windows and Application Lifecycle

The runtime must support frameless windows, dragging, minimize, maximize, focus, dynamic title changes, multiple windows, developer tools, and cleanup on destruction. Window IDs must never be reused during a process lifetime.

### Packaging

Packaging is part of the migration, not a later detail:

- Windows: CMake build plus WiX or NSIS installer;
- macOS: `.app` bundle, code signing, notarization, and DMG/PKG as needed;
- Linux: AppImage and/or distribution packages with an explicit WebKitGTK dependency policy.

An auto-update mechanism should not be added until the existing application requires one. If added later, signed update metadata is mandatory.

## Implementation Phases

### Phase 0: Baseline

Record the current Tauri measurements on a clean machine and a warm development machine:

- clean build duration;
- incremental native build duration;
- frontend-only rebuild duration;
- `src-tauri/target` disk usage;
- installer and installed application size;
- idle and active terminal memory usage;
- startup time to the first usable prompt.

These values define whether a migration is successful.

### Phase 1: Decouple the Frontend

Introduce the pnex backend interface and move all direct Tauri calls behind `tauri-backend.ts`. Behavior must remain unchanged. This is useful even if the migration is cancelled because it makes the native protocol explicit.

### Phase 2: Windows Proof of Concept

Implement one C++ window using WebView2 through `webview/webview`, load the existing Vite frontend, and support:

1. configuration loading;
2. one ConPTY session;
3. binary-safe input and output;
4. resize and shutdown;
5. basic window controls;
6. development and packaged frontend loading.

Windows is the first target because the repository currently contains Windows-specific notification integration and Windows executables.

### Phase 3: Feature Parity

Add multiple windows, inherited directories, Git context, configuration saving/opening, notifications, click activation, and developer tools. Match existing command errors and lifecycle behavior where practical.

### Phase 4: macOS and Linux Adapters

Implement WKWebView/WebKitGTK-specific lifecycle integration, Unix PTYs, notifications, packaging, and CI builds. Do not claim cross-platform support until smoke tests pass on real machines for all three systems.

### Phase 5: Decision and Removal

Compare the proof of concept against the Phase 0 baseline. Remove Tauri only if:

- required functionality has parity;
- PTY streaming remains responsive under sustained output;
- shutdown leaves no shell or reader process behind;
- native build time and disk usage improve materially;
- packaging and signing are reproducible;
- the maintenance cost of platform adapters is accepted.

Otherwise, retain Tauri and consider Option A: moving only high-churn native logic to C++.

## Verification

Automated tests should cover:

- bridge request parsing, unknown methods, malformed payloads, and error responses;
- configuration defaults, validation, unknown-field preservation, and atomic writes;
- PTY start, input, output, resize, exit, forced stop, and stale-session isolation;
- directory normalization and unavailable inherited directories;
- window destruction cleanup;
- navigation and origin restrictions.

Manual smoke tests should cover:

- PowerShell and another supported shell on Windows;
- Bash/Zsh on macOS and Linux;
- high-volume terminal output;
- Unicode input and output;
- repeated resize operations;
- opening and closing several windows;
- notification click activation;
- developer and packaged builds;
- application exit while child processes are active.

## Non-Goals

- rewriting the TypeScript/xterm.js interface in C++;
- bundling Chromium unless native WebView differences prove unacceptable;
- designing a general-purpose replacement for Tauri;
- mobile support;
- AI/OpenAI integration;
- removing the working Tauri implementation before measured parity.

## Decision Summary

A robust C++ implementation is feasible, but native WebViews are platform-specific and Tauri currently supplies much more than a browser window. The smallest credible path is to preserve the frontend, introduce a pnex-owned backend boundary, and validate a C++20 plus `webview/webview` Windows proof of concept before committing to a full migration.
