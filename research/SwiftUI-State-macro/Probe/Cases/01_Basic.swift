// The plain case: a value with an initial value at the declaration.
import SwiftUI

struct Counter: View {
    @State private var count = 0

    var body: some View {
        Button("\(count)") { count += 1 }
    }
}
