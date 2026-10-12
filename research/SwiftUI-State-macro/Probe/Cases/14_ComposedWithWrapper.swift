// Reported unsupported: composing @State with another property wrapper.
import SwiftUI

@propertyWrapper
struct Clamped {
    var value: Int
    var wrappedValue: Int {
        get { value }
        set { value = min(max(newValue, 0), 10) }
    }
    init(wrappedValue: Int) { value = wrappedValue }
}

struct ComposedView: View {
    @State @Clamped private var value = 5

    var body: some View {
        Text("\(value)")
    }
}
