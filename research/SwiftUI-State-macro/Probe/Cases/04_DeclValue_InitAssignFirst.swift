// Reported to stop compiling: declaration value, then assigned in init
// before the other stored properties are set.
import SwiftUI

struct Page {
    var title: String
}

struct PageView: View {
    @State private var page = Page(title: "")
    let title: String

    init(title: String) {
        self.page = Page(title: title)
        self.title = title
    }

    var body: some View {
        Text(page.title)
    }
}
