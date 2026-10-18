#!/usr/bin/env python3
"""Build the single-file CodingHost page from src/.

Inlines every local stylesheet and script that src/html/codinghost.html
references, so the result can be published as one claude.ai artifact.
Remote URLs (CDN scripts, Google Fonts) are left as they are.

Usage: python3 build.py [--out app/codinghost.html]
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = ROOT / "src" / "html" / "codinghost.html"
DEFAULT_OUT = ROOT / "app" / "codinghost.html"

STYLESHEET = re.compile(r'<link rel="stylesheet" href="(?P<href>[^"]+)">\n')
SCRIPT = re.compile(r"<script(?P<attrs>[^>]*?) src=\"(?P<src>[^\"]+)\"(?P<rest>[^>]*)></script>\n")


def is_local(url):
    return not re.match(r"^(https?:)?//", url)


def read_source(base, rel, closing_tag):
    """Read a file referenced from the page, relative to the page's folder.

    Args:
        base: folder of the HTML page.
        rel: the href/src value from the tag.
        closing_tag: "</script" or "</style". The file must not contain it,
            because the browser would end the inline element there.
    """
    path = (base / rel).resolve()
    text = path.read_text(encoding="utf-8")
    if closing_tag in text.lower():
        sys.exit(f"build.py: {path.relative_to(ROOT)} contains {closing_tag!r}, which would end the inline tag early")
    return text if text.endswith("\n") else text + "\n"


def build(page):
    base = page.parent
    html = page.read_text(encoding="utf-8")

    def inline_style(m):
        if not is_local(m["href"]):
            return m[0]
        return "<style>\n" + read_source(base, m["href"], "</style") + "</style>\n"

    html = STYLESHEET.sub(inline_style, html)

    # data-bundle scripts share one IIFE: the files declare top-level consts and
    # functions that call each other, and must not leak them onto window.
    bundle = []

    def inline_script(m):
        if not is_local(m["src"]):
            return m[0]
        attrs = (m["attrs"] + m["rest"]).replace(" data-bundle", "")
        if " data-bundle" in m["attrs"] + m["rest"]:
            first = not bundle
            bundle.append(f"// --- {m['src'].removeprefix('../')} ---\n" + read_source(base, m["src"], "</script"))
            return "<!--bundle-->" if first else ""
        return f"<script{attrs}>\n" + read_source(base, m["src"], "</script") + "</script>\n"

    html = SCRIPT.sub(inline_script, html)
    if bundle:
        html = html.replace(
            "<!--bundle-->",
            '<script>\n(function () {\n"use strict";\n\n' + "\n".join(bundle) + "})();\n</script>\n",
        )
    return html


def main():
    parser = argparse.ArgumentParser(description=str(__doc__).splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output file (default: app/codinghost.html)")
    args = parser.parse_args()

    html = build(PAGE)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html.encode()) // 1024} KB)")


if __name__ == "__main__":
    main()
