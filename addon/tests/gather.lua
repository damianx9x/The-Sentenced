local f={scripts={}}
function f:RegisterEvent(name) self.event=name end
function f:SetScript(name,fn) self.scripts[name]=fn end
function CreateFrame() return f end
local calls={}
local ns={recordAutomaticFind=function(...) calls[#calls+1]={...} end}
C_Spell={GetSpellInfo=function(id) if id==2575 or id==999 then return {name='Mining'} elseif id==2366 then return {name='Herbalism'} else return {name='Other'} end end}
C_Map={GetBestMapForUnit=function() return 12 end,GetPlayerMapPosition=function() return {GetXY=function() return .25,.75 end} end}
assert(loadfile('TheSentenced/Gather.lua'))('TheSentenced',ns)
assert(f.event=='UNIT_SPELLCAST_SUCCEEDED')
f.scripts.OnEvent(f,'UNIT_SPELLCAST_SUCCEEDED','player','cast',999)
assert(#calls==1 and calls[1][1]==12 and calls[1][2]==2500 and calls[1][3]==7500 and calls[1][4]==1)
f.scripts.OnEvent(f,'UNIT_SPELLCAST_SUCCEEDED','player','cast',2366)
assert(#calls==2 and calls[2][4]==2)
f.scripts.OnEvent(f,'UNIT_SPELLCAST_SUCCEEDED','party1','cast',2575)
f.scripts.OnEvent(f,'UNIT_SPELLCAST_SUCCEEDED','player','cast',111)
assert(#calls==2,'other units and unrelated spells must be ignored')
InCombatLockdown=function() return true end
f.scripts.OnEvent(f,'UNIT_SPELLCAST_SUCCEEDED','player','cast',2575)
assert(#calls==2,'combat-restricted capture must not guess position')
print('GATHER_OK: mining/herb casts, localized names, map coordinates, unrelated spells, combat')
