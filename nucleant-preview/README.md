# Nucleant Preview

Live WebAssembly builds of a NucleantUI app beside the editor. Two buttons in
the editor title bar of any Swift file:

- **Run App to the Side** (`▷`) — the app itself, as `@main` runs it.
- **Show Previews to the Side** — a `NUCLEANT_PREVIEW` build: instead of the
  app's scenes, `NucleantApp.main()` runs `PreviewRuntime`, which shows the
  `@Preview` functions of the file in the editor as tabs. Focusing another
  file of the package with `@Preview`s in it switches to its previews (a
  reload, no rebuild); a file without any leaves the panel as it is.
  The lock button (in the Swift editor's and the panel's title bar, or
  **Nucleant: Lock Previews to This File**) keeps the panel on the file
  it shows while you work in others; saves still rebuild and reload it.
  Unlocking follows the editor again. Show Previews on another file
  while locked moves the lock to that file.

```swift
@Preview("Progress ring")
@MainActor
func progressRingPreview() -> some View {
    ProgressRing(progress: 0.4, color: .red)
}
```

Saving a Swift file rebuilds; the panel reloads when the build lands, on the
preview tab that was open in that file (remembered per file, across VS Code
restarts too). The previews panel keeps showing the last frame
until the new build has drawn its first, so a reload doesn't flash black. Design
notes: `NucleantUI/plans/wasm-preview.md`.

## Use

- The package is the nearest `Package.swift` above the file; with several
  executable products it asks once (**Nucleant: Choose Preview Product…**
  to change).
- The build is `NucleantApplication/scripts/build_wasm_app.py` (`--preview`
  for previews, which builds in `.build/wasm-preview`). The page goes to
  `<package>/.build/wasm-live/<Product>` or `.build/wasm-preview-app/<Product>`.
- Progress shows in the page (bar and label, top left), the status bar and
  the panel title; click the status bar item for the build log. A failed
  build shows its errors over the last good one.
- What happens in the page — its WebGPU/JSPI support, the app starting,
  console errors, traps — is logged as `[page]` lines in the *Nucleant
  Preview* output.
- **Nucleant: Open Preview in Browser** opens the same page in a browser; it
  live-reloads too.

Needs what `build_wasm_app.py` needs: the wasm Swift SDK with its matching
toolchain, and `NucleantVulkan/Web/naga_webgpu.wasm`.

## Install

No build step. Either open this folder in VS Code and press F5, or link it
into your extensions and reload the window:

```sh
ln -s "$PWD" ~/.vscode/extensions/nucleant.nucleant-preview-0.0.1
```

## Test

Runs the extension in a real VS Code (own profile, beside yours) on one
file, and checks the build, the page starting, and a drawn frame:

```sh
node test/run.js NucleantUI/Examples/Pomodoro/Sources/Pomodoro/PomodoroApp.swift previews
```

## Settings

| Setting | Default | |
|---|---|---|
| `nucleantPreview.buildScript` | found | path to `build_wasm_app.py` |
| `nucleantPreview.python` | `python3` | |
| `nucleantPreview.release` | `false` | `--release` builds |
| `nucleantPreview.debounceMs` | `400` | |
| `nucleantPreview.buildOnSaveOnly` | `true` | off: rebuild on any change on disk |
