local timers,sent={},{}
local clock=0; local scope='guild-1'; local result=0; local attempts=0
local db={profileShare={E=true}}
GetTime=function() return clock end
GetServerTime=function() return 1794000000 end
GetInventoryItemID=function(_,slot) if slot==1 then return 42 end end
C_Timer={After=function(delay,fn) timers[#timers+1]={at=clock+delay,fn=fn} end}
C_ChatInfo={RegisterAddonMessagePrefix=function() return 0 end,
 AreOutgoingAddonChatMessagesRestricted=function() return true end,
 SendAddonMessageLogged=function(_,msg,channel)
  assert(channel=='GUILD'); attempts=attempts+1
  if result==0 then sent[#sent+1]=msg end
  return result
 end}
local ns={};assert(loadfile('TheSentenced/Profiles.lua'))('TheSentenced',ns)
local P=ns.Profiles;P.init({db=function() return db end,scope=function() return scope end,me=function() return 'Me' end,member=function(n) return n end})
local function advance(endTime)
 local steps=0
 while true do table.sort(timers,function(a,b) return a.at<b.at end);if #timers==0 or timers[1].at>endTime then break end
  local t=table.remove(timers,1);clock=t.at;t.fn();steps=steps+1;assert(steps<1000,'unbounded polling') end
 clock=endTime
end
assert(P.publish());advance(5)
assert(#sent==1 and sent[1]:match('^P1|E|'),'logged send must use API result even if flag is true')
assert(P.status():find('Doręczenie nie jest potwierdzone',1,true),'API acceptance must not imply peer delivery')
result=1; assert(P.publish());advance(10)
assert(#sent==1 and attempts==4,'API failure must be retried only within bound')
assert(P.status():find('Nie udało się wysłać',1,true))
result=0;assert(P.startAuto());advance(50)
local query=false;for _,msg in ipairs(sent) do if msg=='Q1|1' then query=true end end
assert(query,'automatic query should reach logged API when flag is true')
result=1;advance(350)
assert(P.status():find('nie przyjęła pytania',1,true),'automatic query rejection should be visible')
print('PROFILE_RESTRICTION_OK: logged API result, bounded errors, automatic query')
