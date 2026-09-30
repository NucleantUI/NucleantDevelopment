# NucleantDevelopment

Umbrella workspace. The subfolders are git submodules, each its own repo:

- `NucleantUI` — SwiftUI-shaped UI framework
- `NucleantApplication`
- `NucleantSkia`
- `NucleantThorVG`
- `NucleantVulkan`
- `PyShader` — shaders in Python syntax, compiled to SPIR-V

## NucleantUI: SwiftUI's API is the reference to mimic

NucleantUI's public API is modeled on SwiftUI. When designing or changing
API, look to `research/SwiftUI-api` first for inspiration: names,
signatures, modifiers, and behavior should match SwiftUI's as closely as
practical.

It doesn't have to be 100% identical. Deliberate differences like `@View`
(below) are ours and take precedence. Beyond those, how close to get is a
case-by-case call, weighed against how `NucleantApplication` and
`NucleantVulkan` actually work today. If matching SwiftUI exactly fights
the underlying app/render model, work with what they do.

`research/OpenSwiftUI` is a secondary reference: useful for seeing how
someone else implemented a specific view under the hood. Treat it as
help, not a blueprint — our implementation will always have its own
twists. `research/OpenCombine` is not used; ignore it.

## NucleantUI: ALWAYS use `@View` on every view struct. No exceptions.

Every single view struct in `NucleantUI/`, with zero exceptions — top-level
screens, tiny local helper views, everything — gets `@View`:

```swift
@View
struct Foo {
    var body: some View { ... }
}
```

`struct Foo: View { ... }` is FORBIDDEN. Not a fallback, not "fine for
small views," not a judgment call to make per-case. If you write a view
struct, it gets `@View` on it. Full stop. Seeing `struct Foo: View` in a
diff means fix it, not evaluate it.

## NucleantUI: `AnyView` is last resort. Plain `Any` / `any View` are not used at all.

Reach for generics or parameter packs before reaching for erasure:

- A property or function that holds/returns one view of a caller-chosen
  type: generic parameter (`struct Foo<Content: View>`), not `any View`.
- A heterogeneous, fixed-arity list of views (a container's children,
  a builder's multiple branches): a parameter pack
  (`struct Foo<each Content: View>`), not `[any View]`.
- Only when the shape is genuinely unbounded/heterogeneous at a real API
  boundary — e.g. a closure stored as a property that different call sites
  fill with different concrete view types, like `ContextMenu`'s items or
  `Popover`'s content in `Sources/NucleantUI/Modifiers/` — is type erasure
  justified. That boundary case is what "last resort" means here: `AnyView`
  (`Sources/NucleantUI/Core/PrimitiveViews.swift`), the framework's existing
  erasure boundary, is the one acceptable way to reach for it.

Plain `Any` / `any View` existentials are a different thing, not a milder
version of `AnyView` — they have no accepted use in this codebase at all,
last-resort or otherwise. This is about views (value types) specifically —
see below for erasing reference types.

## NucleantUI: `Any` for classes/reference types is also last resort

Same "last resort" stance applies to `Any`/existentials used for type
erasure on classes — but the fallback there is different, since these are
reference types, not views: prefer manual pointer-based erasure
(`Unmanaged`/`UnsafeMutableRawPointer`) over boxing a class instance in
`Any`/`any SomeProtocol`. This does not apply to view structs — views are
value types and are handled entirely by the rule above (generics/parameter
packs, `AnyView` at a real boundary); raw pointers are never how a view
gets erased.

## NucleantUI: a data model that changes is an `@Observable` class

App state that is mutated over time — a session, a document, a list being
edited, anything the user works on — is a `@MainActor @Observable final
class`, changed through its own methods. Not a struct held in `@State` and
replaced or mutated wholesale through a `@Binding`.

- The view that owns the model holds it in `@State`; views below take it as
  a plain `let` (or `@Bindable` when they need a `Binding` into one of its
  properties). Each view then rebuilds only for the properties it read.
- Structs are for the small values *inside* a model — an entry, a record, an
  input (`Card`, `Track`, a `Grade` enum) — and for view inputs.
- A view's own transient UI state (is this flipped, how far is it dragged)
  stays in that view's `@State`; it is not model data.

This applies to examples and demos as much as to the framework: they are the
code people copy. It is for new code and code you are already changing — not
a reason to go back and convert existing examples that don't follow it,
unless asked.

## NucleantUI: platform capabilities are concrete cross-platform types; platform code lives under the hood

NucleantUI, and every example and demo built on it, targets macOS, iOS,
Linux and Android (see the platform products in `NucleantUI/Package.swift`),
plus whatever gets added later. A file that only compiles on Apple platforms
is broken, whether it's framework code or an example.

Anything that needs the OS — loading a font, loading/decoding an audio file,
playing audio, decoding an image, MIDI, file pickers, and so on — is a
**concrete framework type with one API on every platform** (a font loader,
an audio file loader, an audio player, …). Callers use that type and never
see the platform. Under the hood, the type is specific per platform:
CoreText/AVFoundation/AudioToolbox on macOS/iOS, the native equivalent on
Linux and Android (e.g. audio: PipeWire/PulseAudio/ALSA on Linux,
AAudio/Oboe on Android; fonts: fontconfig/FreeType on Linux, the system font
dirs on Android).

- Examples, demos and views never import an Apple-only framework
  (`AVFoundation`, `AudioToolbox`, `CoreAudio`, `CoreMIDI`, `CoreText`,
  `CoreGraphics`, `ImageIO`, `AppKit`, `UIKit`, `Metal`, …) and never
  contain `#if os(...)`/`#if canImport(...)` to reach one. If an example
  needs a capability the framework doesn't have yet, build the
  cross-platform type in the framework first, then use it — don't wire
  AVFoundation straight into a sampler or metronome.
- Structure it the way `NucleantApplication/Sources/NucleantApplication/`
  does: one shared file declares the type or protocol and the API every
  platform provides (`NucleantApplication.swift`), and **each platform
  gets its own file** — `Foo+MacOS.swift`, `Foo+iOS.swift`,
  `Foo+Linux.swift`, `Foo+Android.swift` — wrapped whole in its
  `#if os(...)`, importing that platform's frameworks and adding the
  matching extension. When the implementation needs its own type per
  platform, each platform file defines it under the same name (as each
  `App+*.swift` defines its own generic `AppDelegate<App>`), so only one
  is in scope per build and the shared code refers to it without any
  `#if`. Use protocol + generics to tie them together, not existentials.
- `#if` goes at the top of those platform files, not sprinkled through
  shared code, and never through view bodies or examples. Guarding alone,
  without a type that hides it, is not enough.
- Every platform gets its file. Before writing the Apple ones, decide what
  Linux and Android do: a real native backend, a portable implementation
  shared by all, or — only if neither is practical right now — a platform
  file that compiles and fails visibly (a thrown "unsupported on this
  platform" error, not a silent no-op or a missing file). State which you
  picked and why.
- The public API is designed from what all platforms can do, not shaped
  around one platform's framework types — no `AVAudioPCMBuffer`, `CTFont`,
  `CGImage` etc. in its signatures.
- Foundation is available everywhere (swift-corelibs-foundation), but not
  every Foundation API behaves the same off Darwin — check before relying
  on something Darwin-specific in it.

## NucleantUI / NucleantThorVG: mutate an existing ThorVG paint before rebuilding it

Confirmed against the ThorVG wrapper (`NucleantThorVG/Sources/NucleantThorVG/`):
a `Tvg_Paint` supports moving, resizing, and recoloring in place, without
touching its path/points:

- Position/size change on an existing shape: `translate` / `scale`
  (`ThorPaint.swift` — `tvg_paint_translate` / `tvg_paint_scale`), not a
  full clear-and-redraw of the instructions that built it.
- Color change on an existing shape (fill or stroke), with its path/points
  unchanged: `set_fill_color` / `set_stroke_color`
  (`ThorShape/ThorShape.swift` — `tvg_shape_set_fill_color` /
  `tvg_shape_set_stroke_color`), not rebuilding the shape from its
  path/points again.

Full rebuild from path/points is for when the path/points themselves
change (or the shape doesn't exist yet) — not the default move for a
position, size, or color change on a shape that's already drawn.

## Ignore `NucleantUI/Sources/ExperimentalUITests/` completely

That folder is the user's personal scratch/testing area. Never cite it,
reference it, or treat anything in it as precedent, prior art, an example,
or justification for a pattern — in this file or in any actual code
change. Not "weak precedent," not "worth a mention for context" — zero
weight, full stop. If it's relevant to something you're about to write or
suggest, leave it out entirely rather than mentioning it.
