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
