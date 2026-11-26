local ns={};assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/GuildLinks.lua'))('TheSentenced',ns)
local L=ns.GuildLinks
local scope=215750322
local author='Łotrzyk Królewski'
local token=L.payload('B',author,'12345',scope)
local kind,name,id=L.parse(token,scope)
assert(kind=='B' and name==author and id=='12345','UTF-8 character names including spaces round trip')
assert(not L.parse(token,99) and not L.parse('E:'..scope..':6:123',scope) and not L.parse('E:'..scope..':0a:123',scope))
assert(not L.payload('E',author,'bad',scope))
local chat
ChatFrameUtil={OpenChat=function(text) chat=text end}
local nativeItem='|cffffffff|Hitem:123:0|h[Łup]|h|r'
C_Item={GetItemInfo=function(data)
 assert(data=='item:123:0')
 return 'Łup',nativeItem
end}
assert(L.prepare('B',author,'12345','Oddam {item:123:0}',scope))
assert(chat=='/g Oddam '..nativeItem and not chat:find('[TS:',1,true),'guild text includes native tooltip and no protocol marker')
assert(not L.echo('Oddam [Łup]',author,'Ja',scope),'another player cannot emit our draft')
assert(not L.echo('Inny szkic','Ja','Ja',scope),'edited draft never sends the wrong reference')
assert(L.echo('Oddam [Łup]','Ja','Ja',scope)=='L1|'..token,'metadata goes only after a matching confirmed guild message')
assert(not L.echo('Oddam [Łup]','Ja','Ja',scope),'echo is consumed once')
local handler
LinkUtil={RegisterLinkHandler=function(prefix,fn) assert(prefix=='tsguildhall');handler=fn end}
local clicked
assert(L.install(function() return scope end,function(...) clicked={...} end))
local display
DEFAULT_CHAT_FRAME={AddMessage=function(_,value) display=value end}
assert(L.show(token,author,scope) and display:find('|Htsguildhall:',1,true))
assert(not L.show(token,author,scope),'replayed metadata is deduplicated briefly')
assert(not L.show(token,'Inna gildia',99),'foreign guild link is never rendered')
handler(nil,nil,{options=token},{button='RightButton'});assert(not clicked)
handler(nil,nil,{options=token},{button='LeftButton'});assert(clicked[1]=='B' and clicked[2]==author and clicked[3]=='12345')
print('GUILD_LINKS_OK: native item tooltip, no public code, echo binding, guild scope and click')
