// @State inside a custom DynamicProperty struct (not a View).
import SwiftUI

struct Toggled: DynamicProperty {
    @State private var isOn = false

    var value: Bool { isOn }
    func toggle() { isOn.toggle() }
}

struct UsesToggled: View {
    var toggled = Toggled()

    var body: some View {
        Button(toggled.value ? "on" : "off") { toggled.toggle() }
    }
}
