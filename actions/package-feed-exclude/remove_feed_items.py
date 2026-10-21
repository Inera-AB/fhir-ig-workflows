"""Remove an IG's packages from a package feed.

IG Publisher adds every published package to the web root's package feed,
and the FHIR package registry (packages.fhir.org) picks up everything in a
registered feed. An IG that is published on the web site but should not be
in the package registry (a template or a demo IG) has its items removed
again with this script. Sub-packages (<package-id>.<name>) go too.

Only the matching <item> elements are removed; the rest of the file is left
exactly as the publisher wrote it.

Usage: remove_feed_items.py <package-feed.xml> <package-id>
"""
import re
import sys


def remove_items(feed_xml, package_id):
    pattern = re.compile(
        r"\s*<item>(?:(?!</item>).)*?<title>"
        + re.escape(package_id)
        + r"(?:\.[^#<]*)?#[^<]*</title>.*?</item>",
        re.DOTALL,
    )
    return pattern.subn("", feed_xml)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    path, package_id = sys.argv[1:]
    with open(path, encoding="utf-8", newline="") as f:
        text, count = remove_items(f.read(), package_id)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"Removed {count} item(s) for {package_id} from {path}")
