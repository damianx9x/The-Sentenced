local timers,sent={},{}
local current='guild-A'
C_Timer={After=function(delay,fn) timers[#timers+1]={delay=delay,fn=fn} end}
local ns={}
assert(loadfile('TheSentenced/EventSync.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/EventRetry.lua'))('TheSentenced',ns)
ns.EventRetry.init({scope=function() return current end,send=function(msg) sent[#sent+1]=msg end})
local payload='E1|123|4|sobota 20:00|Wyprawa'
assert(ns.EventRetry.enqueue(payload,current)); assert(ns.EventRetry.enqueue(payload,current))
assert(ns.EventRetry.pending()==1 and #timers==1 and #sent==0,'duplicate queue sends nothing early')
local first=table.remove(timers,1); assert(first.delay==5); first.fn(); assert(#sent==1 and sent[1]==payload)
local second=table.remove(timers,1); assert(second.delay==12); second.fn(); assert(#sent==2 and ns.EventRetry.pending()==0)
assert(not ns.EventRetry.enqueue('R1|Other|123|DPS',current),'never retransmit another event type')
assert(ns.EventRetry.enqueue(payload,current)); current='guild-B'; table.remove(timers,1).fn()
assert(#sent==2 and ns.EventRetry.pending()==0,'no leak across guild changes')
current='guild-A'; C_Timer=nil; assert(not ns.EventRetry.enqueue(payload,current),'missing timer fails closed')
print('EVENT_RETRY_OK: bounded two retries, scope fence, dedupe and no false ack')
C_Timer={After=function(delay,fn) timers[#timers+1]={delay=delay,fn=fn} end}
ns.EventRetry.init({scope=function() return current end,send=function() error('transport error') end})
for i=1,8 do assert(ns.EventRetry.enqueue('E1|'..i..'|4|sobota|Wyprawa',current)) end
assert(not ns.EventRetry.enqueue('E1|99|4|sobota|Wyprawa',current),'queue must stay bounded')
local nextTimer=table.remove(timers,1); nextTimer.fn()
assert(ns.EventRetry.pending()==8,'transient failure must not corrupt queue')
current='guild-B'; table.remove(timers,1).fn(); assert(ns.EventRetry.pending()==0,'queued work must not cross guild boundary')
timers={}; sent={}; current='guild-A'
ns.EventRetry.init({scope=function() return current end,send=function(msg) sent[#sent+1]=msg end})
local description='D1|123|Spotkanie {item:123}'
assert(not ns.EventRetry.enqueue(description,current),'description must reference an accepted event')
assert(not ns.EventRetry.enqueue(description,current,'E1|124|4|sobota|Wyprawa'),'description must reference the same event id')
assert(not ns.EventRetry.enqueue('D1|123|bad|separator',current,payload),'invalid descriptions are rejected')
assert(ns.EventRetry.enqueue(description,current,payload),'description is queued after event acceptance even if first send failed')
assert(ns.EventRetry.enqueue(description,current,payload) and ns.EventRetry.pending()==1,'duplicate descriptions are deduplicated')
table.remove(timers,1).fn(); table.remove(timers,1).fn()
assert(#sent==2 and sent[1]==description and sent[2]==description and ns.EventRetry.pending()==0,'description retries are bounded')
assert(ns.EventRetry.enqueue(description,current,payload)); current='guild-B'; table.remove(timers,1).fn()
assert(#sent==2 and ns.EventRetry.pending()==0,'description never crosses guild boundary')
print('EVENT_DESCRIPTION_RETRY_OK: accepted event binding, bounded retry, dedupe, guild boundary')
