// @State on a local variable in a function.
import SwiftUI

func local() -> Int {
    @State var count = 0
    count += 1
    return count
}
