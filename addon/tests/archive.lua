local network,timers,clients={},{},{}
local clock=10
local members={['Keeper-Realm']=true,['Reader-Realm']=true,['Third-Realm']=true,['Author-Realm']=true}
local function client(name)
  local env=setmetatable({},{__index=_G})
  local db={records={}}
  local c={name=name,db=db,guild='guild-1',sent={}}
  env.GetTime=function() return clock end
  env.GetServerTime=function() return 1794000000 end
  env.C_Timer={After=function(delay,fn) timers[#timers+1]={t=clock+delay,fn=fn} end}
  env.C_ChatInfo={RegisterAddonMessagePrefix=function() return 0 end,
    AreOutgoingAddonChatMessagesRestricted=function() return true end,
    SendAddonMessageLogged=function(prefix,msg,channel)
      assert(#msg<=230,'oversize archive packet')
      if c.fail then return 1 end
      c.sent[#c.sent+1]=msg
      network[#network+1]={prefix=prefix,msg=msg,channel=channel,sender=name..'-Realm'}
      return 0
    end}
  local ns={}; assert(loadfile('TheSentenced/Archive.lua','t',env))('TheSentenced',ns)
  ns.Archive.init({scope=function() return c.guild end,store=function() return db end,
    selfName=function() return name..'-Realm' end,
    member=function(value)
      if members[value] then return value end
      if members[value..'-Realm'] then return value..'-Realm' end
    end})
  c.a=ns.Archive; clients[#clients+1]=c; return c
end
local function drain(drop)
  local loops=0
  while #network>0 or #timers>0 do
    loops=loops+1; assert(loops<4000,'archive network did not terminate')
    while #network>0 do
      local message=table.remove(network,1)
      for _,c in ipairs(clients) do
        if not drop or not drop(message,c) then c.a.event(message.prefix,message.msg,message.channel,message.sender) end
      end
    end
    if #timers>0 then table.sort(timers,function(a,b) return a.t<b.t end); local t=table.remove(timers,1); clock=t.t; t.fn() end
  end
end
local keeper=client('Keeper'); local reader=client('Reader'); local third=client('Third')
third.fail=true
assert(not third.a.request('Keeper'),'logged API rejection must not create a pending request')
third.fail=false
local text='B1|111|GRUPA|'..string.rep('ą',51)..' koniec'
keeper.a.recordDirect('TSGuildHall',text,'Author-Realm')
keeper.a.recordDirect('TSGuildEvent','E1|222|4|sobota 20:00|'..string.rep('ł',50),'Author-Realm')
keeper.a.recordDirect('TSGuildFinds','M2|333|12|5000|6000|5|skarb','Author-Realm')
keeper.a.recordDirect('TSGuildDKP2','L1|FAKE|1','Author-Realm')
assert(#keeper.db.records==3,'DKP must never enter archive')
keeper.a.recordDirect('TSGuildHall',text,'Author-Realm'); assert(#keeper.db.records==3,'direct replay duplicated archive')
-- Original author is offline; keeper alone has the earlier records.
assert(reader.a.request('Keeper'))
local request=network[1].msg:match('^R|(%d+)|')
reader.a.event('TSGuildArc','D|'..request..'|1|1|1|F|Author-Realm|G1|1|999','GUILD','Intruder-Realm')
assert(#reader.db.records==0,'outsider injected archive content')
drain(function(m,c) return c==reader and m.sender=='Keeper-Realm' and m.msg:match('^D|%d+|2|2|')~=nil end)
assert(#reader.db.records==2,'missing fragment must not become a record')
assert(reader.a.status():find('2 z 3',1,true),'missing record should be visible')
for _,r in ipairs(reader.db.records) do assert(r.direct==false and r.via=='Keeper-Realm' and r.origin=='Author-Realm','copy mislabeled as verified') end
reader.a.cancel(); clock=clock+61
assert(reader.a.request('Keeper')); drain()
assert(#reader.db.records==3 and reader.a.status():find('3 z 3',1,true),'manual retry should fill archive gap')
local saved
for _,r in ipairs(reader.db.records) do if r.tag=='B' then saved=r.payload end end
assert(saved==text,'UTF-8 fragmentation changed bytes')
-- Reader can pass the copy onward, although the author and keeper are unavailable.
keeper.guild='offline'
assert(third.a.request('Reader')); drain()
assert(#third.db.records==3,'multi-hop relay did not preserve records')
for _,r in ipairs(third.db.records) do assert(not r.direct and r.via=='Reader-Realm','forwarded origin wrongly trusted') end
-- A direct observation upgrades precisely the identical record, not other claims.
third.a.recordDirect('TSGuildHall',text,'Author-Realm')
local verified=0; for _,r in ipairs(third.db.records) do if r.direct then verified=verified+1 end end
assert(verified==1,'direct observation should upgrade only identical content')
-- Guild scope changes stop the sender queue; they never ship to a new guild.
clock=clock+61
third.a.cancel(); assert(third.a.request('Reader'))
while #network>0 do
 local message=table.remove(network,1)
 for _,c in ipairs(clients) do c.a.event(message.prefix,message.msg,message.channel,message.sender) end
 if message.msg:match('^R|') then break end
end
local sentBefore=#reader.sent
reader.guild='another-guild'; drain()
assert(#reader.sent==sentBefore,'queued records leaked after guild switch')
for i=1,160 do keeper.a.recordDirect('TSGuildFinds','G1|'..i..'|123','Author-Realm') end
assert(#keeper.db.records==150,'retention must be bounded')
print('ARCHIVE_OK: offline author, multi-hop copies, loss and retry, UTF-8, outsider, guild boundary, no DKP')
