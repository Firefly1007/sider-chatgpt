"""Package the loadable extension and public source without local diagnostics."""
import argparse
from pathlib import Path
import hashlib
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output-dir", type=Path, default=root / "artifacts")
outputs = parser.parse_args().output_dir.resolve()
target = outputs / "Sider-ChatGPT"
assert target.resolve().parent == outputs and target.name == "Sider-ChatGPT"
if not (root / "dist" / "manifest.json").is_file():
    raise SystemExit("Run npm run build before packaging.")
outputs.mkdir(parents=True, exist_ok=True)
if target.exists():
    shutil.rmtree(target)
shutil.copytree(root / "dist", target)
shutil.copy2(root / "README.md", target / "使用说明.md")


def archive(path, files, base):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        for file in sorted(files):
            if file.is_file():
                package.write(file, file.relative_to(base))
    return hashlib.sha256(path.read_bytes()).hexdigest()


release = outputs / "Sider-ChatGPT-可加载包.zip"
source = outputs / "Sider-ChatGPT-源码.zip"
hashes = [(release.name, archive(release, target.rglob("*"), target.parent))]
files = [root / name for name in [".gitignore", "package.json", "package-lock.json", "README.md"]]
for folder in ["src", "public", "tests"]:
    files.extend((root / folder).rglob("*"))
files.extend(root / "scripts" / name for name in ["build.mjs", "check.mjs", "icons.mjs", "package.py"])
files.extend(root / "docs" / name for name in ["index.html", "site.css", "privacy/index.html", ".nojekyll"])
hashes.append((source.name, archive(source, files, root)))
(outputs / "Sider-ChatGPT-SHA256.txt").write_text("\n".join(f"{digest}  {name}" for name, digest in hashes) + "\n", encoding="utf-8")
print(f"Loadable: {target}")
for name, digest in hashes:
    print(f"{name}: {digest}")
