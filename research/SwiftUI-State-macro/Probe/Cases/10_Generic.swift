// Generic views and type inference from the initial value.
import SwiftUI

struct ListView<Item: Hashable>: View {
    @State private var items: [Item] = []
    @State private var selected: Item?

    var body: some View {
        Text("\(items.count) \(selected.map { "\($0)" } ?? "")")
    }
}

func makeDefault<T: Hashable>() -> [T] { [] }

struct InferredView: View {
    @State private var ints = [1, 2, 3]
    @State private var double = 1.0
    @State private var dict = ["a": 1]
    @State private var range = 0..<10
    @State private var explicitGeneric: [String] = makeDefault()

    var body: some View {
        Text("\(ints.count) \(double) \(dict.count) \(range.count) \(explicitGeneric.count)")
    }
}
