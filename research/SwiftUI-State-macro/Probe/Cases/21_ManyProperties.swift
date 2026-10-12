// Several @State properties next to plain stored properties, with an
// explicit init that sets them in mixed order.
import SwiftUI
import Observation

@available(macOS 14.0, iOS 17.0, *)
@Observable
final class Session {
    var name: String
    init(name: String) { self.name = name }
}

@available(macOS 14.0, iOS 17.0, *)
struct Editor: View {
    let id: Int
    @State private var session: Session
    @State private var draft = ""
    var tint: Double
    @State private var history: [String] = []

    init(id: Int, name: String, tint: Double = 1) {
        self.id = id
        self.session = Session(name: name)
        self.tint = tint
        self.history = [name]
    }

    var body: some View {
        Text("\(id) \(session.name) \(draft) \(tint) \(history.count)")
    }
}
