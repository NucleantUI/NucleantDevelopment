// Optionals: implicit nil, explicit nil, and an optional class.
import SwiftUI
import Observation

@available(macOS 14.0, iOS 17.0, *)
@Observable
final class Detail {
    var name = ""
}

@available(macOS 14.0, iOS 17.0, *)
struct SelectionView: View {
    @State private var selection: String?
    @State private var explicitNil: Int? = nil
    @State private var detail: Detail?

    var body: some View {
        Text(selection ?? "\(explicitNil ?? 0) \(detail?.name ?? "")")
    }
}
