# @State probe summary

Xcode 27.0, arm64, macOS 27.0.1.
Each case is compiled on its own with `-dump-macro-expansions`.
Full output: `cases/<case>.macos<target>.txt`. Targets other than
macOS 14.0 are only written when their output differs from it.

| Case | macOS 13.0 | macOS 14.0 | macOS 27.0 | First diagnostic (macOS 14.0) |
|---|---|---|---|---|
| 01_Basic | ✅ | ✅ | ✅ |  |
| 02_NoInitialValue_InitAssign | ✅ | ✅ | ✅ |  |
| 03_UnderscoreInit | ✅ | ✅ | ✅ |  |
| 04_DeclValue_InitAssignFirst | ❌ | ❌ | ❌ | Cases/04_DeclValue_InitAssignFirst.swift:14:9: error: variable 'self.title' used before being initialized |
| 05_DeclValue_InitAssignLast | ✅ | ✅ | ✅ |  |
| 06_Observable | ✅ | ✅ | ✅ |  |
| 07_Optional | ✅ | ✅ | ✅ |  |
| 08_Memberwise | ✅ | ✅ | ✅ |  |
| 09_MemberwiseFromExtension | ✅ | ✅ | ✅ |  |
| 10_Generic | ✅ | ✅ | ✅ |  |
| 11_ProjectedValue | ✅ | ✅ | ✅ |  |
| 12_AccessLevels | ✅ | ✅ | ✅ |  |
| 13_ComplexInitialValue | ✅ | ✅ | ✅ |  |
| 14_ComposedWithWrapper | ❌ | ❌ | ❌ | Cases/14_ComposedWithWrapper.swift:15:12: error: property wrapper cannot be applied to a computed property |
| 15_CustomDynamicProperty | ✅ | ✅ | ✅ |  |
| 16_Observers | ✅ | ✅ | ✅ |  |
| 17_Let | ❌ | ❌ | ❌ | Cases/17_Let.swift:5:5: error: '@State' can only be applied to a 'var' declaration (from macro 'State ') |
| 18_Previewable | ❌ | ✅ | ✅ |  |
| 19_ExplicitStateType | ✅ | ✅ | ✅ |  |
| 20_ClassHost | ✅ | ✅ | ✅ |  |
| 21_ManyProperties | ✅ | ✅ | ✅ |  |
| 22_LocalVariable | ✅ | ✅ | ✅ |  |
| 23_Static | ✅ | ✅ | ✅ |  |

## Runtime probe (`Runtime/LazyInitProbe.swift`)

macOS 14.0 target:
```
start: classDecl=0 classInitAssign=0 structDecl=0 childBodies=0 parentBodies=0
after constructing Child 5x outside a host: classDecl=0 classInitAssign=5 structDecl=0 childBodies=0 parentBodies=0
after hosting: classDecl=1 classInitAssign=6 structDecl=1 childBodies=1 parentBodies=1
after 5 parent re-renders (same identity): classDecl=1 classInitAssign=11 structDecl=1 childBodies=6 parentBodies=6
after identity change: classDecl=2 classInitAssign=12 structDecl=2 childBodies=7 parentBodies=7
exit 0
```

macOS 27.0 target:
```
start: classDecl=0 classInitAssign=0 structDecl=0 childBodies=0 parentBodies=0
after constructing Child 5x outside a host: classDecl=0 classInitAssign=5 structDecl=0 childBodies=0 parentBodies=0
after hosting: classDecl=1 classInitAssign=6 structDecl=1 childBodies=1 parentBodies=1
after 5 parent re-renders (same identity): classDecl=1 classInitAssign=11 structDecl=1 childBodies=6 parentBodies=6
after identity change: classDecl=2 classInitAssign=12 structDecl=2 childBodies=7 parentBodies=7
exit 0
```
