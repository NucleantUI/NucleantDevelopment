// Initial values that are not trivial expressions: static calls,
// closures, references to statics, side effects.
import SwiftUI

enum Defaults {
    static var made = 0
    static func make() -> [String] {
        made += 1
        return ["x"]
    }
}

struct ComplexView: View {
    static let seed = 42

    @State private var fromStatic = Defaults.make()
    @State private var fromClosure: Int = {
        var x = 0
        for i in 0..<10 { x += i }
        return x
    }()
    @State private var fromSelfType = ComplexView.seed
    @State private var callback: () -> Void = {}

    var body: some View {
        Text("\(fromStatic.count) \(fromClosure) \(fromSelfType)")
            .onTapGesture { callback() }
    }
}
