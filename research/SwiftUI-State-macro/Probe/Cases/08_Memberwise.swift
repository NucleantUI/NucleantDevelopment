// Synthesized memberwise init with @State properties.
import SwiftUI

struct Row: View {
    @State var count = 0
    @State var label: String
    let title: String

    var body: some View {
        Text("\(title) \(label) \(count)")
    }
}

func makeRows() -> [Row] {
    [
        Row(label: "a", title: "t"),
        Row(count: 3, label: "b", title: "t"),
    ]
}
