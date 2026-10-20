"""Copy the history template's styles and scripts into an IG folder.

IG Publisher copies them (as listed in the template's manifest.ini) only on
an IG's first publication. An IG that moves over to the publication mode with
an existing history would otherwise get an unstyled history.html. Same rules
as the publisher: entries marked overwrite are always copied, the rest only
if missing. index.html is left out: the IG root page comes from the milestone
build, and the template's placeholder page is only filled in on a first
publication.

Usage: copy_history_assets.py <history-template-dir> <ig-folder>
"""
import configparser
import os
import shutil
import sys


def copy_assets(src, dst):
    ini = configparser.ConfigParser()
    ini.optionxform = str
    if not ini.read(os.path.join(src, "manifest.ini")):
        sys.exit(f"No manifest.ini in {src}")
    os.makedirs(dst, exist_ok=True)
    copied = []
    for name, mode in ini["files"].items():
        if name == "index.html":
            continue
        s, d = os.path.join(src, name), os.path.join(dst, name)
        if mode == "overwrite" or not os.path.exists(d):
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
            copied.append(name)
    return copied


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    for name in copy_assets(sys.argv[1], sys.argv[2]):
        print(f"copied {name}")
