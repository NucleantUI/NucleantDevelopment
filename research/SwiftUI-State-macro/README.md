# SwiftUI `@State` macro research

In Xcode 27, `@State` is a macro instead of a property wrapper. The initial
value is evaluated lazily, once, when SwiftUI installs the view's storage. It
is no longer evaluated on every struct init. This folder records what the
macro generates, as input for a NucleantUI `@State` that keeps one instance
of the wrapped value across repeated struct inits.

Xcode 27 needs Apple silicon, so the probe runs on GitHub's `xcode-27`
runner (`.github/workflows/state-macro-research.yml`), which commits its
output here. Run it from the Actions tab, or by pushing a change under
`Probe/`. Then `git pull`.

## Layout

- `Probe/Cases/*.swift`: one `@State` usage pattern per file: plain values,
  init assignment, `_x = State(...)`, `@Observable` models, optionals,
  memberwise init, generics, `$` projection, access levels, observers,
  composition with other wrappers, `let`/local/static, `@Previewable`, and
  others. Each file is compiled separately, so a failing case doesn't hide
  the rest.
- `Probe/Runtime/LazyInitProbe.swift`: counts how often initial values run
  when a view is constructed outside a host, when its parent re-renders
  inside an `NSHostingView`, and when its identity changes.
- `Probe/PluginDirect/StateMacroDirect.swift`: binds a macro straight to the
  `SwiftUIMacros` plugin's `StateMacro` type, so the expansion shows up even
  where the SDK doesn't declare `macro State`.
- `Probe/run.sh <out>`: runs all of the above with the selected Xcode.
- `Xcode<N>/`: output for Xcode N.
  - `SUMMARY.md`: compile results per case and deployment target, plus the
    runtime counts.
  - `cases/<case>.macos<target>.txt`: `-dump-macro-expansions` output and
    diagnostics. Only macOS 14 (the first release the new behavior
    back-deploys to) is always written. Other targets are written only
    when their output differs.
  - `interface/`: the SDK's `SwiftUICore`/`SwiftUI` `.swiftinterface`, the
    `State` declarations extracted from it, and every line that mentions
    `State`.
  - `plugin/`: types and `State`-related symbols/strings from
    `libSwiftUIMacros.dylib`, and the plugin-direct expansion.

## Baseline: Xcode 26.6 (run locally, Intel)

`Xcode26/` is the property-wrapper baseline:

- Every case except `17_Let` compiles. `18_Previewable` fails on macOS 13,
  where `@Previewable` is unavailable.
- Runtime: every initial value runs on every struct init. That is 5 runs
  for 5 constructions outside a host, plus one per parent re-render.
- The SDK already has a hidden
  `State.init(wrappedValue thunk: @autoclosure @escaping () -> Value)`
  for `AnyObject & Observable` values, available from macOS 14/iOS 17.
- The 26.6 plugin already contains `StateMacro`, `StateProjectedValueMacro`
  and `StatePropertyWrapperStorageMacro`. Called directly, it expands
  `@State private var count = 0` to the code below. It does not compile
  against the 26.6 SDK, which has no `_makeStorage_v0`,
  `_StatePropertyWrapperStorage` or `_StateProjectedValue`:

  ```swift
  private let __count = SwiftUICore.State._makeStorage_v0({
      0
  })
  @SwiftUICore._StatePropertyWrapperStorage
  private var _count = SwiftUICore.State(initialValue: 0)
  @SwiftUICore._StateProjectedValue
  private var $count = SwiftUICore.State(initialValue: 0).projectedValue
  // accessors on `count`:
  get { __count.wrappedValue }
  nonmutating set { __count.wrappedValue = newValue }
  ```

  A property with no initial value instead gets
  `@storageRestrictions(initializes: _x) init(initialValue) { _x = State(initialValue: initialValue) }`.
  `Xcode27/` shows what actually shipped.
