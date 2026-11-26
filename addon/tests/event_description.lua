local ns={}; local t,guild=0,'guild-a'; local timers,sent={},{}
C_Timer={After=function(delay,fn) timers[#timers+1]={delay=delay,fn=fn} end}
assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/EventSync.lua'))('TheSentenced',ns)
local s=ns.EventSync
local rows={}
s.init({scope=function() return guild end,now=function() return t end,selfName=function() return 'Autor-Realm' end,
 snapshot=function() return rows end,send=function(x) sent[#sent+1]=x; return true end})
local packet,body=s.encodeDescription('123','Łup |cffa335ee|Hitem:19019:0:0|h[Przedmiot]|h|r')
assert(body=='Łup {item:19019:0:0}' and packet=='D1|123|'..body)
local id,decoded=s.parseDescription(packet); assert(id=='123' and decoded==body)
assert(not s.encodeDescription('123',string.rep('ą',81)),'must reject oversized UTF-8, never truncate')
for _,invalid in ipairs({'D1|1|a|b','D1||tekst','D1|1|a'..string.char(0),'D1|1|'..string.rep('a',161)}) do assert(not s.parseDescription(invalid)) end
assert(s.holdDescription('Autor-Realm',packet))
assert(not s.takeDescription('Inny-Realm','123'),'sender must be bound to original event')
assert(s.takeDescription('Autor-Realm','123')==body)
assert(s.holdDescription('Autor-Realm',packet));t=121;assert(not s.takeDescription('Autor-Realm','123'),'expired packet')
t=200;assert(s.holdDescription('Autor-Realm',packet));guild='guild-b';assert(not s.takeDescription('Autor-Realm','123'),'guild scope fence')
guild='guild-a';t=300
for i=1,41 do assert(s.holdDescription('Autor-Realm','D1|'..i..'|opis'));t=t+1 end
assert(not s.takeDescription('Autor-Realm','1') and s.takeDescription('Autor-Realm','41')=='opis','bounded buffer')
rows={{key='E:1',owner='Autor-Realm',payload='E1|123|1|20:00|Wyprawa'},{key='E:2',owner='Autor-Realm',payload=packet},
 {key='E:3',owner='Inny-Realm',payload='D1|2|nie moje'}}
assert(s.receiveQuery('Kolega-Realm'));while #timers>0 do table.remove(timers,1).fn() end
assert(#sent==2 and sent[1]==rows[1].payload and sent[2]==packet,'replay only own E1/D1')
print('EVENT_DESCRIPTION_OK: safe item tokens, bounds, scope, TTL, owner and replay')
