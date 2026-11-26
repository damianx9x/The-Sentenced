local _,NS=...
-- Best effort: records the player's approximate position after a recognized gather cast.
local frame=CreateFrame('Frame')
local function safe(v) return not (issecretvalue and issecretvalue(v)) end
local function spellName(id)
 if not C_Spell or not C_Spell.GetSpellInfo then return nil end
 local ok,info=pcall(C_Spell.GetSpellInfo,id)
 if not ok or not safe(info) or type(info)~='table' or not safe(info.name) or type(info.name)~='string' then return nil end
 return info.name
end
local function kindFor(id)
 if id==2575 then return 1 end
 if id==2366 then return 2 end
 local name=spellName(id); if not name then return nil end
 local mining,herbs=spellName(2575),spellName(2366)
 if mining and name==mining then return 1 end
 if herbs and name==herbs then return 2 end
end
-- Restoring a minimap tracking choice is separate from recording gathered nodes.
-- Never compete with Paladin Pulse when its own tracker is enabled.
local tracker={status='Oczekiwanie na dane gry.'}
NS.GatherTracking=tracker
local MINERALS,HERBS=2580,2383
-- Forever lists the alternate ranks separately in its native tracking menu.
local resourceBySpell={[MINERALS]=MINERALS,[8388]=MINERALS,[HERBS]=HERBS,[8387]=HERBS}
local elapsed,interval=15,15
local pendingDual
local function settings()
 if type(TheSentencedDB)~='table' then return nil end
 if type(TheSentencedDB.gatherTracking)~='table' then TheSentencedDB.gatherTracking={} end
 return TheSentencedDB.gatherTracking
end
local function pulseActive()
 local probe=(C_AddOns and C_AddOns.IsAddOnLoaded) or IsAddOnLoaded
 if type(probe)~='function' then return nil end
 local ok,loaded=pcall(probe,'PaladinPulse')
 if not ok or not safe(loaded) or type(loaded)~='boolean' then return nil end
 if not loaded then return false end
 return type(PaladinPulseDB)~='table' or PaladinPulseDB.trackEnabled~=false
end
function tracker.SetEnabled(enabled)
 local s=settings(); if not s then return false end
 s.enabled=enabled and true or false; elapsed=15; pendingDual=nil
 return true
end
function tracker.Select(id)
 if id~=nil and id~=MINERALS and id~=HERBS then return false end
 local s=settings(); if not s then return false end
 s.spell=id; s.dual=false; elapsed=15; pendingDual=nil
 return true
end
function tracker.SetDual(enabled)
 local s=settings(); if not s then return false end
 s.dual=enabled==true; elapsed=15; pendingDual=nil
 return true
end
local function readTracking(index)
 local ok,info=pcall(C_Minimap.GetTrackingInfo,index)
 if not ok or not safe(info) then return nil,false end
 if info==nil then return nil,true end
 if type(info)~='table' or not safe(info.spellID) or not safe(info.active) or not safe(info.name) then return nil,false end
 return info,true
end
local function activate(tracking)
 if tracking.active then return true end
 local called=pcall(C_Minimap.SetTracking,tracking.index,true)
 if not called then tracker.status='Gra odrzuciła próbę włączenia tropienia.'; return false end
 local info=readTracking(tracking.index)
 if info and info.active==true then return true end
 tracker.status='Nie potwierdzono włączenia tropienia.'
 return false,true
end
local function checkDual(minerals,herbs)
 if not minerals or not herbs then pendingDual=nil; return false end
 if pendingDual then
  local info=readTracking(pendingDual)
  pendingDual=nil
  if not (info and info.active==true) then
   tracker.status='Nie potwierdzono włączenia tropienia.'
   return true
  end
 end
 if minerals.active and herbs.active then
  tracker.status='Minerały i zioła są widoczne jednocześnie.'
  interval=2
  return true
 end
 local target=minerals.active and herbs or minerals
 local active,awaiting=activate(target)
 if not active then
  if awaiting then pendingDual=target.index; interval=1 end
  return true
 end
 local ore,plants=readTracking(minerals.index),readTracking(herbs.index)
 if not ore or not plants then tracker.status='Nie potwierdzono stanu obu tropień.'; return true end
 if ore.active and plants.active then
  tracker.status='Minerały i zioła są widoczne jednocześnie.'
  interval=2
 elseif minerals.active or herbs.active then
  tracker.status=ore.active and 'Rotacja co sekundę: minerały.' or 'Rotacja co sekundę: zioła.'
  interval=1
 else
  tracker.status='Sprawdzam dostępność drugiego tropienia.'
  interval=1
 end
 return true
end
function tracker.Check()
 interval=15
 local s=settings(); if not s then return end
 if s.enabled==false then tracker.status='Automatyczne tropienie wyłączone.'; return end
 local pulse=pulseActive()
 if pulse==nil then tracker.status='Nie można sprawdzić Paladin Pulse; automatyczne tropienie wstrzymane.'; return end
 if pulse then tracker.status='Tropieniem zarządza Paladin Pulse.'; return end
 if InCombatLockdown and InCombatLockdown() then tracker.status='Tropienie zostanie sprawdzone po walce.'; return end
 if UnitIsDeadOrGhost and UnitIsDeadOrGhost('player') then tracker.status='Tropienie zostanie sprawdzone po powrocie do życia.'; return end
 if not C_Minimap or not C_Minimap.GetNumTrackingTypes or not C_Minimap.GetTrackingInfo or not C_Minimap.SetTracking then
  tracker.status='API tropienia niedostępne.'; return
 end
 local ok,count=pcall(C_Minimap.GetNumTrackingTypes)
 if not ok or not safe(count) or type(count)~='number' or count<0 or count>1000 then tracker.status='Nie można odczytać tropienia.'; return end
 local found={}
 local oreName,herbName=spellName(MINERALS),spellName(HERBS)
 for i=1,count do
  local info,readable=readTracking(i)
  if not readable then tracker.status='Nie można odczytać tropienia.'; return end
  if info then
   local id=resourceBySpell[info.spellID]
   if not id and oreName and info.name==oreName then id=MINERALS end
   if not id and herbName and info.name==herbName then id=HERBS end
   if id and (not found[id] or info.active==true) then found[id]={index=i,active=info.active==true} end
  end
 end
 if s.dual and checkDual(found[MINERALS],found[HERBS]) then return end
 -- Keep the player's current resource selection in automatic single mode.
 local chosen=not s.dual and s.spell or nil
 if chosen~=MINERALS and chosen~=HERBS then
  if found[MINERALS] and found[MINERALS].active then chosen=MINERALS
  elseif found[HERBS] and found[HERBS].active then chosen=HERBS
  elseif s.lastSpell and found[s.lastSpell] then chosen=s.lastSpell
  elseif found[MINERALS] then chosen=MINERALS elseif found[HERBS] then chosen=HERBS end
 end
 local target=found[chosen]
 if not target then tracker.status='Wybrane tropienie surowców nie jest dostępne.'; return end
 s.lastSpell=chosen
 if activate(target) then
  tracker.status=s.dual and 'Aktywne jedno tropienie. Gra nie udostępnia drugiej profesji.' or 'Tropienie surowców aktywne.'
 end
end
frame:RegisterEvent('PLAYER_ENTERING_WORLD')
frame:RegisterEvent('PLAYER_REGEN_ENABLED')
frame:RegisterEvent('PLAYER_ALIVE')
frame:RegisterEvent('PLAYER_UNGHOST')
frame:RegisterEvent('UNIT_SPELLCAST_SUCCEEDED')
frame:SetScript('OnUpdate',function(_,delta)
 elapsed=elapsed+delta
 if elapsed>=interval then elapsed=0; tracker.Check() end
end)
frame:SetScript('OnEvent',function(_,event,unit,_,id)
 if event~='UNIT_SPELLCAST_SUCCEEDED' then elapsed=15; return end
 if NS.FeatureEnabled and not NS.FeatureEnabled('gatherRecord') then return end
 if not safe(unit) or not safe(id) or unit~='player' or type(id)~='number' then return end
 local kind=kindFor(id); if not kind then return end
 if InCombatLockdown and InCombatLockdown() then NS.gatherStatus='Zbieranie w walce: pozycja niedostępna.'; return end
 if not C_Map or not C_Map.GetBestMapForUnit or not C_Map.GetPlayerMapPosition then NS.gatherStatus='Brak API pozycji mapy.'; return end
 local ok,map=pcall(C_Map.GetBestMapForUnit,'player')
 if not ok or not safe(map) or type(map)~='number' then NS.gatherStatus='Nie ustalono mapy zebranego surowca.'; return end
 local good,point=pcall(C_Map.GetPlayerMapPosition,map,'player')
 if not good or not safe(point) or not point then NS.gatherStatus='Nie ustalono pozycji zebranego surowca.'; return end
 local valid,x,y=pcall(function() return point:GetXY() end)
 if not valid or not safe(x) or not safe(y) or type(x)~='number' or type(y)~='number' or x<0 or x>1 or y<0 or y>1 then NS.gatherStatus='Nie ustalono współrzędnych surowca.'; return end
 if NS.recordAutomaticFind then NS.recordAutomaticFind(map,math.floor(x*10000+.5),math.floor(y*10000+.5),kind) end
end)
