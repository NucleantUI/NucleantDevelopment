// didSet / willSet on a @State property.
import SwiftUI

struct ObservedView: View {
    @State private var count = 0 {
        didSet { print("didSet", oldValue, count) }
        willSet { print("willSet", newValue) }
    }

    var body: some View {
        Button("\(count)") { count += 1 }
    }
}
