// Access levels on the declaration and how they carry to the peers.
import SwiftUI

public struct AccessView: View {
    @State public var publicValue = 0
    @State var internalValue = 0
    @State fileprivate var fileprivateValue = 0
    @State private var privateValue = 0
    @State private(set) var privateSetValue = 0

    public init() {}

    public var body: some View {
        Text("\(publicValue) \(internalValue) \(fileprivateValue) \(privateValue) \(privateSetValue)")
    }
}
