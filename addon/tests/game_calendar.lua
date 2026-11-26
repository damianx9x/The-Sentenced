local ns={};assert(loadfile('TheSentenced/GameCalendar.lua'))('TheSentenced',ns)
assert(ns.GameCalendar.events()==nil,'unavailable API must not be reported as empty')
local opened=0;C_Calendar={OpenCalendar=function()opened=opened+1 end,GetNumGuildEvents=function()return 3 end,GetGuildEventInfo=function(i)
 if i==1 then return {title='Raid',year=2027,month=1,monthDay=2,hour=20,minute=5} end
 if i==2 then return {title='Meeting',year=2026,month=12,monthDay=1,hour=9,minute=0} end
 return {title='bad',year=2027,month=13,monthDay=5,hour=1,minute=1}
end}
assert(ns.GameCalendar.refresh() and opened==1)
local events,status=ns.GameCalendar.events();assert(#events==2 and status=='partial');assert(events[1].title=='Meeting' and events[2].when=='2027-01-02 20:05')
C_Calendar.GetNumGuildEvents=function()return 0 end;events,status=ns.GameCalendar.events();assert(#events==0 and status=='ok')
C_Calendar.GetNumGuildEvents=function()error('restricted')end;assert(ns.GameCalendar.events()==nil)
print('GAME_CALENDAR_OK: read-only guild entries, order, validation and unavailable API')
local M=ns.GameCalendar
assert(M.polishEpoch('2026-03-29 01:59 PL')==1774745940)
assert(not M.polishEpoch('2026-03-29 02:15 PL') and not M.polishEpoch('2026-10-25 02:15 PL'))
assert(M.polishEpoch('2026-03-29 03:00 PL')==1774746000)
assert(not M.polishEpoch('2027-02-29 20:00 PL'))
local listener
CreateFrame=function()
 listener={RegisterEvent=function(_,name) assert(name=='CALENDAR_NEW_EVENT') end,SetScript=function(self,_,f) self.handler=f end}
 return listener
end
GetServerTime=function() return 1770000000 end
C_DateAndTime={GetCalendarTimeFromEpoch=function(epoch)
 assert(epoch==1774746000); return {year=2026,month=3,monthDay=29,hour=3,minute=0}
end}
local log={}
local function add(k,...) log[#log+1]={k,...} end
local timeout
C_Timer={After=function(seconds,fn) assert(seconds==15);timeout=fn end}
C_Calendar={
 GetEventInfo=function() end,IsActionPending=function() return false end,
 CreatePlayerEvent=function() add('create') end, EventSetTitle=function(...) add('title',...) end,
 EventSetDate=function(...) add('date',...) end, EventSetTime=function(...) add('time',...) end,
 EventSetDescription=function(...) add('description',...) end, EventInvite=function(...) add('invite',...) end,
 CloseEvent=function() add('close') end, CanAddEvent=function() return true end, AddEvent=function() add('commit') end,
}
local event={title='Wyprawa',when='2026-03-29 03:00 PL'}
local outcome
assert(M.publish(event,{'Test-Realm'},function(saved) outcome=saved end))
assert(outcome==nil and log[6][1]=='invite' and log[6][2]=='Test-Realm' and log[7][1]=='commit')
assert(not M.publish(event,{},function() end),'duplicate in-flight publish is blocked')
listener.handler(listener,'CALENDAR_NEW_EVENT',true); assert(outcome==nil,'calendar copy is not our receipt')
listener.handler(listener,'CALENDAR_NEW_EVENT',false); assert(outcome==true,'new calendar event confirms the request')
timeout()
C_Calendar.GetEventInfo=function() return {} end
assert(not M.publish(event,{},function() end) and #log==7,'current edit protects an open calendar draft')
C_Calendar.GetEventInfo=function() end
C_Calendar.CanAddEvent=function() return false end
assert(not M.publish(event,{},function() end) and log[#log][1]=='close','clean up rejected new drafts')
print('GAME_CALENDAR_WRITE_OK: Warsaw DST, invite list, pending response, duplicate and draft safety')
