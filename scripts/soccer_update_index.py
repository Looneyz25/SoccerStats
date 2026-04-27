#!/usr/bin/env python3
"""Splice match_data.json into index.html as DATA_SOCCER. Brace-aware so the JSON
content can never accidentally close the regex early. Verifies the file's closing
tags are intact before writing — refuses to corrupt the file.

Usage: python3 scripts/soccer_update_index.py
"""
import json, pathlib, sys

FOLDER = pathlib.Path(__file__).resolve().parent.parent
STORE = FOLDER / "match_data.json"
INDEX = FOLDER / "index.html"


def splice_data_soccer(html: str, new_blob: str) -> str:
    """Replace `const DATA_SOCCER = {...};` with new_blob (which must include the
    full assignment). Walks braces while string-aware, so a `};` inside a JSON
    string value can never short-circuit the match."""
    marker = "const DATA_SOCCER = "
    start = html.find(marker)
    if start == -1:
        raise ValueError("DATA_SOCCER assignment not found in index.html")
    open_brace = html.find("{", start)
    if open_brace == -1:
        raise ValueError("opening brace for DATA_SOCCER not found")
    depth = 0
    i = open_brace
    in_str = False
    esc = False
    while i < len(html):
        c = html[i]
        if esc:
            esc = False
        elif c == "\\":
            esc = True
        elif c == '"':
            in_str = not in_str
        elif not in_str:
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    j = i + 1
                    while j < len(html) and html[j] in " \t\n":
                        j += 1
                    if j < len(html) and html[j] == ";":
                        return html[:start] + new_blob + html[j + 1:]
                    raise ValueError("no `;` after DATA_SOCCER closing brace")
        i += 1
    raise ValueError("unbalanced braces inside DATA_SOCCER literal")


def main():
    if not STORE.exists():
        print("match_data.json not found", file=sys.stderr)
        sys.exit(1)
    if not INDEX.exists():
        print("index.html not found", file=sys.stderr)
        sys.exit(1)

    store = json.loads(STORE.read_text(encoding="utf-8"))
    html = INDEX.read_text(encoding="utf-8")

    # Sanity check the input file FIRST — refuse to splice into a broken file
    for tag in ("</script>", "</body>", "</html>"):
        if tag not in html:
            print(f"ERROR: input index.html missing {tag} — refusing to write", file=sys.stderr)
            sys.exit(2)

    new_blob = "const DATA_SOCCER = " + json.dumps(store, ensure_ascii=False) + ";"
    new_html = splice_data_soccer(html, new_blob)

    # Verify result still has all closing tags
    for tag in ("</script>", "</body>", "</html>"):
        if tag not in new_html:
            print(f"ERROR: new index.html missing {tag} — NOT writing", file=sys.stderr)
            sys.exit(3)

    INDEX.write_text(new_html, encoding="utf-8")
    matches = sum(len(L["matches"]) for L in store["leagues"])
    print(f"index.html updated: {len(store['leagues'])} leagues, {matches} matches.")


if __name__ == "__main__":
    main()
