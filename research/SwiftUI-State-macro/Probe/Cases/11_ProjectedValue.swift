// $-projection: bindings handed to children and to built-in controls.
import SwiftUI

struct Child: View {
    @Binding var value: Double

    var body: some View {
        Slider(value: $value)
    }
}

struct Parent: View {
    @State private var value = 0.5
    @State private var text = ""
    @State private var isOn = false

    var body: some View {
        VStack {
            Child(value: $value)
            TextField("text", text: $text)
            Toggle("on", isOn: $isOn)
            Text("\(_value.wrappedValue)")
        }
    }
}
