// @State on a static property.
import SwiftUI

struct StaticView: View {
    @State static var shared = 0

    var body: some View {
        Text("\(Self.shared)")
    }
}
