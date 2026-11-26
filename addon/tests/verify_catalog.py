"""Verify that shipped Lua choices match the canonical Forever evidence catalog."""
import json
import re
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[1]
source = (here.parent / "TheSentenced" / "InstancePicker.lua").read_text(encoding="utf-8")
catalog = json.loads((root / "data" / "forever-catalog.json").read_text(encoding="utf-8"))
normalize = lambda value: value.casefold()
lua_names = {normalize(name) for name in re.findall(r"name\s*=\s*\'([^\']+)\'", source)}
json_names = {normalize(row["name"]) for row in catalog["dungeons"]}
if lua_names != json_names:
    raise SystemExit(f"Catalog mismatch: only Lua={sorted(lua_names-json_names)}; only JSON={sorted(json_names-lua_names)}")
lua_levels = {
    normalize(name): (int(minimum), int(maximum))
    for name, minimum, maximum in re.findall(
        r"name\s*=\s*'([^']+)'\s*,\s*min\s*=\s*(\d+)\s*,\s*max\s*=\s*(\d+)", source
    )
}
json_levels = {
    normalize(row["name"]): (row["min_level"], row["max_level"])
    for row in catalog["dungeons"] if "min_level" in row and "max_level" in row
}
if lua_levels != json_levels:
    raise SystemExit(f"Level mismatch: Lua={lua_levels}; JSON={json_levels}")
print(f"CATALOG_OK: {len(lua_names)} verified-source choices; list is not asserted complete")
