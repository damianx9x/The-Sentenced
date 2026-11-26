local f={scripts={}}
function f:RegisterEvent() end
function f:SetScript(name,fn) self.scripts[name]=fn end
function CreateFrame() return f end
TheSentencedDB={}
local pulse,combat,dead=false,false,false
C_AddOns={IsAddOnLoaded=function(name) return name=='PaladinPulse' and pulse end}
InCombatLockdown=function() return combat end
UnitIsDeadOrGhost=function() return dead end
local entries={{spellID=2580,active=false},{spellID=2383,active=true}}
local calls=0
C_Minimap={
 GetNumTrackingTypes=function() return #entries end,
 GetTrackingInfo=function(i) return entries[i] end,
 SetTracking=function(i,on) calls=calls+1; entries[i].active=on end,
}
local ns={}
assert(loadfile('TheSentenced/Gather.lua'))('TheSentenced',ns)
local t=ns.GatherTracking
t.Check()
assert(calls==0 and TheSentencedDB.gatherTracking.lastSpell==2383,'preserve active herb tracking')
entries[2].active=false
t.Check()
assert(calls==1 and entries[2].active,'restore last active resource tracking')
assert(t.SetEnabled(false)); entries[2].active=false; t.Check()
assert(calls==1,'disabled does not alter tracking')
assert(t.SetEnabled(true) and t.Select(2580)); pulse=true; PaladinPulseDB={trackEnabled=true}; t.Check()
assert(calls==1 and t.status:find('Paladin Pulse'),'defer to active Paladin Pulse')
PaladinPulseDB.trackEnabled=false
C_AddOns.IsAddOnLoaded=function() error('unavailable') end
t.Check(); assert(calls==1 and t.status:find('wstrzymane'),'stop when addon detection errors')
C_AddOns.IsAddOnLoaded=nil
t.Check(); assert(calls==1 and t.status:find('wstrzymane'),'stop when detection API is absent')
C_AddOns.IsAddOnLoaded=function() return nil end
t.Check(); assert(calls==1 and t.status:find('wstrzymane'),'stop on unknown detection result')
C_AddOns.IsAddOnLoaded=nil
IsAddOnLoaded=function() return false end
t.Check(); assert(calls==2 and entries[1].active,'legacy detection allows tracking when Paladin Pulse is absent')
entries[1].active=false
C_AddOns.IsAddOnLoaded=function(name) return name=='PaladinPulse' and pulse end
IsAddOnLoaded=nil
combat=true; t.Check(); assert(calls==2,'no attempt in combat')
combat=false; dead=true; t.Check(); assert(calls==2,'no attempt while dead')
dead=false; t.Check(); assert(calls==3 and entries[1].active,'try the selected profession')
entries[1].active=false
C_Minimap.SetTracking=function() calls=calls+1 end
t.Check(); assert(t.status:find('Nie potwierdzono'),'do not call an unconfirmed attempt success')
C_Minimap.SetTracking=function() error('restricted') end
t.Check(); assert(t.status:find('odrzuciła'),'report rejected API call')
assert(not t.Select(999),'reject unsupported tracking preference')
C_Minimap.GetNumTrackingTypes=function() return 0 end
t.Check(); assert(t.status:find('nie jest dostępne'),'report unavailable selection')
print('GATHER_TRACKING_OK: selection, restore, opt-out, coexistence, combat, death, confirmation and errors')

C_Minimap.GetNumTrackingTypes=function() return #entries end
entries[1].active,entries[2].active=false,true
C_Minimap.SetTracking=function(i,on) calls=calls+1; entries[i].active=on end
assert(t.SetDual(true)); t.Check()
assert(entries[1].active and entries[2].active and t.status:find('jednocześnie'),'use simultaneous tracking when the client supports it')
local before=calls
f.scripts.OnUpdate(f,2)
assert(calls==before,'does not rewrite confirmed simultaneous tracking')
entries[1].active,entries[2].active=true,false
C_Minimap.SetTracking=function(i,on)
 calls=calls+1
 entries[i].active=on
 entries[3-i].active=false
end
t.Check()
assert(not entries[1].active and entries[2].active and t.status:find('Rotacja'),'detect exclusive native tracking')
f.scripts.OnUpdate(f,.8)
assert(entries[2].active,'wait for the rotation interval')
f.scripts.OnUpdate(f,.2)
assert(entries[1].active and not entries[2].active,'alternate using the native API')
combat=true; before=calls
f.scripts.OnUpdate(f,2); assert(calls==before,'rotation stops in combat')
combat=false
f.scripts.OnEvent(f,'PLAYER_REGEN_ENABLED')
f.scripts.OnUpdate(f,.1); assert(entries[2].active,'resume after combat')
C_Minimap.GetNumTrackingTypes=function() return 1 end
t.Check(); assert(entries[1].active and t.status:find('Aktywne jedno'),'preserve single profession support')
assert(t.Select(2580) and not TheSentencedDB.gatherTracking.dual,'explicit resource exits dual mode')
print('GATHER_DUAL_OK: coexistence, native exclusivity, interval, combat, single profession')

entries={{spellID=8388,active=true},{spellID=8387,active=false}}
C_Minimap.GetNumTrackingTypes=function() return 3 end
local queued
C_Minimap.SetTracking=function(index)
 calls=calls+1
 queued=index
end
assert(t.SetDual(true)); t.Check()
assert(queued==2,'recognize alternate rank tracking with empty tracking entries')
entries[1].active,entries[2].active=false,true
f.scripts.OnUpdate(f,1)
assert(queued==1,'delayed native activation still starts rotation')
before=calls
f.scripts.OnUpdate(f,1); f.scripts.OnUpdate(f,1)
assert(calls==before and t.status:find('Nie potwierdzono'),'unacknowledged writes back off rather than repeating every second')
