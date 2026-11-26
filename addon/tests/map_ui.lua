local frames={}
local function widget()
 local f={shown=true,scripts={}}
 function f:SetScript(k,v) self.scripts[k]=v end
 function f:RegisterForClicks() end
 function f:SetSize() end
 function f:SetFrameLevel(v) self.level=v end
 function f:GetScale() return self.scale or 1 end
 function f:GetFrameLevel() return 5 end
 function f:SetPoint(...) self.point={...} end
 function f:ClearAllPoints() end
 function f:SetParent(p) self.parent=p end
 function f:Show() self.shown=true end
 function f:Hide() self.shown=false end
 function f:CreateTexture() return {SetAllPoints=function() end,SetTexture=function() end} end
 return f
end
function CreateFrame() local f=widget(); frames[#frames+1]=f; return f end
Minimap=widget(); function Minimap:GetWidth() return 200 end; function Minimap:GetHeight() return 200 end
local canvas=widget(); function canvas:GetWidth() return 1000 end; function canvas:GetHeight() return 1000 end
local mapId,top=12,2007
WorldMapFrame={IsShown=function() return true end,GetMapID=function() return mapId end,GetCanvas=function() return canvas end,GetPinFrameLevelsManager=function() return {GetValidFrameLevel=function(_,kind) assert(kind=='PIN_FRAME_LEVEL_TOPMOST'); return top end} end}
C_Map={GetBestMapForUnit=function() return 12 end,GetPlayerMapPosition=function() return {GetXY=function() return .5,.5 end} end,GetMapWorldSize=function() return 1000,1000 end}
C_Minimap={GetViewRadius=function() return 100 end}
local world,mini,hideNear=true,true,false
local hidden=false
local ns={hideMapPin=function() hidden=true; return true end,pinOptions=function() return world,mini,hideNear end,getMapPins=function() return {{map=12,x=5010,y=5000,kind=1,label='Miedź',author='A'}} end}
assert(loadfile('TheSentenced/MapPins.lua'))('TheSentenced',ns)
local timer=frames[1]; timer.scripts.OnUpdate(timer,1)
assert(#frames==3 and frames[2].shown and frames[3].shown,'both world and minimap pins must be created and shown')
assert(frames[2].parent==canvas and frames[3].parent==Minimap,'pins must use the correct map parent')
assert(frames[2].level==2008 and frames[3].level==15,'world pins above native manager, minimap unchanged')
assert(frames[2].point[4]==501 and frames[2].point[5]==-500,'zone map coordinates')
top=2030; timer.scripts.OnUpdate(timer,1); assert(frames[2].level==2031,'level follows native manager changes')
-- An ancestor map uses documented coordinate translation, never zone-normalized coordinates directly.
mapId=99
CreateVector2D=function(x,y) return {x=x,y=y} end
C_Map.GetMapInfo=function(id) if id==12 then return {parentMapID=99} end end
C_Map.GetWorldPosFromMapPos=function(id,pos) assert(id==12 and pos.x==.501); return 1,{x=5,y=8} end
C_Map.GetMapPosFromWorldPos=function(continent,pos,target) assert(continent==1 and target==99); return 99,{GetXY=function()return .25,.75 end} end
timer.scripts.OnUpdate(timer,1)
assert(frames[2].shown and frames[2].point[4]==250 and frames[2].point[5]==-750,'ancestor map uses translated coordinates')
mapId=98; timer.scripts.OnUpdate(timer,1); assert(not frames[2].shown,'unrelated map must not show wrong coordinates')
mapId=12; timer.scripts.OnUpdate(timer,1)

frames[3].scripts.OnClick(frames[3],'RightButton'); assert(hidden and not frames[3].shown,'right click hides minimap pin')
world=false; mini=false; timer.scripts.OnUpdate(timer,1)
assert(not frames[2].shown and not frames[3].shown,'turning pins off should hide both')
print('MAP_UI_OK: created pins on both map frames and hid them when disabled')

world=true;mini=true;WorldMapFrame.GetCanvas=function() error('map unavailable') end
timer.scripts.OnUpdate(timer,1)
assert(ns.mapDebug.worldOk==false and ns.mapDebug.miniOk==true,'map failure visible separately in diagnostic state')

WorldMapFrame.GetCanvas=function() return canvas end
hideNear=true
timer.scripts.OnUpdate(timer,1)
assert(frames[2].shown and not frames[3].shown and ns.mapDebug.miniNearbyHidden==1,'near resource hides only on minimap')
C_Map.GetPlayerMapPosition=function() return {GetXY=function() return .46,.5 end} end
timer.scripts.OnUpdate(timer,1)
assert(frames[3].shown and ns.mapDebug.miniNearbyHidden==0,'resource reappears after moving away')
C_Map.GetPlayerMapPosition=function() return {GetXY=function() return .5,.5 end} end
ns.getMapPins=function() return {{map=12,x=5010,y=5000,kind=4}} end
timer.scripts.OnUpdate(timer,1)
assert(frames[3].shown,'nearby non-resource markers stay visible')
