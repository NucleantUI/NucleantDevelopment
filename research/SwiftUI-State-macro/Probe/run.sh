#!/bin/bash
# Compiles every case in Cases/ with the selected Xcode, dumping the macro
# expansions and diagnostics, runs the runtime probe, and copies the parts of
# the SDK that define @State. Everything lands in the output directory.
#
#   Probe/run.sh <output-dir>
set -uo pipefail

OUT="${1:?usage: run.sh <output-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ARCH="$(uname -m)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
DEV="$(xcode-select -p)"
HOST_OS="$(sw_vers -productVersion | cut -d. -f1).0"
# 13.0: before the iOS 17-aligned releases the new behavior back-deploys to.
# 14.0: the first aligned release. HOST_OS: the macOS the probe runs on.
TARGETS=(13.0 14.0 "$HOST_OS")
PRIMARY=14.0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

rm -rf "$OUT/cases" "$OUT/interface" "$OUT/runtime" "$OUT/plugin"
mkdir -p "$OUT/cases" "$OUT/interface" "$OUT/runtime" "$OUT/plugin"

{
    xcodebuild -version
    echo
    xcrun swiftc --version 2>&1
    echo
    sw_vers
    echo "arch: $ARCH"
    echo "developer dir: $DEV"
    echo "sdk: $SDK"
} > "$OUT/ENVIRONMENT.txt"

# Paths in compiler output point into this checkout or the temp dir; make
# them relative so reruns diff cleanly.
normalize() {
    sed -e "s#$HERE/##g" -e "s#$WORK/##g" -e "s#$SDK#\$SDK#g" -e "s#$DEV#\$DEVELOPER_DIR#g"
}

# --- Cases -----------------------------------------------------------------

summary="$OUT/SUMMARY.md"
{
    echo "# @State probe summary"
    echo
    echo "$(xcodebuild -version | head -1), $ARCH, macOS $(sw_vers -productVersion)."
    echo "Each case is compiled on its own with \`-dump-macro-expansions\`."
    echo "Full output: \`cases/<case>.macos<target>.txt\`. Targets other than"
    echo "macOS $PRIMARY are only written when their output differs from it."
    echo
    printf '| Case |'
    for t in "${TARGETS[@]}"; do printf ' macOS %s |' "$t"; done
    printf ' First diagnostic (macOS %s) |\n|---|' "$PRIMARY"
    for _ in "${TARGETS[@]}"; do printf -- '---|'; done
    printf -- '---|\n'
} > "$summary"

for src in "$HERE"/Cases/*.swift; do
    name="$(basename "$src" .swift)"
    row="| $name |"
    for t in "${TARGETS[@]}"; do
        raw="$WORK/$name.$t.txt"
        xcrun swiftc -c -parse-as-library -module-name Probe \
            -sdk "$SDK" -target "$ARCH-apple-macos$t" \
            -Xfrontend -dump-macro-expansions \
            "$src" -o "$WORK/$name.$t.o" > "$raw" 2>&1
        status=$?
        { echo "// $name, target $ARCH-apple-macos$t, exit $status"; echo; normalize < "$raw"; } > "$WORK/$name.$t.out"
        if [ $status -eq 0 ]; then row="$row ✅ |"; else row="$row ❌ |"; fi
    done
    first="$(grep -m1 -E 'error:|warning:' "$WORK/$name.$PRIMARY.out" | normalize | sed 's/|/\\|/g')"
    echo "$row ${first:-} |" >> "$summary"

    cp "$WORK/$name.$PRIMARY.out" "$OUT/cases/$name.macos$PRIMARY.txt"
    for t in "${TARGETS[@]}"; do
        [ "$t" = "$PRIMARY" ] && continue
        if ! diff -q <(tail -n +2 "$WORK/$name.$t.out") <(tail -n +2 "$WORK/$name.$PRIMARY.out") > /dev/null; then
            cp "$WORK/$name.$t.out" "$OUT/cases/$name.macos$t.txt"
        fi
    done
done

# --- Runtime ---------------------------------------------------------------

echo >> "$summary"
echo "## Runtime probe (\`Runtime/LazyInitProbe.swift\`)" >> "$summary"
for t in 14.0 "$HOST_OS"; do
    out="$OUT/runtime/LazyInitProbe.macos$t.txt"
    exe="$WORK/LazyInitProbe.$t"
    {
        echo "// target $ARCH-apple-macos$t"
        echo
        if xcrun swiftc -parse-as-library -sdk "$SDK" -target "$ARCH-apple-macos$t" \
            "$HERE/Runtime/LazyInitProbe.swift" -o "$exe" 2>&1; then
            "$exe" 2>&1
            echo "exit $?"
        else
            echo "compile failed"
        fi
    } 2>&1 | normalize > "$out"
    { echo; echo "macOS $t target:"; echo '```'; tail -n +3 "$out"; echo '```'; } >> "$summary"
done

# --- SDK interface ---------------------------------------------------------

for module in SwiftUICore SwiftUI; do
    src="$SDK/System/Library/Frameworks/$module.framework/Modules/$module.swiftmodule"
    file="$(ls "$src"/*-apple-macos.swiftinterface | grep -E "/${ARCH}e?-apple-macos" | head -1)"
    cp "$file" "$OUT/interface/$module.swiftinterface"
done
python3 "$HERE/extract_decls.py" "$OUT/interface/SwiftUICore.swiftinterface" \
    '^(?!\s).*\b(struct|class|enum|protocol|extension|typealias|macro|func)\s+(SwiftUICore\.)?_*State\b' \
    > "$OUT/interface/State.swiftinterface"
# Every non-comment line that names State, to find helper types by any name.
grep -nE '\bState\b|State<|_State|StateStorage' "$OUT/interface/SwiftUICore.swiftinterface" \
    | grep -vE '^[0-9]+:\s*//' > "$OUT/interface/State-mentions.txt"

# --- Macro plugin ----------------------------------------------------------

plugin="$DEV/Platforms/MacOSX.platform/Developer/usr/lib/swift/host/plugins/libSwiftUIMacros.dylib"
if [ -f "$plugin" ]; then
    nm -gU "$plugin" | awk '{print $3}' | xcrun swift-demangle --compact | sort -u > "$WORK/symbols.txt"
    grep -oE 'SwiftUIMacros\.[A-Za-z_][A-Za-z0-9_]*' "$WORK/symbols.txt" | sort -u > "$OUT/plugin/types.txt"
    grep -iE 'state' "$WORK/symbols.txt" > "$OUT/plugin/state-symbols.txt"
    strings -a "$plugin" | grep -iE 'state|storageRestrictions|initialValue|wrappedValue' | sort -u > "$OUT/plugin/state-strings.txt"

    # The plugin's StateMacro through our own declaration: shows its output
    # even when the SDK has no `macro State` (and no runtime for it).
    for t in 13.0 14.0; do
        {
            echo "// PluginDirect/StateMacroDirect.swift, target $ARCH-apple-macos$t"
            echo
            xcrun swiftc -typecheck -parse-as-library -sdk "$SDK" -target "$ARCH-apple-macos$t" \
                -Xfrontend -dump-macro-expansions "$HERE/PluginDirect/StateMacroDirect.swift" 2>&1
            echo "exit $?"
        } | normalize > "$OUT/plugin/direct-expansion.macos$t.txt"
    done
else
    echo "no plugin at $plugin" > "$OUT/plugin/types.txt"
fi

echo "wrote $OUT"
