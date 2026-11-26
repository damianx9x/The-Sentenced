local timers,sent={},{}
local guild,time='g1',0
local rows={{key='event:1',owner='Me-Realm',payload='E1|1|4|sobota|Raid'},{key='other',owner='Inny-Realm',payload='E1|2|4|jutro|Obce'},{key='role:1',owner='Me-Realm',payload='R2|Inny-Realm|2|10|DPS'}}
C_Timer={After=function(delay,fn) timers[#timers+1]={delay=delay,fn=fn} end}
local ns={}; assert(loadfile('TheSentenced/EventSync.lua'))('TheSentenced',ns)
local s=ns.EventSync
s.init({scope=function()return guild end,selfName=function()return 'Me-Realm' end,snapshot=function()return rows end,now=function()return time end,send=function(x)sent[#sent+1]=x;return true end})
assert(s.request() and sent[1]=='Q1|1')
assert(not s.receiveQuery('Me-Realm'))
assert(s.receiveQuery('Kolega-Realm') and not s.receiveQuery('Inny-Realm'),'coalesce queries')
assert(timers[1].delay==5); table.remove(timers,1).fn()
assert(sent[2]==rows[1].payload,'only own event replayed')
rows[3].payload='R2|Inny-Realm|2|11|HEAL'
assert(timers[1].delay==2); table.remove(timers,1).fn(); assert(sent[3]==rows[3].payload,'send fresh own signup')
table.remove(timers,1).fn(); assert(not s.receiveQuery('Kolega-Realm'),'rate limit')
time=121; assert(s.receiveQuery('Kolega-Realm')); guild='g2';table.remove(timers,1).fn();assert(#sent==3,'guild scope fence')
local old={role='DPS',revision=10}; local value,status=s.mergeRole(old,'HEAL',9);assert(value==old and status=='stale')
value,status=s.mergeRole(old,'HEAL',10);assert(value==old and status=='conflict')
value,status=s.mergeRole(old,'HEAL',11);assert(value.role=='HEAL' and value.revision==11 and status=='accepted')
value,status=s.mergeRole(old,'DPS',10);assert(status=='duplicate')

-- Periodic startup is scheduled once; a new init invalidates old callbacks.
guild='g1'; timers={}; sent={}
s.init({scope=function()return guild end,selfName=function()return 'Me-Realm' end,snapshot=function()return rows end,now=function()return time end,send=function(x)sent[#sent+1]=x;return true end,jitter=function()return 3 end})
assert(s.start() and not s.start());assert(timers[1].delay==15);table.remove(timers,1).fn()
assert(sent[1]=='Q1|1' and timers[1].delay==300)
s.init({scope=function()return guild end});table.remove(timers,1).fn();assert(#sent==1,'old session timer ignored')
-- 12 per response, paced; subsequent responses rotate through large own snapshots.
guild='g1'; time=0; timers={}; sent={}; rows={}
for i=1,17 do rows[#rows+1]={key=string.format('E:%02d',i),owner='Me-Realm',payload='E1|'..i..'|4|sobota|Raid'} end
s.init({scope=function()return guild end,selfName=function()return 'Me-Realm' end,snapshot=function()return rows end,now=function()return time end,send=function(x)sent[#sent+1]=x;return true end})
assert(s.receiveQuery('A-Realm'))
while #timers>0 do table.remove(timers,1).fn() end
assert(#sent==12,'snapshot must not flood')
time=121;assert(s.receiveQuery('A-Realm'))
for i=1,5 do table.remove(timers,1).fn() end
assert(sent[13]=='E1|13|4|sobota|Raid' and sent[17]=='E1|17|4|sobota|Raid','rotation must reach later records')

print('EVENT_SYNC_OK: own records, limits, rotation, version fences and session cancellation')
