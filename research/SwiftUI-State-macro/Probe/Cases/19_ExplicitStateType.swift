// Using the State type directly, outside the attribute.
import SwiftUI

struct ExplicitView: View {
    private var count = State(initialValue: 0)
    private var other: State<String> = State(wrappedValue: "x")

    var body: some View {
        Text("\(count.wrappedValue) \(other.wrappedValue)")
    }
}

func makeState() -> State<Int> {
    State(initialValue: 1)
}
