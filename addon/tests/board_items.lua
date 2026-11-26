local ns={}; assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
local B=ns.BoardItems
local link='|cffa335ee|Hitem:18832:0:0:0:-7:42|h[Brutality Blade]|h|r'
local encoded=B.encode('Sprzedam '..link..' za 10g')
assert(encoded=='Sprzedam {item:18832:0:0:0:-7:42} za 10g',encoded)
assert(not encoded:find('|',1,true))
local links=B.links(encoded); assert(#links==1 and links[1]=='item:18832:0:0:0:-7:42')
assert(B.encode('x|n|Hspell:123|h[bad]|h')=='x n Hspell:123 h[bad] h')
assert(#B.links('{item:0} {item:999999999999} {item:123:evil}')==0)
assert(B.label(encoded):find('Przedmiot 18832',1,true))
assert(B.encode('  Zażółć gęślą jaźń  ')=='Zażółć gęślą jaźń')
assert(B.encode('Łup\1z\127torby')=='Łup z torby')
print('board_items: PASS')
