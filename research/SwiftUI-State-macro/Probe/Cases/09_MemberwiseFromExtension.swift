// Reported to stop compiling: an extension init delegating to the
// synthesized memberwise init.
import SwiftUI

struct Page {
    var title: String
}

struct PageView: View {
    @State private var page: Page
    private let title: String

    var body: some View {
        Text(page.title + title)
    }
}

extension PageView {
    init(title: String, _ page: Page) {
        self.init(page: page, title: title)
    }
}
