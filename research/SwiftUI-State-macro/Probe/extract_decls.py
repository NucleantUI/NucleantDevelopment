#!/usr/bin/env python3
"""Print the top-level declarations of a .swiftinterface whose header matches
a regex, with their attributes and bodies.

    extract_decls.py <interface> <regex>
"""
import re
import sys

ATTRIBUTE_ONLY = re.compile(r"^\s*(@[\w.]+(\(.*\))?\s*)+$")
DIRECTIVE = re.compile(r"^\s*#(if|elseif|else|endif)\b")


def chunks(lines):
    current = []
    depth = 0
    for line in lines:
        if depth == 0 and not current and DIRECTIVE.match(line):
            yield [line]
            continue
        current.append(line)
        code = re.sub(r'"(\\.|[^"\\])*"', '""', line.split("//", 1)[0])
        depth += code.count("{") + code.count("(") + code.count("[")
        depth -= code.count("}") + code.count(")") + code.count("]")
        if depth <= 0 and not ATTRIBUTE_ONLY.match(line) and line.strip():
            depth = 0
            yield current
            current = []
    if current:
        yield current


def header(chunk):
    for line in chunk:
        if line.strip() and not ATTRIBUTE_ONLY.match(line):
            return line
    return ""


def main():
    path, pattern = sys.argv[1], re.compile(sys.argv[2])
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    for chunk in chunks(lines):
        if pattern.search(header(chunk)):
            print("\n".join(chunk).strip("\n"))
            print()


if __name__ == "__main__":
    main()
