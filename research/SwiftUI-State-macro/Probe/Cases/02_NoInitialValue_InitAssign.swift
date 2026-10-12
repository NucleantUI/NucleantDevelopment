// No initial value at the declaration; init assigns through the property.
import SwiftUI

struct Counter: View {
    @State private var count: Int
    let title: String

    init(title: String, start: Int) {
        self.title = title
        self.count = start
    }

    var body: some View {
        Button("\(title) \(count)") { count += 1 }
    }
}
