// `let` with @State: a property wrapper rejected it.
import SwiftUI

struct LetView: View {
    @State let constant = 0

    var body: some View {
        Text("\(constant)")
    }
}
