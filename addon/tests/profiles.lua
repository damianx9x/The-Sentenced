local network,timers,clients={},{},{}
local clock=100
local allowed={['Author-Realm']=true,['Viewer-Realm']=true}
local function client(name)
 local env=setmetatable({},{__index=_G}); local db={}; local c={name=name,db=db,guild='Guild@Realm',sent={},reads=0}
 env.GetServerTime=function() return 1794000000+math.floor(clock) end
 env.C_Timer={After=function(delay,fn) timers[#timers+1]={t=clock+delay,fn=fn} end}
 env.C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessageLogged=function(p,m,channel)
  c.sent[#c.sent+1]=m; network[#network+1]={sender=name..'-Realm',msg=m}; return 0
 end}
 env.GetMoney=function() c.reads=c.reads+1; return 1234567 end
 env.UnitStat=function(_,i) return i*10,i*10+1 end
 env.UnitHealthMax=function() return 1234 end
 env.GetInventoryItemID=function(_,slot) if slot==1 then return 19019 elseif slot==16 then return 42 end end
 env.NUM_BAG_SLOTS=1
 env.C_Container={GetContainerNumSlots=function(bag) return bag==0 and 2 or 1 end,
  GetContainerItemInfo=function(bag,slot) if bag==0 and slot==1 then return {itemID=123,stackCount=4} elseif bag==0 then return {itemID=123,stackCount=3} else return {itemID=456,stackCount=2} end end}
 env.GetProfessions=function() return 1,2 end
 env.GetProfessionInfo=function(i) if i==1 then return 'Zioła',nil,100,300 else return 'Alchemia',nil,50,300 end end
 local ns={}; assert(loadfile('TheSentenced/Profiles.lua','t',env))('TheSentenced',ns)
 ns.Profiles.init({db=function() return db end,scope=function() return c.guild end,member=function(n) if allowed[n] then return n end end,me=function() return name..'-Realm' end})
 c.p=ns.Profiles; clients[#clients+1]=c; return c
end
local function drain(drop)
 local loops=0
 while #network>0 or #timers>0 do
  loops=loops+1; assert(loops<2000,'profile loop')
  while #network>0 do local m=table.remove(network,1); for _,c in ipairs(clients) do if not drop or not drop(m,c) then c.p.receive(m.msg,m.sender) end end end
  if #timers>0 then table.sort(timers,function(a,b) return a.t<b.t end);local t=table.remove(timers,1);clock=t.t;t.fn() end
 end
end
local author=client('Author'); local viewer=client('Viewer')
assert(not author.p.enabled('A'),'main character sharing must default off')
assert(not author.p.setMain('Intruder-Realm'),'main must be in guild roster')
assert(author.p.setMain('Viewer-Realm'))
assert(not author.p.enabled('A') and #author.sent==0,'saving a declaration must not share it')
for _,cat in ipairs({'S','G','B','E','P'}) do assert(not author.p.enabled(cat),'sharing must default off') end
assert(not author.p.publish() and #author.sent==0 and author.reads==0,'no automatic capture or send')
for _,cat in ipairs({'S','G','B','E','P'}) do assert(author.p.toggle(cat)) end
assert(#author.sent==0 and author.reads==0,'enabling alone must not publish')
assert(author.p.publish()); drain()
local r=viewer.p.get('Author-Realm')
assert(r and r.G.copper==1234567 and r.S.values[1]==11 and r.S.values[6]==1234,'gold or stats wrong')
assert(#r.B.items==2 and r.B.items[1].id==123 and r.B.items[1].count==7,'bag aggregation wrong')
assert(#r.E.items==2 and r.E.items[2].slot==16 and r.P.professions[1]:find('Zioła',1,true),'equipment or UTF-8 profession wrong')
assert(not r.A,'main is private before explicit opt-in')
assert(author.p.toggle('A')); assert(author.p.publish()); drain()
assert(r.A and r.A.main=='Viewer-Realm','shared main declaration was not received')
assert(author.p.setMain('')); drain()
assert(not r.A and r.A_revoked and not author.p.enabled('A'),'clearing the declaration must revoke sharing')
viewer.p.receive('P1|G|99999999999999|1|1|999','Intruder-Realm')
assert(r.G.copper==1234567,'outsider should not write profile')
local old=r.versions.G
assert(not author.p.toggle('G')); drain()
assert(not r.G and r.G_revoked,'revocation should remove the shared view for online recipients')
viewer.p.receive('P1|G|'..old..'|1|1|1234567','Author-Realm')
assert(not r.G,'stale replay resurrected revoked gold')
local priorCount=#author.sent
assert(author.p.publish()); drain()
for i=priorCount+1,#author.sent do assert(not author.sent[i]:find('P1|G|',1,true),'disabled gold was transmitted') end
local previous=r.B.items[1].id
local nextVersion=(r.versions.B or 0)+100000
viewer.p.receive('P1|B|'..nextVersion..'|1|2|999:','Author-Realm')
assert(r.B.items[1].id==previous,'partial snapshot replaced completed bag data')
viewer.p.receive('P0|B|'..(nextVersion+1),'Author-Realm')
viewer.p.receive('P1|B|'..nextVersion..'|2|2|1','Author-Realm')
assert(not r.B,'an old fragment must not override revocation')
local fresh=nextVersion+2
viewer.p.receive('P1|B|'..fresh..'|2|2|7,456:2','Author-Realm')
viewer.p.receive('P1|B|'..fresh..'|1|2|123:','Author-Realm')
assert(r.B and r.B.items[1].id==123 and r.B.items[1].count==7 and r.B.items[2].id==456,'reordered fragments must assemble exactly')
viewer.p.receive('P0|B|'..(fresh+1),'Viewer-Realm')
assert(r.B,'one member must not revoke another member profile')
viewer.p.receive('P1|S|99999999999998|1|1|1,2,3','Author-Realm')
assert(r.S.values[1]==11,'invalid stats were accepted')
-- Queued state cannot leak to a different guild after a roster change.
clock=clock+10; author.p.publish(); local before=#author.sent; author.guild='Other@Realm'; drain()
assert(#author.sent==before,'queued profile data leaked to another guild')
local early=client('Author')
early.p.toggle('S'); early.p.toggle('G')
assert(early.p.publish()); assert(#early.sent==1,'first queued section should begin')
early.p.toggle('G'); drain()
for _,msg in ipairs(early.sent) do assert(not msg:find('P1|G|',1,true),'turning sharing off must cancel unsent gold') end
print('PROFILES_OK: opt-in, no silent reads, selective publish, UTF-8, bags, revoke, replay, partial, guild boundary')
