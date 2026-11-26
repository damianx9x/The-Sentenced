local ns={}; assert(loadfile('TheSentenced/Wire.lua'))('TheSentenced',ns); local w=ns.Wire
local s=string.rep('Zażółć|',50); local f=assert(w.encode(s));assert(#f>1 and #f<=4)
for _,v in ipairs(f) do assert(#v<=255 and not v:find('|',1,true)) end
assert(w.receive('guild','prefix','sender',f[2],1)==nil)
assert(w.receive('guild','prefix','sender',f[2],2)==nil)
assert(w.receive('guild','prefix','sender',f[1],2)==nil)
local result
for i=3,#f do result=w.receive('guild','prefix','sender',f[i],3) end
assert(result==s,'reorder, duplicate and UTF-8')
local q=w.encode(string.rep('a',250));assert(not w.receive('guild','prefix','sender',q[1],10));assert(not w.receive('guild','prefix','sender',q[2],41),'lost fragment expires')
assert(w.receive('guild','prefix','sender','B2|old||empty',50)=='B2|old||empty','legacy unchanged')
assert(w.receive('guild','prefix','sender','~1~B2|1|2',50)=='B2|1|2','legacy v1 already unescaped by server')
assert(not w.encode(string.rep('x',601)) and not w.receive('guild','prefix','sender','~2~1-1~1~5~YWJj',50))
local z=w.encode(string.rep('b',200));assert(not w.receive('guild','prefix','sender',z[1],51));assert(not w.receive('other','prefix','sender',z[2],52),'guild scope reset')
print('WIRE_OK')
