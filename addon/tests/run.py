import ctypes, ctypes.util, os, sys
lib=ctypes.CDLL(ctypes.util.find_library('lua5.4'))
Lptr=ctypes.c_void_p
lib.luaL_newstate.restype=Lptr
lib.luaL_openlibs.argtypes=[Lptr]
lib.luaL_loadfilex.argtypes=[Lptr,ctypes.c_char_p,ctypes.c_char_p]
lib.lua_pcallk.argtypes=[Lptr,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_longlong,Lptr]
lib.lua_tolstring.argtypes=[Lptr,ctypes.c_int,ctypes.POINTER(ctypes.c_size_t)]
lib.lua_tolstring.restype=ctypes.c_char_p
lib.lua_close.argtypes=[Lptr]
L=lib.luaL_newstate(); lib.luaL_openlibs(L)
rc=lib.luaL_loadfilex(L,(sys.argv[1] if len(sys.argv)>1 else 'tests/mock.lua').encode(),None)
if not rc: rc=lib.lua_pcallk(L,0,-1,0,0,None)
if rc:
 print(lib.lua_tolstring(L,-1,None).decode()); raise SystemExit(rc)
lib.lua_close(L)
