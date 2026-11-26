local _, NS = ...
-- Pins represent saved observations, not currently active spawns.
local TEX={
 'Interface\\Icons\\Trade_Mining','Interface\\Icons\\Trade_Herbalism',
 'Interface\\Icons\\INV_Box_01','Interface\\Icons\\INV_Misc_Map_01',
 'Interface\\Icons\\INV_Misc_Note_01','Interface\\Icons\\INV_Misc_Coin_01'
}
local miniPins,worldPins={},{}
local lastCanvas, lastMap, lastScale
local ICON_SIZE=15
local NEAR_RESOURCE_YARDS=18
NS.mapDebug={}
local debugState=NS.mapDebug
local function safeNumber(x)
 return type(x)=='number' and not (issecretvalue and issecretvalue(x))
end
-- Coordinates: normalized map x grows east; y grows south. Size and radius are yards.
function NS.ProjectMinimap(px,py,x,y,width,height,radius,rotation)
 if not safeNumber(px) or not safeNumber(py) or not safeNumber(x) or not safeNumber(y) or not safeNumber(width) or not safeNumber(height) or not safeNumber(radius) or radius<=0 then return end
 local east=(x-px)*width; local north=-(y-py)*height
 if rotation then
   if not safeNumber(rotation) then return end
   local cs,sn=math.cos(rotation),math.sin(rotation)
   east,north=east*cs+north*sn,-east*sn+north*cs
 end
 local dx,dy=east/radius,north/radius
 if dx*dx+dy*dy>0.85*0.85 then return end
 return dx,dy
end
local function hide(pool) for _,p in ipairs(pool) do p:Hide() end end
local function pin(pool,i,parent)
 local p=pool[i]
 if not p then
   p=CreateFrame('Button',nil,parent); p:SetSize(ICON_SIZE,ICON_SIZE); p:SetFrameLevel(parent:GetFrameLevel()+10)
   p.icon=p:CreateTexture(nil,'OVERLAY'); p.icon:SetAllPoints(); pool[i]=p
   p:RegisterForClicks('RightButtonUp')
   p:SetScript('OnClick',function(self,button)
     if button=='RightButton' and self.data and NS.hideMapPin and NS.hideMapPin(self.data) then self:Hide(); if GameTooltip then GameTooltip:Hide() end end
   end)
   p:SetScript('OnEnter',function(self)
     if not GameTooltip or not self.data then return end
     GameTooltip:SetOwner(self,'ANCHOR_RIGHT'); GameTooltip:SetText(self.data.label or 'Znalezisko')
     GameTooltip:AddLine('Zgłosił: '..(self.data.author or '?')); GameTooltip:AddLine('Prawy przycisk: ukryj u siebie'); GameTooltip:Show()
   end)
   p:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
 end
 p:SetParent(parent); return p
end
-- MapCanvas in the Forever UI allocates native pin levels through its manager.
-- Recalculate on each refresh because Blizzard can reorder levels when providers load.
local function worldPinLevel(map,canvas)
 local base=(canvas.GetFrameLevel and canvas:GetFrameLevel()) or 0
 local level=base+10
 if map.GetPinFrameLevelsManager then
   local ok,manager=pcall(map.GetPinFrameLevelsManager,map)
   if ok and manager and type(manager.GetValidFrameLevel)=='function' then
     local success,top=pcall(manager.GetValidFrameLevel,manager,'PIN_FRAME_LEVEL_TOPMOST')
     if success and safeNumber(top) then level=math.max(level,math.min(top+1,9000)) end
   end
 end
 return level
end
local function worldCoordinates(entry,mapId)
 if entry.map==mapId then return entry.x/10000,entry.y/10000 end
 -- Convert only if supported by the current client and target is an ancestor.
 if not (C_Map and C_Map.GetMapInfo and C_Map.GetWorldPosFromMapPos and C_Map.GetMapPosFromWorldPos and CreateVector2D) then return end
 local id=entry.map; local ancestor=false
 for _=1,16 do
   local ok,info=pcall(C_Map.GetMapInfo,id)
   if not ok or type(info)~='table' or not safeNumber(info.parentMapID) or info.parentMapID<=0 or info.parentMapID==id then break end
   id=info.parentMapID; if id==mapId then ancestor=true; break end
 end
 if not ancestor then return end
 local ok,continent,world=pcall(C_Map.GetWorldPosFromMapPos,entry.map,CreateVector2D(entry.x/10000,entry.y/10000))
 if not ok or not safeNumber(continent) or not world then return end
 local converted,target,point=pcall(C_Map.GetMapPosFromWorldPos,continent,world,mapId)
 if not converted or target~=mapId or not point then return end
 local valid,x,y=pcall(function() return point:GetXY() end)
 if valid and safeNumber(x) and safeNumber(y) and x>=0 and x<=1 and y>=0 and y<=1 then return x,y end
end
-- Canvas zoom changes its effective scale. Size the icon relative to the UI
-- so its screen-space size remains stable in World Map and map addons.
local function canvasIconSize(canvas)
 local uiScale=UIParent and UIParent.GetEffectiveScale and UIParent:GetEffectiveScale() or 1
 local canvasScale=canvas.GetEffectiveScale and canvas:GetEffectiveScale() or uiScale
 if not safeNumber(uiScale) or not safeNumber(canvasScale) or uiScale<=0 or canvasScale<=0 then return ICON_SIZE end
 return ICON_SIZE*uiScale/canvasScale
end
NS.WorldMapIconSize=canvasIconSize
local function updateWorld(rows,enabled)
 hide(worldPins)
 debugState.worldDrawn=0
 if not enabled then debugState.worldReason='disabled';return true,0 end
 if not WorldMapFrame or not WorldMapFrame.IsShown or not WorldMapFrame:IsShown() then debugState.worldReason='closed';return true,0 end
 if not WorldMapFrame.GetMapID or not WorldMapFrame.GetCanvas then debugState.worldReason='missing_api';return false,0 end
 local mapId=WorldMapFrame:GetMapID(); local canvas=WorldMapFrame:GetCanvas()
 debugState.worldMapID=mapId;debugState.canvasReady=canvas~=nil;debugState.worldReason='canvas_check'
 if not mapId or not canvas then return false,0 end
 local width,height=canvas:GetWidth(),canvas:GetHeight(); if not safeNumber(width) or not safeNumber(height) or width<=0 or height<=0 then return false,0 end
 debugState.canvasWidth=width;debugState.canvasHeight=height;debugState.worldSameMap=0
 local size=canvasIconSize(canvas)
 lastCanvas,lastMap,lastScale=canvas,mapId,size
 local n=0
 for _,entry in ipairs(rows) do
   if entry.map==mapId then debugState.worldSameMap=debugState.worldSameMap+1 end
   local x,y=worldCoordinates(entry,mapId)
   if x and y then
     n=n+1; if n>40 then break end
     local p=pin(worldPins,n,canvas); p.data=entry; p.icon:SetTexture(TEX[entry.kind] or TEX[4])
     local level=worldPinLevel(WorldMapFrame,canvas);debugState.worldPinLevel=level;p:SetFrameLevel(level);p:SetSize(size,size)
     local scale=p.GetScale and p:GetScale() or 1; if not safeNumber(scale) or scale<=0 then scale=1 end
     p:ClearAllPoints(); p:SetPoint('CENTER',canvas,'TOPLEFT',x*width/scale,-y*height/scale); p:Show()
   end
 end
 debugState.worldDrawn=math.min(n,40);debugState.worldReason=n>0 and 'drawn' or 'no_matching_points'
 debugState.lastOpenMapID=mapId;debugState.lastOpenDrawn=debugState.worldDrawn;debugState.lastOpenReason=debugState.worldReason
 return true,math.min(n,40)
end
local function updateMini(rows,enabled,hideNear)
 hide(miniPins)
 debugState.miniNearbyHidden=0
 if not enabled then return true,0 end
 if not Minimap or not C_Map or not C_Minimap or not C_Map.GetMapWorldSize or not C_Map.GetPlayerMapPosition or not C_Map.GetBestMapForUnit or not C_Minimap.GetViewRadius then return false,0 end
 local mapId=C_Map.GetBestMapForUnit('player');debugState.playerMapID=mapId; if not mapId then return false,0 end
 local point=C_Map.GetPlayerMapPosition(mapId,'player'); if not point then return false,0 end
 local px,py=point:GetXY(); local width,height=C_Map.GetMapWorldSize(mapId); local radius=C_Minimap.GetViewRadius()
 local mmw,mmh=Minimap:GetWidth(),Minimap:GetHeight(); if not safeNumber(mmw) or not safeNumber(mmh) or mmw<=0 or mmh<=0 or not safeNumber(width) or not safeNumber(height) or not safeNumber(radius) or radius<=0 then return false,0 end
 local rotating=C_CVar and C_CVar.GetCVarBool and C_CVar.GetCVarBool('rotateMinimap')
 local facing=rotating and GetPlayerFacing and GetPlayerFacing() or nil
 if rotating and not facing then return false,0 end
 local n=0
 for _,entry in ipairs(rows) do
   if entry.map==mapId then
     local dx,dy=NS.ProjectMinimap(px,py,entry.x/10000,entry.y/10000,width,height,radius,facing)
     if dx then
       local resource=entry.kind==1 or entry.kind==2
       local near=(dx*dx+dy*dy)*radius*radius<=NEAR_RESOURCE_YARDS^2
       if hideNear and resource and near then
         debugState.miniNearbyHidden=debugState.miniNearbyHidden+1
       else
         n=n+1; if n>40 then break end
         local p=pin(miniPins,n,Minimap); p.data=entry; p.icon:SetTexture(TEX[entry.kind] or TEX[4])
         p:ClearAllPoints(); p:SetPoint('CENTER',Minimap,'CENTER',dx*mmw/2,dy*mmh/2); p:Show()
       end
     end
   end
 end
 return true,math.min(n,40)
end
NS.mapPinsStatus='Znaczniki wyłączone.'
local timer=CreateFrame('Frame')
local elapsed=0
timer:SetScript('OnUpdate',function(_,dt)
 if lastCanvas and WorldMapFrame and WorldMapFrame.GetMapID then
   if WorldMapFrame:GetMapID()~=lastMap then hide(worldPins);lastCanvas=nil;elapsed=.8
   elseif WorldMapFrame:IsShown() then
     local size=canvasIconSize(lastCanvas)
     if size~=lastScale then for _,p in ipairs(worldPins) do p:SetSize(size,size) end;lastScale=size end
   end
 end
 elapsed=elapsed+(dt or 0); if elapsed<0.8 then return end; elapsed=0
 local world,mini,hideNear=NS.pinOptions()
 if not world and not mini then hide(worldPins); hide(miniPins); NS.mapPinsStatus='Znaczniki wyłączone.'; return end
 if InCombatLockdown and InCombatLockdown() then debugState.inCombat=true;debugState.worldReason='combat';hide(worldPins); hide(miniPins); NS.mapPinsStatus='Znaczniki wstrzymane podczas walki.'; return end
 local okRows,rows=pcall(NS.getMapPins)
 if not okRows then hide(worldPins); hide(miniPins); NS.mapPinsStatus='Dane znaczników niedostępne.'; return end
 debugState.rows=#rows;debugState.inCombat=false
 local okWorld,readyWorld,worldCount=pcall(updateWorld,rows,world); local okMini,readyMini,miniCount=pcall(updateMini,rows,mini,hideNear)
 debugState.worldOk=okWorld and readyWorld==true;debugState.miniOk=okMini and readyMini==true;debugState.worldDrawn=okWorld and worldCount or 0;debugState.miniDrawn=okMini and miniCount or 0
 if NS.Diagnostics then if not okWorld then pcall(NS.Diagnostics.error,'map.world',readyWorld) end; if not okMini then pcall(NS.Diagnostics.error,'map.mini',readyMini) end end
 if not okWorld or not readyWorld then hide(worldPins) end; if not okMini or not readyMini then hide(miniPins) end
 if not okWorld or not readyWorld or not okMini or not readyMini then NS.mapPinsStatus='Brak danych/API mapy lub minimapy; sprawdź poza walką.'
 else NS.mapPinsStatus='Zapisane miejsca: '..#rows..' • mapa świata: '..(worldCount or 0)..' • minimapa: '..(miniCount or 0)..'.' end
end)
