local _,NS=...
if not CreateFrame or not UIParent or not NS.Snake then return end
local frame=CreateFrame('Frame','TheSentencedSnake',UIParent,'BackdropTemplate')
if type(UISpecialFrames)=='table' then table.insert(UISpecialFrames,'TheSentencedSnake') end
frame:SetSize(340,340);frame:SetPoint('CENTER');frame:SetFrameStrata('FULLSCREEN_DIALOG');frame:SetMovable(true);frame:EnableMouse(true);frame:RegisterForDrag('LeftButton');frame:SetScript('OnDragStart',frame.StartMoving);frame:SetScript('OnDragStop',frame.StopMovingOrSizing)
if frame.SetBackdrop then frame:SetBackdrop({bgFile='Interface/Buttons/WHITE8X8',edgeFile='Interface/Tooltips/UI-Tooltip-Border',tile=false,edgeSize=12});frame:SetBackdropColor(.08,.06,.05,.96) end
local title=frame:CreateFontString(nil,'OVERLAY','GameFontNormalLarge');title:SetPoint('TOP',0,-12);if NS.Theme then NS.Theme.font(title,16,'body') end;title:SetText('WĄŻ HORDY')
local status=frame:CreateFontString(nil,'OVERLAY','GameFontNormal');status:SetPoint('TOP',0,-36);if NS.Theme then NS.Theme.font(status,11,'body') end
local close=CreateFrame('Button',nil,frame,'UIPanelCloseButton');close:SetPoint('TOPRIGHT',-2,-2)
local board=CreateFrame('Frame',nil,frame);board:SetSize(300,220);board:SetPoint('TOP',0,-62)
local background=board:CreateTexture(nil,'BACKGROUND',nil,-8);background:SetAllPoints(board);background:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\SnakeBoard.tga')
local cells,sprites={},{}
local iconHead='Interface\\Icons\\INV_Misc_Head_Dragon_01'
local iconFood='Interface\\Icons\\INV_Misc_Gem_01'
local iconWall='Interface\\Icons\\INV_Stone_03'
local bonusIcons={SHIELD='Interface\\Icons\\INV_Shield_05',SLOW='Interface\\Icons\\INV_Misc_PocketWatch_01',DOUBLE='Interface\\Icons\\INV_Misc_Coin_01'}
for y=1,11 do cells[y]={};sprites[y]={};for x=1,15 do
 local t=board:CreateTexture(nil,'BACKGROUND');t:SetSize(19,19);t:SetPoint('BOTTOMLEFT',(x-1)*20,(y-1)*20);cells[y][x]=t
 local icon=board:CreateTexture(nil,'ARTWORK');icon:SetSize(19,19);icon:SetPoint('BOTTOMLEFT',(x-1)*20,(y-1)*20);icon:Hide();sprites[y][x]=icon
end end
local crest=frame:CreateTexture(nil,'ARTWORK');crest:SetSize(30,30);crest:SetPoint('TOPLEFT',8,-7);crest:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\GuildCrest.tga')
local crest2=frame:CreateTexture(nil,'ARTWORK');crest2:SetSize(30,30);crest2:SetPoint('TOPRIGHT',-30,-7);crest2:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\GuildCrest.tga')
local game,elapsed,flightTime,autoOpened,flightSeen,ready=nil,0,0,false,false,false
local mode=1
local modeNames={'ŚCIANY','BRAMY','LABIRYNT','PRZEJŚCIA'}
local bonusNames={SHIELD='TARCZA',SLOW='SPOWOLNIENIE',DOUBLE='PUNKTY ×2'}
local function repaint()
 if not game then return end
 for y=1,11 do for x=1,15 do local shade=((x+y)%2==0) and .13 or .16;cells[y][x]:SetColorTexture(shade,shade*.65,shade*.45,.18);sprites[y][x]:Hide() end end
 for y=1,11 do for x=1,15 do if game.walls[x..':'..y] then local icon=sprites[y][x];icon:SetTexture(iconWall);icon:Show() end end end
 if game.food then local icon=sprites[game.food.y][game.food.x];icon:SetTexture(iconFood);icon:Show() end
 if game.bonus then local icon=sprites[game.bonus.y][game.bonus.x];icon:SetTexture(bonusIcons[game.bonus.kind]);icon:Show() end
 for i,p in ipairs(game.body) do
  local base,icon=cells[p.y][p.x],sprites[p.y][p.x]
  if i==1 then
   base:SetColorTexture(1,.73,.28,1)
   icon:SetTexture(iconHead);icon:Show()
  else
   local strength=1-.5*(i-2)/math.max(1,#game.body-2)
   base:SetColorTexture(.38*strength,.96*strength,.52*strength,1)
   icon:SetColorTexture(.09,.26,.14,.56);icon:Show()
  end
 end
 if game.status~='PLAYING' and type(TheSentencedDB)=='table' then TheSentencedDB.snakeBest=math.max(tonumber(TheSentencedDB.snakeBest) or 0,game.score) end
 local best=type(TheSentencedDB)=='table' and (tonumber(TheSentencedDB.snakeBest) or 0) or 0
 local effect=game.shield>0 and 'TARCZA' or game.slow>0 and 'SPOWOLNIENIE' or game.double>0 and 'PUNKTY ×2' or game.bonus and ('BONUS: '..(bonusNames[game.bonus.kind] or '?')) or ''
 status:SetText(ready and (modeNames[mode]..' • wybierz kierunek') or ('Wynik: '..game.score..'  •  Długość: '..#game.body..'  •  Rekord: '..best..(game.status=='LOST' and ' • Koniec gry' or game.status=='WON' and ' • Zwycięstwo!' or (effect~='' and ' • '..effect or ''))))
end
local function newGame() game=NS.Snake.new(nil,nil,nil,{mode=mode});elapsed=0;ready=true;repaint() end
local function turn(direction) if game and NS.Snake.turn(game,direction) then ready=false;repaint() end end
local function open(manual)
 if NS.FeatureEnabled and not NS.FeatureEnabled('snake') then return false end
 if InCombatLockdown and InCombatLockdown() then return false end
 autoOpened=not manual;newGame();frame:Show();return true
end
local function control(label,direction,x,y)
 local b=CreateFrame('Button',nil,frame,'UIPanelButtonTemplate');b:SetSize(45,24);b:SetPoint('BOTTOM',x,y);b:SetText(label);if NS.Theme and b.GetFontString then NS.Theme.font(b:GetFontString(),12,'body') end;b:SetScript('OnClick',function() turn(direction) end)
end
control('↑','UP',0,27);control('←','LEFT',-48,3);control('↓','DOWN',0,3);control('→','RIGHT',48,3)
local reset=CreateFrame('Button',nil,frame,'UIPanelButtonTemplate');reset:SetSize(70,24);reset:SetPoint('BOTTOMRIGHT',-12,6);reset:SetText('Od nowa');reset:SetScript('OnClick',newGame)
local chooseMode=CreateFrame('Button',nil,frame,'UIPanelButtonTemplate');chooseMode:SetSize(78,24);chooseMode:SetPoint('BOTTOMLEFT',10,6);chooseMode:SetText('Trasa 1/4')
-- A private tooltip keeps Polish glyphs readable without changing the shared
-- GameTooltip fonts used by Blizzard and other addons.
local modeTip=CreateFrame('GameTooltip','TheSentencedSnakeModeTip',UIParent,'GameTooltipTemplate')
local function showModeTip(self)
 modeTip:SetOwner(self,'ANCHOR_TOP');modeTip:SetText('Obecna trasa: '..modeNames[mode]);modeTip:AddLine('Kliknięcie rozpoczyna nową grę na kolejnej trasie.',1,1,1,true);modeTip:AddLine('Co pięć artefaktów pojawia się na chwilę bonus: tarcza, spowolnienie albo punkty ×2.',1,1,1,true)
 if NS.Theme then for i=1,3 do local line=_G['TheSentencedSnakeModeTipTextLeft'..i];if line then NS.Theme.font(line,12,'body') end end end
 modeTip:Show()
end
chooseMode:SetScript('OnClick',function() mode=mode%4+1;chooseMode:SetText('Trasa '..mode..'/4');newGame();showModeTip(chooseMode) end)
chooseMode:SetScript('OnEnter',showModeTip)
chooseMode:SetScript('OnLeave',function() modeTip:Hide() end)
frame:EnableKeyboard(true);if frame.SetPropagateKeyboardInput then frame:SetPropagateKeyboardInput(true) end
frame:SetScript('OnKeyDown',function(self,key)
 local m={UP='UP',DOWN='DOWN',LEFT='LEFT',RIGHT='RIGHT'}
 -- Arrow keys belong to the game while Snake is open; other shortcuts must
 -- continue to reach WoW and other addons.
 if self.SetPropagateKeyboardInput then self:SetPropagateKeyboardInput(not (game and m[key])) end
 if game and m[key] then turn(m[key]) end
end)
frame:Hide()
local taxiCheck=0
local watcher=CreateFrame('Frame');watcher:SetScript('OnUpdate',function(_,dt)
 taxiCheck=taxiCheck+dt
 if taxiCheck>=1 then
 local delta=taxiCheck;taxiCheck=0
 if NS.FeatureEnabled and not NS.FeatureEnabled('snake') then
  if frame:IsShown() then frame:Hide() end
  flightTime,flightSeen,autoOpened=0,false,false
  return
 end
 if autoOpened and TheSentencedDB and TheSentencedDB.snakeAuto==false then
  frame:Hide(); autoOpened=false
 end
 local taxi=UnitOnTaxi and UnitOnTaxi('player')
 if taxi then flightTime=flightTime+delta;if flightTime>=45 and not flightSeen then
  if frame:IsShown() or (TheSentencedDB and TheSentencedDB.snakeAuto==false) then flightSeen=true
  elseif open(false) then flightSeen=true end
 end
 else if autoOpened and frame:IsShown() then frame:Hide() end;flightTime=0;flightSeen=false;autoOpened=false end
 end
 if frame:IsShown() and game and not ready and game.status=='PLAYING' then elapsed=elapsed+dt;if elapsed>=(game.slow>0 and .28 or math.max(.095,.19-game.foods*.004)) then elapsed=0;NS.Snake.step(game);repaint() end end
end)
SLASH_TSSNAKE1='/tssnake';SlashCmdList.TSSNAKE=function(msg)
 if msg and msg:lower():match('^%s*auto%s*$') then TheSentencedDB=TheSentencedDB or {};TheSentencedDB.snakeAuto=TheSentencedDB.snakeAuto==false;print('The Sentenced: wąż podczas lotu '..(TheSentencedDB.snakeAuto and 'włączony' or 'wyłączony')..'.')
 elseif frame:IsShown() then frame:Hide() else open(true) end
end
