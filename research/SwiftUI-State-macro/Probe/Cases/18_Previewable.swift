// @Previewable @State inside #Preview.
import SwiftUI

struct Bound: View {
    @Binding var value: Int

    var body: some View {
        Stepper("\(value)", value: $value)
    }
}

#Preview {
    @Previewable @State var value = 3
    Bound(value: $value)
}
