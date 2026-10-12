// Declares a macro bound straight to the SwiftUIMacros plugin's StateMacro,
// so the expansion can be seen even where the SDK doesn't declare
// `macro State` itself (Xcode 26 already ships the plugin type). The
// declaration mirrors the one reported for Xcode 27's SDK.
import SwiftUI
import Observation

@attached(accessor, names: named(init), named(get), named(set))
@attached(peer, names: prefixed(_), prefixed(__), prefixed(`$`))
macro DirectState() = #externalMacro(module: "SwiftUIMacros", type: "StateMacro")

@available(macOS 14.0, iOS 17.0, *)
@Observable
final class Model {
    var n = 0
}

@available(macOS 14.0, iOS 17.0, *)
struct DirectView: View {
    @DirectState private var count = 0
    @DirectState private var noValue: String
    @DirectState private var optional: Int?
    @DirectState private var model = Model()
    @DirectState public var publicValue = 1

    init() {
        noValue = ""
    }

    var body: some View {
        Text("\(count) \(noValue) \(optional ?? 0) \(model.n) \(publicValue)")
    }
}
