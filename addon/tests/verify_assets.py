from pathlib import Path
import ctypes, ctypes.util
import struct
from fontTools.ttLib import TTFont
root=Path('TheSentenced')
toc=(root/'TheSentenced.toc').read_text(encoding='utf-8')
assert '## Interface: 16001' in toc and '## Version: 0.6.40-alpha' in toc
entries=[line.strip() for line in toc.splitlines() if line.strip() and not line.startswith('#')]
assert 'Profiles.lua' in entries and 'Localization.lua' in entries
assert not {'Domain.lua', 'Transport.lua', 'Auction.lua'} & set(entries), 'DKP modules must not load'
for entry in entries:
    path=root/entry
    assert path.is_file() and path.parent==root, f'missing or invalid TOC path: {entry}'
for path in list(root.glob('*.lua'))+[root/'TheSentenced.toc']:
    raw=path.read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf'), f'BOM in {path}'
    assert '\ufffd' not in raw.decode('utf-8','strict'), f'replacement character in {path}'
font=TTFont(root/'Fonts'/'DejaVuSans.ttf')
cmap=font.getBestCmap()
characters='ąćęłńóśźżĄĆĘŁŃÓŚŹŻ•…×✓○→←'
assert all(ord(c) in cmap for c in characters), 'missing Polish or UI glyph'
assert (root/'Fonts'/'LICENCJA.txt').is_file()
texture = root/'Textures'/'SnakeBoard.tga'
raw = texture.read_bytes()
assert len(raw) >= 18
image_type, width, height, depth = raw[2], *struct.unpack_from('<HH', raw, 12), raw[16]
assert (image_type, width, height, depth) == (2, 512, 512, 24), 'invalid Snake board texture'
assert len(raw) >= 18 + width * height * (depth // 8), 'truncated Snake board texture'
crest=(root/'Textures'/'GuildCrest.tga').read_bytes()
assert (crest[2],*struct.unpack_from('<HH',crest,12),crest[16])==(2,256,256,32), 'invalid guild crest texture'
assert len(crest)>=18+256*256*4, 'truncated guild crest texture'
library=ctypes.util.find_library('lua5.4')
if not library:
    from lupa.lua54 import LuaRuntime
    lua=LuaRuntime(unpack_returned_tuples=True)
    for entry in entries:
        lua.execute('assert(loadfile(...))',str(root/entry))
    print('ASSETS_OK: TOC, Lua syntax, UTF-8, Polish glyphs, font license and textures')
    raise SystemExit(0)
lua=ctypes.CDLL(library)
lua.luaL_newstate.restype=ctypes.c_void_p
lua.luaL_loadfilex.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p]
lua.lua_tolstring.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.POINTER(ctypes.c_size_t)]
lua.lua_tolstring.restype=ctypes.c_char_p
lua.lua_settop.argtypes=[ctypes.c_void_p,ctypes.c_int]
lua.lua_close.argtypes=[ctypes.c_void_p]
state=lua.luaL_newstate()
for entry in entries:
    status=lua.luaL_loadfilex(state,str(root/entry).encode(),None)
    if status:
        raise RuntimeError(f'{entry}: {lua.lua_tolstring(state,-1,None).decode()}')
    lua.lua_settop(state,0)
lua.lua_close(state)
print('ASSETS_OK: TOC, Lua syntax, UTF-8 without BOM, Polish glyphs, font license')
