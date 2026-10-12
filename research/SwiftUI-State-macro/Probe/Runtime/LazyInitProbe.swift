// Counts how often @State initial values are evaluated, outside a host and
// inside an NSHostingView whose parent re-renders.
import AppKit
import Observation
import SwiftUI

@MainActor
enum Counters {
    static var classDeclInits = 0
    static var classInitAssignInits = 0
    static var structDeclInits = 0
    static var childBodies = 0
    static var parentBodies = 0

    static func line(_ label: String) -> String {
        "\(label): classDecl=\(classDeclInits) classInitAssign=\(classInitAssignInits) "
            + "structDecl=\(structDeclInits) childBodies=\(childBodies) parentBodies=\(parentBodies)"
    }
}

@Observable
final class DeclModel {
    var n = 0
    init() { MainActor.assumeIsolated { Counters.classDeclInits += 1 } }
}

@Observable
final class InitAssignModel {
    var n = 0
    init() { MainActor.assumeIsolated { Counters.classInitAssignInits += 1 } }
}

struct Payload {
    var n: Int
}

@MainActor
func makePayload() -> Payload {
    Counters.structDeclInits += 1
    return Payload(n: 0)
}

struct Child: View {
    @State private var declModel = DeclModel()
    @State private var initAssignModel: InitAssignModel
    @State private var payload = makePayload()
    let tick: Int

    init(tick: Int) {
        self.tick = tick
        self.initAssignModel = InitAssignModel()
    }

    var body: some View {
        Counters.childBodies += 1
        return Text("\(tick) \(declModel.n) \(initAssignModel.n) \(payload.n)")
    }
}

@Observable
final class Driver {
    var tick = 0
    var identity = 0
}

struct Parent: View {
    let driver: Driver

    var body: some View {
        Counters.parentBodies += 1
        return Child(tick: driver.tick)
            .id(driver.identity)
    }
}

@MainActor
func pump(_ host: NSView) {
    host.needsLayout = true
    host.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.2))
    host.layoutSubtreeIfNeeded()
}

@main
struct LazyInitProbe {
    @MainActor
    static func main() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
            print("TIMEOUT")
            exit(2)
        }

        print(Counters.line("start"))

        for tick in 0..<5 {
            _ = Child(tick: tick)
        }
        print(Counters.line("after constructing Child 5x outside a host"))

        _ = NSApplication.shared
        let driver = Driver()
        let host = NSHostingView(rootView: Parent(driver: driver))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.contentView = host
        pump(host)
        print(Counters.line("after hosting"))

        for _ in 0..<5 {
            driver.tick += 1
            pump(host)
        }
        print(Counters.line("after 5 parent re-renders (same identity)"))

        driver.identity += 1
        pump(host)
        print(Counters.line("after identity change"))

        exit(0)
    }
}
