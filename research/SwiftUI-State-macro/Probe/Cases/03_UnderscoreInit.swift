// The pre-macro idiom: init assigns the backing storage directly.
import SwiftUI

struct Counter: View {
    @State private var count = 0
    let title: String

    init(title: String, start: Int) {
        self.title = title
        self._count = State(initialValue: start)
    }

    var body: some View {
        Button("\(title) \(count)") { count += 1 }
    }
}

struct CounterWrappedValue: View {
    @State private var count: Int

    init(start: Int) {
        _count = State(wrappedValue: start)
    }

    var body: some View {
        Button("\(count)") { count += 1 }
    }
}
