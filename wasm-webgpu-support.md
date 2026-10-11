# Vulkan vs WebGPU api in NucleantVulkan
fill out the NucleantVulkan to support WebGPU instructions as instand in for vulkan when 
doing wasm + webgpu

but nothing with webgpu part should ever effect how vulkan side of things works
soo its webgpu side job to mimic the vulkan code 100%...

also means #if platform wasm or whatever should be used around everything not related to other platforms, and also so it doesnt effect the other platforms..

## Status: done for this package

On wasm, `CVulkan` is no longer a loader or MoltenVK — it **is** the Vulkan
driver, written in C on top of the browser's WebGPU, the way MoltenVK is
Vulkan on Metal. `VulkanCore`, `NucleantShader` and `NucleantVulkan` compile
for `wasm32-unknown-wasip1` **unchanged**: the same `vkCreateImage`,
`vkCmdBeginRenderPass`, `vkQueueSubmit` … calls run, and the WebGPU side does
whatever it takes to give them Vulkan's behaviour.

Changes on the Vulkan side are only `#if os(WASI)` guards / wasm additions:

| File | Change |
|---|---|
| `Package.swift` | `WASM_BUILD=1` → `.wasi` platform branch: `CVulkan` = `Sources/CVulkanWasm`, `CShaderc`/`CSPIRVCross` = vendored wasm archives, no `CWgpu` |
| `VulkanRenderEngine.swift` | `import CWgpu` skipped on WASI (the import was unused there) |
| `WgpuContext.swift` | whole file `#if !os(WASI)`; `WgpuContext+Wasm.swift` gives the same API on wasm (see ThorVG below) |
| `VulkanRenderEngine+Wasm.swift` | new: `init(canvasSelector:getSize:)`, the wasm entry point next to `init(metalLayer:)` etc. |

macOS builds and tests exactly as before (verified).

### What is where

```
NucleantVulkan/
  Sources/CVulkanWasm/          the Vulkan implementation (C, wasm only)
    include/shim.h              vulkan.h with 64-bit-style pointer handles
    include/vulkan_webgpu_nucleant.h   VK_NUCLEANT_webgpu_surface (canvas surface)
    vkw_internal.h              Vk object layouts, JS bridge imports, stream format
    vkw_device.c                instance / physical device / device / surface / swapchain
    vkw_memory.c                formats, memory (+ host shadow), buffers, images, views, samplers
    vkw_descriptor.c            set layouts, pipeline layouts, pools, sets, updates
    vkw_pipeline.c              shader modules, render passes, framebuffers, pipelines
    vkw_command.c               command pools/buffers, vkCmd* recording
    vkw_queue.c                 vkQueueSubmit → command stream, fences, waits
  Sources/CShadercWasm, CSPIRVCrossWasm   headers for the vendored wasm archives
  Dependencies/wasm/lib/        libshaderc_combined.a, libspirv-cross-*.a (wasm32-wasip1)
  NagaWebGPU/                   Rust: SPIR-V → WGSL (+ the Vulkan→WebGPU shader rewrites)
  Web/
    nucleant-webgpu.js          the WebGPU half: handles, pipelines, stream interpreter
    nucleant-wasi.js            WASI preview1 for the browser
    naga_webgpu.wasm            built NagaWebGPU
    test/                       page that runs the test product
  scripts/
    build_shader_tools_wasm.py  shaderc + spirv-cross → Dependencies/wasm/lib
    build_naga_wasm.py          NagaWebGPU → Web/naga_webgpu.wasm
    run_wasm_tests.py           build tests for wasm, run them in headless Chrome
```

### How it runs

The C side keeps all *Vulkan* state (memory and its host copy, descriptor
sets, render passes, recorded command buffers, fences) and implements every
`vk*` the engine, VulkanCore and NucleantUI call (~95). WebGPU objects live in
JS, referenced from C by integer ids (never reused, so a stale handle fails
instead of aliasing). Recording only stores commands; `vkQueueSubmit` turns
them into a compact `u32` command stream + a scratch "arena" and hands both to
JS in one call, which encodes and submits the WebGPU commands. Recording late
is what gives Vulkan semantics for everything read "at execution time":
descriptor contents, mapped memory, swapchain image.

### Vulkan → WebGPU, and how each gap is closed

| Vulkan has | WebGPU | Here |
|---|---|---|
| `VkDeviceMemory`, `vkMapMemory` | no CPU pointers into GPU memory | HOST_VISIBLE memory keeps a shadow in wasm memory; host writes reach bound buffers at `vkUnmapMemory` and, for persistent maps (coherent), at every submit; GPU writes come back by readback into the shadow |
| image layouts, `vkCmdPipelineBarrier` | automatic usage tracking | barriers are no-ops |
| semaphores, fences | one in-order queue, `onSubmittedWorkDone()` | semaphores are trivially satisfied; fences carry the submit serial; `vkGetFenceStatus` is exact |
| blocking `vkWaitForFences` / `vkQueueWaitIdle` | nothing blocks the page | with **JSPI** the wasm stack really suspends until the GPU is done (and readbacks have landed); without JSPI they return at once — WebGPU keeps in-flight resources alive and ordered, so frame loops still behave, only host reads of GPU data arrive late |
| viewport larger than / off the framebuffer | viewport must be inside the target | the viewport is clamped and the vertex stage remaps clip space by a per-draw `vec4` (injected by NagaWebGPU), so every vertex lands where Vulkan puts it — tested pixel-exact |
| push constants | none (immediates aren't portable yet) | lowered to a read-only storage buffer in an extra "draw data" bind group; each draw/dispatch with new values gets a 256-aligned slot in the arena, bound with a dynamic offset |
| `COMBINED_IMAGE_SAMPLER` | separate texture + sampler | SPIR-V rewritten before naga: sampler at `binding + 512`, same set |
| set layouts without formats | bind group layouts need storage format / sample type / view dim | layouts built from the translated shaders' reflection; bind groups built per descriptor-set version, cached |
| `bufferRowLength` any pitch | `bytesPerRow` multiple of 256 | uploads from host memory repacked in C into the arena; otherwise row-wise GPU repack in JS |
| `vkCmdBlitImage` (scaling) | no blit | textured-quad render pass (mirrors handled); same-size blits are plain copies |
| `vkCmdClearColorImage` | no clear command | one-attachment render pass with `loadOp: clear` |
| swapchain, acquire, present | `GPUCanvasContext`, presents when the task ends | swapchain images are proxies resolved to `getCurrentTexture()` at submit; canvas resize → `OUT_OF_DATE`; present is a no-op that reports `SUBOPTIMAL` on resize |
| `VK_KHR_*_surface` per OS | — | `VK_NUCLEANT_webgpu_surface`: a VkSurfaceKHR from a `<canvas>` CSS selector |
| non-dispatchable handles are `uint64_t` on 32-bit | — | `VK_USE_64_BIT_PTR_DEFINES 1` on wasm32 so handles are pointers, as the Swift code expects |

### Shaders

- **GLSL at runtime still works**: shaderc (glslang + SPIRV-Tools) is built for
  wasm32-wasip1 by `build_shader_tools_wasm.py` and linked into the module, so
  `VKShaderCompiler` produces the same SPIR-V as on desktop. Two wrinkles
  handled there: the SDK's libc++ has no threads (a no-op `std::mutex` is
  force-included — one thread, nothing to contend), and SPIRV-Tools' CMake
  doesn't know WASI (treated as Emscripten, which only affects terminal
  colours).
- **SPIR-V → WGSL** happens at pipeline creation in `NagaWebGPU` (naga 30,
  `spv-in` + `wgsl-out`, ~0.6 MB wasm). It flips clip-space y (naga's
  `adjust_coordinate_space`), keeps only the requested entry point, does the
  push-constant / viewport / combined-sampler rewrites above and returns WGSL
  plus binding reflection as JSON. PyShader output goes through the same path
  (it is SPIR-V like everything else).

### Tests

`Tests/NucleantVulkanTests/WebGPUStandInTests.swift` (wasm only), run with
`scripts/run_wasm_tests.py`. They are plain Vulkan code checked against what
Vulkan defines — **8/8 pass in headless Chrome 155**, no WebGPU validation
errors (the runner fails the run on any):

- compute shader (GLSL via shaderc-on-wasm) writes a storage image → read back
- viewport twice the target and half off its edge → exact Vulkan UV mapping
- push constants per draw with per-draw scissors
- 40-byte-row upload → 2× nearest blit → 80-byte-row readback
- `vkCmdClearColorImage`; fence status / wait / reset
- `VulkanRenderEngine` on a canvas: swapchain, composite pipeline, pixel-buffer node

### Not done yet (fails visibly, logged)

Vertex/index buffers, depth/stencil attachments, input/resolve attachments and
multiple subpasses, dynamic descriptor offsets, texel buffers, specialization
constants, descriptor arrays (>1 per binding), linear-tiled / host-mapped
images, copies to/from swapchain images, `vkCmdDrawIndirectCount` (unused),
read-write `rgba8` storage textures (core WebGPU only allows read-write on
`r32*` formats; the optional `texture-formats-tier2` feature widens that and
could be requested). None of these are used by NucleantVulkan,
VulkanCore or NucleantUI today.

# NucleantApplication

setup new NucleantApplication / NucleantWindow target for wasm app support..

## Status: done for this package

Same shape as Linux/Android: `WASM_BUILD=1` declares the wasm targets; on
every other platform nothing changes (verified: macOS builds, 9/9 tests pass).

| Piece | What |
|---|---|
| `Sources/Platform_Wasm/` | `PlatformWindow<WindowBase>` (a `<canvas>` per window, same API as Linux's: `width/height/scale`, `bufferWidth/Height`, `canvasSelector`, `show/close/setTitle/setFullscreen`, frame loop), `BrowserWindowDelegate` (+ default forwarding to `on_*`), `BrowserKeyMap` (DOM `code` → macOS virtual key codes, which NucleantUI reads), `BrowserEvents` (exported `nucleant_frame` / `nucleant_pointer` / `nucleant_wheel` / `nucleant_key` / `nucleant_window_resized`), `BrowserFrameLoop`, `BrowserAppearance` (the page's `prefers-color-scheme` via `matchMedia`; each change arrives through the exported `nucleant_color_scheme_changed`) |
| `Sources/CWasmDOM/` | imports of the `nucleant_dom` module (window create/destroy/metrics, event strings, frame loop start/stop) |
| `App+Wasm.swift` | `setup()` / `run()` / `AppDelegate`: `run()` fires `onStart()` and **returns** (the browser owns the loop, like Android); the page holds the app from then on |
| `SyncCallbackHandler+Wasm.swift` | NucleantSync rides the page's requestAnimationFrame, thinned by `FramePacer` |
| `Sources/WasmProbe/` | the browser's WaylandProbe: one window, the render engine on its canvas, a CPU-painted pixel-buffer node reacting to mouse/touch/keys, input logged |
| `Web/nucleant-app.js` | page runtime: DOM bridge (canvases, pointer/wheel/key listeners, ResizeObserver with device-pixel sizes, rAF) and **one serialized queue for every call into wasm** |
| `Web/index.html` | page template |
| `scripts/build_wasm_app.py` | build a product as a WASI reactor + lay out the page (`--release`, `--serve`) |
| `scripts/run_wasm_tests.py` | tests in headless Chrome |

    python3 NucleantApplication/scripts/build_wasm_app.py WasmProbe --release --serve
    # → http://127.0.0.1:8080/

Tests: `BrowserPlatformTests` (key map, canvas metrics, mouse/touch/pen/wheel/key
routing through the real exported entry points, frame timing, light/dark,
named time zones,
app lifecycle) plus the existing `DisplaySyncTests`/`FramePacerTests`, now
also running on the page's real rAF — **all pass in headless Chrome** (31
with the main-queue tests). WasmProbe was
checked by screenshot in headless Chrome, with and without JSPI: renders at
60 Hz (16.7 ms frames), crosshair follows the mouse, keys/wheel/mouse logged
with correct coordinates and key codes.

# Running in Chrome — how to

## Once per machine

1. swift.org **Swift 6.3.3 toolchain** + the matching **wasm SDK**
   (`swift-6.3.3-RELEASE_wasm`), see Toolchain below. Not Xcode's toolchain.
2. **Google Chrome 137+** (WebGPU + JSPI on by default). Any Chrome works,
   including headless and Chrome for Testing.
3. `meson`, `ninja`, `pkg-config` (only to rebuild the vendored C/C++ archives).
4. Vendored wasm archives — already in the tree, rebuild only when bumping:
   - `python3 NucleantVulkan/scripts/build_naga_wasm.py` → `NucleantVulkan/Web/naga_webgpu.wasm`
   - `python3 NucleantVulkan/scripts/build_shader_tools_wasm.py` → shaderc / spirv-cross
   - `python3 NucleantThorVG/scripts/build_thorvg_wasm.py` → `NucleantThorVG/Dependencies/wasm/lib/libthorvg-1.a`
   - `python3 NucleantSkia/scripts/build_skia_wasm.py` → `NucleantSkia/Dependencies/wasm/{lib,include}`
     (Skia m144 with Graphite/WebGPU; needs `git` and `ninja`, fetches the
     Skia revision, its deps and Dawn's headers into `NucleantSkia/scripts/.work`;
     a full build takes a while, later runs are incremental)

## Run a NucleantUI app (e.g. Flashcards)

    python3 NucleantApplication/scripts/build_wasm_app.py Flashcards \
        --package-path NucleantUI/Examples/Flashcards --serve
    # then open http://127.0.0.1:8080/ in Chrome

- `--release` for an optimized, smaller build; `--port N`; `--output DIR`.
- Without `--serve` the page is just written to
  `<package>/.build/wasm-app/<Product>/`; serve that directory over
  **http://127.0.0.1 or localhost** (WebGPU needs a secure context — a
  `file://` URL does not work), e.g. `python3 -m http.server -d <dir> 8080`.
- Any other example: same command with its product name and
  `--package-path NucleantUI/Examples/<Name>`. A NucleantApplication-only
  app: `python3 NucleantApplication/scripts/build_wasm_app.py WasmProbe --serve`.
- The page directory holds `<Product>.wasm`, `index.html`, `nucleant-app.js`,
  `nucleant-webgpu.js`, `nucleant-wgpu.js`, `nucleant-wasi.js`,
  `naga_webgpu.wasm`, `resources/` + `resources.json` (the products'
  resource bundles, mounted read-only at `/app` in the module's file system,
  `NUCLEANT_APP_PATH=/app` — that is where the bundled Roboto fonts come from —
  and again at the directory they were built in, the manifest's `buildRoot`,
  where SwiftPM's `Bundle.module` looks; see known gap 7),
  and `zoneinfo.bin` (the time zone database, mounted at `/usr/share/zoneinfo`;
  see known gap 11).
- Debugging: Chrome DevTools console shows Swift's `print`, WebGPU validation
  errors, and traps with Swift symbol names (debug builds keep the name
  section). DevTools → Sources can step through wasm.

## Run the tests in headless Chrome

Each script builds the package's tests for wasm (`WASM_BUILD=1`, scratch
`.build/wasm`), serves them, runs them in headless Chrome, relays the output
and exits with the tests' status (any WebGPU validation error fails it).
`--headed` shows the browser; arguments after `--` go to the test runner.

    python3 NucleantVulkan/scripts/run_wasm_tests.py
    python3 NucleantThorVG/scripts/run_wasm_tests.py
    python3 NucleantSkia/scripts/run_wasm_tests.py
    python3 NucleantApplication/scripts/run_wasm_tests.py
    python3 NucleantUI/Scripts/run_wasm_tests.py -- --filter BrowserTests

Chrome is found at the usual install paths; otherwise `--chrome PATH` or
`CHROME=...`.

## Build by hand (what the scripts do)

    cd NucleantUI/Examples/Flashcards
    WASM_BUILD=1 ~/Library/Developer/Toolchains/swift-6.3.3-RELEASE.xctoolchain/usr/bin/swift build \
        --swift-sdk swift-6.3.3-RELEASE_wasm --scratch-path .build/wasm \
        --toolset .build/wasm/reactor-toolset-debug.json --product Flashcards

The toolset (written by `build_wasm_app.py`) carries the wasm-only link
options: `-mexec-model=reactor`, `--export=__main_argc_argv`, and an 8 MB
stack (`-z stack-size=8388608`). They must go through a toolset:
`-Xswiftc`/`-Xlinker` also reach the host link of the `@View` macro plugin,
whose linker rejects `--export`. **The stack matters**: the driver's default
is 128 KB placed right after the data, and a debug-build view tree overruns
it silently — corrupted type metadata, then a "table index is out of bounds"
trap somewhere unrelated.

# Skia in the browser — done (Graphite on the page's WebGPU)

**Skia is NucleantUI's primary 2D renderer in the browser too** — `SKIA_MODE`
is on for wasm exactly as on macOS/iOS/Linux/Android (`NUCLEANT_SKIA_MODE=0`
still switches to ThorVG, everywhere). ThorVG stays the secondary renderer:
`ThorCanvas` views draw through their own ThorVG nodes in both modes.
Verified: Flashcards in headless Chrome with the window canvas a Skia node
(`CanvasBackend` + `SkiaDisplayRenderer`): text, shapes, the progress ring,
the flip, the fling, the tilted drag and the hint all render.

On every other platform NucleantSkia is **Ganesh on Vulkan**
(`cskia.cpp`: `GrDirectContexts::MakeVulkan` over the engine's
VkDevice/queue, drawing into the node's VkImage). In the browser it is
**Graphite with its Dawn (WebGPU) backend** — Skia's own WebGPU path — on
the page's GPUDevice, the one NucleantVulkan's Vulkan runs on. The Swift side
of NucleantSkia (`SkiaVulkanContext`, `SkiaSurface`, `SkiaShaderNode`,
`VulkanRenderEngine+Skia.swift`) and NucleantUI's Skia code are unchanged:
only the implementation of `cskia.h` differs.

| Piece | What |
|---|---|
| `NucleantSkia/scripts/build_skia_wasm.py` | Skia m144 (the revision `build_skia.py` builds) for `wasm32-wasip1` → `Dependencies/wasm/{lib,include}`: Graphite + Dawn backend; no Ganesh/GL/Vulkan/PDF/SVG; FreeType with the *custom empty* font manager (no system fonts — faces come from files/data); libpng, zlib; single-threaded. Skia's **native-Dawn** code paths, compiled against Dawn's own `webgpu.h` (release v20260219.200501 headers, installed under `include/dawn-headers`) — its `__EMSCRIPTEN__` branches target Emscripten's old WebGPU API. The clang it drives is the wasm SDK's, through emcc-named wrappers (`-mllvm -wasm-enable-sjlj` for libpng's setjmp, `-D_WASI_EMULATED_MMAN`, `-Dthread_local=`). Patches it applies: no `musttail`; two Dawn-native features whose names moved; SkPath's edit methods kept (as `build_skia.py` does elsewhere by reverting skia-python's "immutable SkPath" patch); `SkSemaphore` as a one-thread count. |
| `NucleantSkia/Sources/CSkia/cskia_webgpu.cpp` | `cskia.h` on Graphite: the context is Graphite on the page's device through CWgpu's `webgpu.h`; a surface wraps **the WebGPU texture the node's VkImage is** (`vkExportWebGPUObjectsNUCLEANT`, below) — no copy; a flush is snap + insertRecording + submit, with **no CPU wait**: Skia's work and the engine's frame go to the one GPUQueue in that order. No image layouts on WebGPU, so `notify_layout` is a no-op. Graphite runs *non-yielding* (no tick function — the module can't spin while the page settles a promise); destroying the context first waits for the queue (WaitAny, which blocks under JSPI) and, where the page cannot wait, leaves the context alive rather than abort. Raster images go through an **uploading image provider** (Graphite's default one draws no non-GPU images; Ganesh uploads them itself), cached per image ID (LRU, 256). Also the two Dawn-only calls Graphite makes (`wgpuDeviceGetAdapter`, `wgpuDeviceTick`) on standard webgpu.h. `cskia_api.cpp`'s font manager is the empty custom one on wasm. |
| `NucleantSkia/Package.swift` | `WASM_BUILD=1` → `.wasi`: CSkia from `cskia_webgpu.cpp` + `cskia_api.cpp`, Skia's public defines, `-fno-exceptions` (the SDK's libc++abi has no throw), links skia/freetype2/png/zlib/skcms/c++/c++abi/setjmp; depends on NucleantVulkan for CVulkan's header. |
| NucleantVulkan `VK_NUCLEANT_webgpu_objects` export half | `vkExportWebGPUObjectsNUCLEANT(device, VkExportWebGPUTextureInfoNUCLEANT*)` — the `WGPUTexture` a VkImage is (shape of `vkExportMetalObjectsEXT`); the caller gets its own reference (`wgpuTextureRelease`). Swapchain images export NULL. |
| NucleantVulkan CWgpu (`webgpu_wasm.c` + `Web/nucleant-wgpu.js`) | grew what Graphite calls. **Mapping**: a buffer mapped for writing (MapWrite / mappedAtCreation) is mapped in wasm memory and its contents go through `queue.writeBuffer` at Unmap (the page makes it COPY_DST instead of MAP_WRITE), so mapping is synchronous as on native; a buffer mapped for reading uses the page's `mapAsync` and the range is copied in when it lands. **Futures**: polled — `wgpuInstanceWaitAny` / `ProcessEvents` run the callbacks of what the page has settled; a WaitAny with a timeout suspends under JSPI. Plus OnSubmittedWorkDone, error scopes, shader compilation messages, compute passes, buffer↔texture copies, ClearBuffer, query sets, indirect draws, CreateRenderPipelineAsync, GetBindGroupLayout, limits, adapter info, labels. Not provided: immediates (so `maxImmediateSize` is reported 0 — Graphite then uses a uniform buffer), WriteTimestamp (browsers time passes only). Fixed on the way: an empty `Undefined` vertex-buffer layout is a hole (`null`), not a slot. |
| Tests | NucleantVulkan `WebGPUHeaderFuturesTests` (mapping, futures, compute, copies, queries, error scopes, compilation messages, limits) and export tests in `WebGPUHeaderTests`; NucleantSkia `SkiaWebGPUTests` (Skia draws into the engine's image — shapes, paths with AA, text from a font file, an uploaded image, resize, engine compositing) plus all the raster tests; NucleantUI `BrowserTests` window test follows the primary renderer. NucleantVulkan's test page takes a `files` manifest so a package's `Bundle.module` resources are mounted at their build path. |

# NucleantUI + NucleantThorVG

## Status: Flashcards runs in Chrome (Skia primary since the Skia section above; first verified in ThorVG mode)

Verified by screenshots in headless Chrome: the deck renders (text in
the bundled Roboto/Roboto Mono, shapes, the progress ring, the `TimelineView`
clock ticking); Reveal flips the card, Knew it flings it and the completion
deals the next one, a drag moves/tilts the card and springs it back.

| Piece | What |
|---|---|
| NucleantVulkan `Sources/CWgpuWasm/`, `Web/nucleant-wgpu.js` | `webgpu.h` (wgpu-native's header) implemented on the page's WebGPU — the same GPUDevice the Vulkan implementation uses |
| NucleantVulkan `VK_NUCLEANT_webgpu_objects` | `VkImportWebGPUTextureInfoNUCLEANT`: a VkImage over a WGPUTexture, zero copy (counterpart of `VK_EXT_metal_objects`); `WgpuContext+Wasm.swift` mints the targets |
| NucleantVulkan `Web/nucleant-wasi.js` | read-only in-memory file system (`files` option, preopened at `/`) |
| NucleantThorVG | `scripts/build_thorvg_wasm.py` (ThorVG 1.0.5, `cpu`+`wg` engines, no threads; `thread_local` compiled as static), wasi branch in `Package.swift`, `VulkanRenderEngine+Thor+Wasm.swift` |
| NucleantApplication `Sources/DispatchWasm/` (module `Dispatch`) | libdispatch's API for the one thread (`DispatchQueue.main.async/asyncAfter`, `DispatchTime`, `Thread.isMainThread`); a main queue the page services (`mainQueueWake` → `nucleant_main_queue_run`); `MainQueueExecutor` replaces Swift concurrency's main + default executors (6.3's SPI `ExecutorFactory`) so `Task {}` / `Task.sleep` run after `main` returned — installed by `AppDelegate.run()` |
| NucleantUI | wasm branch in `Package.swift` (`Platform_Wasm` + `Dispatch`; Skia mode as everywhere); `HostingWindow` browser branch; `App.run()` returns like Android; fonts via `NUCLEANT_APP_PATH` like Android; `StringComparator+Wasm.swift`, `Formatter+Wasm.swift` for what WASI Foundation lacks; `#viewID` literal narrowed for 32-bit `Int`; light/dark from `BrowserAppearance` (`BrowserTests.windowFollowsThePagesColorScheme`) |

# general notes

fill out research notes for the wasm + webgpu support..

## Toolchain

- **Swift 6.3.3 + the swift.org wasm SDK** (`swift-6.3.3-RELEASE_wasm`,
  target `wasm32-unknown-wasip1`). The SDK only works with the *matching*
  swift.org toolchain (`~/Library/Developer/Toolchains/swift-6.3.3-RELEASE.xctoolchain`,
  installed via swiftly) — not Xcode's. The scripts find both.
- `Package.swift` is evaluated by the host, so wasm is an **explicit
  opt-in, `WASM_BUILD=1`**, like `ANDROID_BUILD` (no way to see `--swift-sdk`
  from the manifest). Both packages read the same variable.
- Builds go to `.build/wasm` (`--scratch-path`) so the macOS `.build` is untouched.
- Apps are linked as **WASI reactors** (`-mexec-model=reactor`,
  `--export=__main_argc_argv`): the page calls `_initialize`, then `main`, and
  the module stays alive. A command module would run C++ static destructors
  (shaderc's) after `main` returns. Exports from Swift use `@_expose(wasm, "name")`
  (works in library targets, non-embedded Swift 6.3).
- **No JavaScriptKit**: three small, explicit host modules (`nucleant_webgpu`,
  `nucleant_dom`, WASI) instead, in the style PyShader's web preview already
  uses (Swift reactor + naga wasm + hand-written JS). Keeps the C driver
  calling WebGPU synchronously, without Swift⇄JS object marshalling.

## Browser support (as of this writing)

- **WebGPU**: Chrome/Edge 113+, Safari 26+, Firefox 141+ on Windows (other
  Firefox platforms following). Needs a secure context — `localhost` counts.
- **JSPI** (`WebAssembly.Suspending` / `promising`): Chrome 137+, Safari 27
  (beta), Firefox planned for 153. Used for real blocking waits; detected at
  runtime, with a working fallback (verified in Chrome with JSPI forced off).
- Headless Chrome on macOS has a real WebGPU adapter (Metal), so CI-style
  test runs work; Chrome for Testing is enough
  (`npx @puppeteer/browsers install chrome@stable`).

## JSPI and the shadow stack

Swift/C on wasm keep their stack in linear memory (`__stack_pointer`). Two
suspended calls interleaving would corrupt each other's frames, so every call
into the module goes through one FIFO queue (`DOMBridge.pump`); a frame that is
still waiting on the GPU absorbs the next rAF instead of queueing behind it.
WASI's `poll_oneoff` also suspends under JSPI, so `Task.sleep` / `usleep`
really wait while the page keeps running (that is what lets DisplaySync's
existing tests pass in the browser).

## Known gaps / next steps (in order)

1. ~~Swift concurrency in apps~~ — done (`MainQueueExecutor`, see above).
   The old executor hooks (`swift_task_enqueueMainExecutor_hook`) are
   bypassed by 6.3 for the main actor; the `ExecutorFactory` SPI is what works.
2. ~~NucleantUI on wasm~~ — Flashcards runs (see above), ~~in ThorVG mode~~
   with Skia primary (section "Skia in the browser").
3. ~~ThorVG~~ — done as described: same GPUDevice, zero-copy import.
4. **Binary size.** WasmProbe release is 67 MB: 38.6 MB data (Foundation's ICU
   tables — NucleantShader's `import Foundation`), 20 MB code (shaderc is a big
   part), 8 MB names. PyShader already stubs ICU data (`ICUDataStub`); moving
   NucleantShader to `FoundationEssentials` or stubbing ICU, `wasm-opt -Oz`,
   and serving compressed (brotli) are the levers. Precompiling the engine's
   own GLSL would let an app drop shaderc when it compiles nothing at runtime.
5. Implement the "not done yet" list above when something needs it (vertex
   buffers and depth attachments first).
6. Startup: the GPUDevice and naga are acquired before wasm starts
   (`createNucleantWebGPU`); a device-lost handler that rebuilds the engine
   (like Android's `on_surface_recreated`) is not there yet.
7. Files: resource bundles are mounted read-only (see above). SwiftPM's
   generated `Bundle.module` on WASI looks only at absolute paths on the
   *build machine* (the toolchain's `bin/`, then the build directory) and
   `fatalError`s if neither exists, so the page mounts the bundles at the
   build directory too (`buildRoot` in resources.json, written by
   `build_wasm_app.py` and NucleantUI's `run_wasm_tests.py`): an app's own
   `Bundle.module` resolves (AnimatableShader's `.py` shaders;
   `BrowserTests.bundleModuleFindsTheMountedResources`). That path is in the
   .wasm already, so the page names nothing new. Lookups *inside a
   subdirectory* hit a wasm Foundation bug: `url(forResource:withExtension:
   subdirectory:)` (and `path(forResource:ofType:inDirectory:)`,
   `urls(forResourcesWithExtension:subdirectory:)`) drop the name's last
   character — "Fonts/Roboto-Regular.tt" — at any depth (reproduced under
   Node's WASI on a real directory); top-level lookups are fine. No writable
   storage.
8. ~~Light/dark~~ — done: windows follow the page's `prefers-color-scheme`
   (the OS setting, or Chrome's own theme setting), at launch and live
   (`BrowserAppearance`; `HostingWindow` re-applies on every change, as it
   does for macOS's `effectiveAppearance`), and the page template's own
   background follows it too (`light-dark()`). The test scripts start Chrome
   with `--blink-settings=preferredColorScheme=0` (dark) so the appearance
   tests have a known answer on any machine. Key events carry no modifier
   flags yet.
9. Skia: Skia's code adds to the binary (Flashcards: 99.7 MB debug, 78.6 MB
   `--release`; the release build verified in Chrome the same way). No
   system fonts — `cskia_canvas_draw_text`'s default typeface draws nothing;
   everything NucleantUI draws uses the bundled faces through FontRegistry.
   Graphite is non-yielding here, so `SyncToCpu::kYes` is not available (a
   flush never waits; nothing in NucleantUI needs it to).
10. **Foundation/ICU bug in the wasm SDK** (reproduced in a plain Foundation
    program under Node's WASI, nothing of ours in it): a `NumberFormatter`
    whose parse failed or stopped short (`number(from: "forty-two")`,
    `"4x"`) crashes inside ICU (`~DecimalFormat` / its cached number parser)
    when it is deallocated, if any other ICU work happened since or before —
    a `DateFormatter`, a `Calendar`, another `NumberFormatter`. Kept alive it
    is fine. NucleantUI's WASI `Formatter.getObjectValue` (the
    `TextField(value:formatter:)` path, `Formatter+Wasm.swift`) keeps such a
    formatter for the rest of the run; app code using `NumberFormatter`
    directly in the browser can hit it. Worth reporting upstream
    (swift-foundation-icu / swift-corelibs-foundation, WASI).
11. **More of the browser's Foundation, found running the examples**
    (each reproduced in a plain Foundation program under Node's WASI):
    - ~~A `DateFormatter` in a named time zone (`Europe/Lisbon`; UTC and
      fixed offsets are fine) traps~~ — fixed: CFTimeZone reads the zone
      from `/usr/share/zoneinfo/<name>`, so `build_wasm_app.py` packs the
      build machine's zoneinfo into the page (`zoneinfo.bin`, ~730 KB,
      `pack_zoneinfo`) and `nucleant-app.js` mounts it there
      (`loadZoneinfo`); the test page takes it as `?zoneinfo=`
      (`BrowserPlatformTests.namedTimeZonesFormatFromThePagesZoneinfo`).
      `TimeZone.current` is still GMT (no `TZ` from the page yet).
    - A `DateFormatter` given any explicit `calendar` (even
      `Calendar.current`, or with an explicit locale) formats with ICU's
      root names: "M09 2026", "Mon" for "EEEE". Without a calendar it is
      "September 2026". Reading `formatter.calendar` back traps.
    - `RunLoop.main.add(_:forMode:)` does not exist (no `RunLoop`
      scheduling on WASI), so a Foundation `Timer` cannot be scheduled.
    - `Int` is 32 bits (wasm32): `1 << 53` is 0 and literals over
      2 147 483 647 don't compile — 64-bit values need `Int64`/`UInt64`.

    Examples adjusted for these (same behavior on the other platforms),
    each built for macOS and checked in Chrome: Photos and Moodboard
    (`SeededRandom` shifts a `UInt64`), Photos' formatters set only the time
    zone, Finder (byte counts `Int64`; its `Ticker` is a sleeping main-actor
    task). Pomodoro, Metronome and Sampler still schedule a `Timer` on
    `RunLoop.main`, so they don't build for the browser yet.
