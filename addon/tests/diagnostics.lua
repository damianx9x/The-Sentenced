local clock=10
GetTime=function() return clock end
GetBuildInfo=function() return '1.60.1','70862','x',16001 end
IsInGuild=function() return true end
GetNumGuildMembers=function() return 3,2 end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() return 0 end,SendAddonMessageLogged=function(prefix,msg,ch)
 sent[#sent+1]={prefix=prefix,payload=msg,channel=ch};return 0
end,AreOutgoingAddonChatMessagesRestricted=function() return false end}
local ns={};assert(loadfile('TheSentenced/Wire.lua'))('TheSentenced',ns);assert(loadfile('TheSentenced/Diagnostics.lua'))('TheSentenced',ns)
local d=ns.Diagnostics
d.init(function() return {['data.events']=1,['identity.resolved']=true} end,function() return 'Own Character' end)
d.send('TSGuildHall','B1|1|INNE|private-message-SECRET','GUILD')
assert(sent[#sent].payload:sub(1,3)=='~2~' and not sent[#sent].payload:find('|',1,true),'encoded wire has no pipe')
assert(ns.Wire.receive('scope','TSGuildHall','sender',sent[#sent].payload)=='B1|1|INNE|private-message-SECRET')
local beforeLimit=#sent
assert(not pcall(d.send,'TSGuildHall',string.rep('x',601),'GUILD') and #sent==beforeLimit,'oversize payload rejected before API')
d.rx('CHAT_MSG_ADDON_LOGGED','TSGuildHall','private-message-SECRET','GUILD','Other Character',true)
local originalAPI=C_ChatInfo.SendAddonMessageLogged
local calls=0; C_ChatInfo.SendAddonMessageLogged=function() calls=calls+1; return calls==2 and 3 or 0 end
assert(d.send('TSGuildHall',string.rep('x',450),'GUILD')==3 and calls==2,'multipart stops on first failed fragment')
C_ChatInfo.SendAddonMessageLogged=originalAPI
local ok=pcall(d.run,'ui.click',function() error('TheSentenced/Core.lua:42: nil value private-message-SECRET',0) end)
assert(not ok,'errors remain visible to the client')
local report=d.report()
assert(report:find('error.ui.click=1',1,true) and report:find('nil_value:line:42',1,true),'line and class captured')
assert(not report:find('private-message-SECRET',1,true) and not report:find('Other Character',1,true),'no payload or peer name leakage')
assert(report:find('api.SendAddonMessageLogged=true',1,true) and report:find('outgoing.restricted=false',1,true),'transport capability recorded')
assert(report:find('api.C_Calendar=false',1,true) and report:find('api.C_Calendar.AddEvent=false',1,true),'absent calendar is reported without failure')
local calendarCalls=0
local function calendarTrap() calendarCalls=calendarCalls+1;error('calendar API must not be called') end
C_Calendar={OpenCalendar=calendarTrap,CreateGuildSignUpEvent=calendarTrap,EventSetDate=calendarTrap,EventSetTime=calendarTrap,AddEvent=calendarTrap,GetDayEvent=calendarTrap,privateEvents='private-calendar-SECRET'}
report=d.report()
for _,name in ipairs({'OpenCalendar','CreateGuildSignUpEvent','EventSetDate','EventSetTime','AddEvent','GetDayEvent'}) do assert(report:find('api.C_Calendar.'..name..'=true',1,true),'calendar capability '..name) end
assert(calendarCalls==0 and not report:find('private-calendar-SECRET',1,true),'diagnostics never calls calendar or includes data')
C_Calendar=nil
assert(d.probe());local wire=sent[#sent].payload; assert(not wire:find('|',1,true),'wire has no separators'); local nonce=ns.Wire.receive('scope','TSGuildDiag','sender',wire):match('^D1|(%d+)|')
d.receiveProbe('D2|'..nonce..'|0.6.10','Other Character',true)
assert(d.report():find('probe.remote_reply=1',1,true),'remote acknowledgment counted')
assert(not d.probe(),'manual probe bounded')
local mark=d.mark;d.mark=function() error('metadata failed') end
assert(d.send('TSGuildHall','test','GUILD')==0,'metadata failure must not block original send')
d.mark=mark
local before=#sent
d.receiveProbe('D1|1|0.6.10','Own Character',true);assert(#sent==before,'own echo does not reply')
d.receiveProbe('D1|1|0.6.10','Intruder',false);assert(#sent==before,'nonmember does not trigger response')
for i=1,400 do d.mark('bounded',i) end
local n=0;for _ in d.report():gmatch('\n[%d%.]+ bounded ') do n=n+1 end
assert(n==100,'recent log bounded')
print('DIAGNOSTICS_OK: payload privacy, error lines, bounded log, accepted vs acknowledged send')
