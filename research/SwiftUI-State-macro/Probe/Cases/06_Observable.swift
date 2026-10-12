// The case the macro exists for: an @Observable class as the initial value.
import SwiftUI
import Observation

@available(macOS 14.0, iOS 17.0, *)
@Observable
final class CounterModel {
    var count = 0
    init() {}
    init(start: Int) { count = start }
}

@available(macOS 14.0, iOS 17.0, *)
struct CounterView: View {
    @State private var model = CounterModel()

    var body: some View {
        Button("\(model.count)") { model.count += 1 }
    }
}

@available(macOS 14.0, iOS 17.0, *)
struct CounterViewFromInit: View {
    @State private var model: CounterModel

    init(start: Int) {
        model = CounterModel(start: start)
    }

    var body: some View {
        Button("\(model.count)") { model.count += 1 }
    }
}

@available(macOS 14.0, iOS 17.0, *)
struct CounterViewBindable: View {
    @State private var model = CounterModel()

    var body: some View {
        @Bindable var model = model
        Stepper("\(model.count)", value: $model.count)
    }
}
