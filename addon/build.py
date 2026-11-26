"""Package the playable addon from its TOC and bundled assets."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

SOURCE = Path(__file__).resolve().parent / "TheSentenced"
COMPANION_STUB = (
    b"-- The Sentenced owner event projection v1\n"
    b"local _,NS=...\n"
    b"NS.CompanionSnapshot={schema=1,generatedAt=0,raids={},expeditions={}}\n"
)


def build(destination):
    toc = SOURCE / "TheSentenced.toc"
    playable = [line.strip() for line in toc.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.startswith("#")]
    if (SOURCE / "CompanionSnapshot.lua").read_bytes() != COMPANION_STUB:
        raise ValueError("The live companion snapshot must stay local")

    files = [toc, *(SOURCE / name for name in playable)]
    for directory in ("Fonts", "Textures"):
        files.extend(path for path in (SOURCE / directory).iterdir() if not path.name.startswith("."))
    destination.parent.mkdir(parents=True, exist_ok=True)
    for path in files:
        if path.is_symlink() or not path.is_file() or path.parent not in (SOURCE, SOURCE / "Fonts", SOURCE / "Textures"):
            raise ValueError(f"Unexpected addon member: {path.name}")
    with ZipFile(destination, "w", ZIP_DEFLATED) as package:
        for path in sorted(files):
            member = ZipInfo(f"{SOURCE.name}/{path.relative_to(SOURCE).as_posix()}")
            member.compress_type = ZIP_DEFLATED
            member.external_attr = 0o644 << 16
            package.writestr(member, path.read_bytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    build(parser.parse_args().destination)
