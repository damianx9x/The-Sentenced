local network,timers,clients={}, {}, {}
local clock=100
local allowed={['Author-Realm']=true,['Viewer-Realm']=true}
local function client(name,share)
 local env=setmetatable({},{__index=_G}); local db={profileShare=share or {}}; local c={name=name,db=db,guild='Guild@Realm',sent={},reads=0}
 env.GetTime=function() return clock end
 env.GetServerTime=function() return 1794000000+math.floor(clock) end
 env.math=setmetatable({random=function() return 0 end},{__index=math})
 env.C_Timer={After=function(delay,fn) timers[#timers+1]={t=clock+delay,fn=fn} end}
 env.C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessageLogged=function(prefix,msg,channel)
  c.sent[#c.sent+1]=msg;network[#network+1]={sender=name..'-Realm',msg=msg};return 0
 end}
 env.GetInventoryItemID=function(_,slot) if slot==1 then return 42 end end
 env.GetMoney=function() c.reads=c.reads+1;return 123456 end
 local ns={};assert(loadfile('TheSentenced/Profiles.lua','t',env))('TheSentenced',ns)
 ns.Profiles.init({db=function() return db end,scope=function() return c.guild end,member=function(n) if allowed[n] then return n end end,me=function() return name..'-Realm' end})
 c.p=ns.Profiles;clients[#clients+1]=c;return c
end
local function advance(endTime)
 local loops=0
 while true do
  while #network>0 do
   local m=table.remove(network,1)
   for _,c in ipairs(clients) do c.p.receive(m.msg,m.sender) end
  end
  table.sort(timers,function(a,b) return a.t<b.t end)
  if #timers==0 or timers[1].t>endTime then break end
  local timer=table.remove(timers,1);clock=timer.t;timer.fn();loops=loops+1;assert(loops<500,'unbounded timers')
 end
 clock=endTime
end
local author=client('Author',{E=true});assert(author.p.startAuto());assert(not author.p.startAuto(),'one automatic loop only')
advance(150)
local viewer=client('Viewer');assert(viewer.p.startAuto());advance(220)
local record=viewer.p.get('Author-Realm')
assert(record and record.E and record.E.items[1].id==42,'late peer should automatically receive explicitly shared equipment')
assert(author.reads==0,'disabled gold must never be read')
for _,msg in ipairs(author.sent) do assert(not msg:match('^P1|G|'),'disabled gold must never be sent') end
assert(not author.p.toggle('E'));advance(235)
assert(not record.E and record.E_revoked,'revocation received automatically')
local n=#author.sent;author.p.changedLocal('PLAYER_EQUIPMENT_CHANGED');advance(260)
for i=n+1,#author.sent do assert(not author.sent[i]:match('^P1|E|'),'revoked equipment cannot be re-published') end
-- Changing guild invalidates callbacks from the old one and starts a fresh short startup cycle.
author.p.toggle('E'); author.guild='New@Realm'; local before=#author.sent
assert(author.p.guildChanged()); advance(275)
local fresh=false; for i=before+1,#author.sent do if author.sent[i]:match('^P1|E|') then fresh=true end end
assert(fresh,'guild change must reschedule enabled snapshots promptly')
local delayed=client('Author',{E=true}); delayed.guild=nil; assert(delayed.p.startAuto()); advance(285)
local start=#delayed.sent; delayed.guild='Guild@Realm'; assert(delayed.p.guildChanged()); advance(299)
local sentAfterRoster=false; for i=start+1,#delayed.sent do if delayed.sent[i]:match('^P1|E|') then sentAfterRoster=true end end
assert(sentAfterRoster,'late guild availability must start synchronization without five minute wait')
local hidden=client('Author',{});assert(hidden.p.startAuto());advance(320)
assert(hidden.reads==0,'empty opt-in must not read gold')
print('PROFILES_AUTO_OK: late join, explicit opt-in, no hidden gold reads, revoke, bounded startup')
