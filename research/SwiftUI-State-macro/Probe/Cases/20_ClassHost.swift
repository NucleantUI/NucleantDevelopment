// @State on a class property and on a non-View struct.
import SwiftUI

final class NotAView {
    @State var count = 0
}

struct PlainStruct {
    @State var count = 0
}
