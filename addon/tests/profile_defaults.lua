local timers,sent={},{}
local reads=0
local clock=0
local store={}
GetTime=function() return clock end
GetServerTime=function() return 1794000000 end
C_Timer={After=function(delay,fn) timers[#timers+1]={at=clock+delay,fn=fn} end}
C_ChatInfo={RegisterAddonMessagePrefix=function() return 0 end,SendAddonMessageLogged=function(_,msg) sent[#sent+1]=msg;return 0 end}
GetMoney=function() reads=reads+1;return 123 end
GetInventoryItemID=function() return nil end
NUM_BAG_SLOTS=0
C_Container={GetContainerNumSlots=function() return 0 end,GetContainerItemInfo=function() return nil end}
UnitStat=function() return 1,1 end
UnitHealthMax=function() return 1 end
GetProfessions=function() return nil,nil end
GetProfessionInfo=function() end
local ns={};assert(loadfile('TheSentenced/Profiles.lua'))('TheSentenced',ns)
local p=ns.Profiles
local function init(newInstall)
 p.init({db=function() return store end,scope=function() return 'g' end,me=function() return 'Me' end,member=function(n) return n end,newInstall=newInstall})
end
local function advance(limit)
 local steps=0
 while true do table.sort(timers,function(a,b) return a.at<b.at end)
  if #timers==0 or timers[1].at>limit then break end
  local e=table.remove(timers,1);clock=e.at;e.fn();steps=steps+1;assert(steps<1000)
 end
 clock=limit
end
init(true)
for _,cat in ipairs({'E','B','G','S','P'}) do assert(p.enabled(cat),'new default must be ON for '..cat) end
assert(store.profileDefaultsPending and p.startAuto())
assert(not p.publish() and reads==0,'new defaults must not transmit before setup finishes')
advance(11)
assert(reads==0,'automatic timers must not capture gold before setup finishes')
for _,msg in ipairs(sent) do assert(not msg:match('^P1|'),'must not transmit snapshots before setup') end
assert(not p.toggle('G'),'user may disable gold before finishing')
p.finishSetup();advance(90)
assert(not store.profileDefaultsPending and not p.enabled('G') and reads==0,'disabled gold must stay private')
local equipment=false;for _,msg in ipairs(sent) do if msg:match('^P1|E|') then equipment=true end;assert(not msg:match('^P1|G|')) end
assert(equipment,'enabled equipment should be published automatically after setup')
store={setupDone=true,profileShare={E=false,G=true}};timers={};sent={};init(false)
assert(not p.enabled('E') and p.enabled('G') and not p.enabled('B'),'upgrade must preserve explicit choices and missing fields')
store={setupDone=true};timers={};sent={};init(false)
for _,cat in ipairs({'E','B','G','S','P'}) do assert(not p.enabled(cat),'legacy missing settings must remain off') end
print('PROFILE_DEFAULTS_OK: setup-gated defaults, five toggles, preserved opt-out and legacy')
