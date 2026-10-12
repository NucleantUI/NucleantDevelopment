// Same as 04, but the @State assignment comes after every other stored
// property is initialized.
import SwiftUI

struct Page {
    var title: String
}

struct PageView: View {
    @State private var page = Page(title: "")
    let title: String

    init(title: String) {
        self.title = title
        self.page = Page(title: title)
    }

    var body: some View {
        Text(page.title)
    }
}
