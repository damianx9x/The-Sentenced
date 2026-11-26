local _,NS=...
-- Blizzard: nine *new* five-player dungeons, verified 2026-11-08.
-- https://worldofwarcraft.blizzard.com/en-us/news/24301455/
-- This is not a complete list of every dungeon in Forever.
local catalog={
 {name='Hall of Thanes',min=13,max=18}, {name='Ruins of Lordaeron',min=15,max=20},
 {name='Excavation Site',min=24,max=29}, {name='City of Dalaran',min=28,max=33},
 {name='The Drowned City',min=35,max=40}, {name='Krol’dok Stronghold',min=40,max=45},
 {name='Alcaz Prison',min=48,max=53}, {name='Blackmaw Hold',min=55,max=60},
 {name='Shaper’s Terrace',min=58,max=60},
 -- Previously existing instances confirmed by Blizzard's Forever attunement article:
 -- https://worldofwarcraft.blizzard.com/en-us/news/24303009
 {name='Blackrock Depths',status='wcześniejsza'}, {name='Upper Blackrock Spire',status='wcześniejsza'},
 {name='Lower Blackrock Spire',status='wcześniejsza'},
 -- Forever hotfix, 2026-11-06:
 -- https://us.forums.blizzard.com/en/wow/t/wow-forever-hotfixes-november-6-2026/2403040
 {name='Maraudon',status='wcześniejsza'},
 -- Listed in Forever Beta; availability on the current realm is unverified.
 -- https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-november-2/2360696/4
 {name='Ragefire Chasm',status='beta'}, {name='Wailing Caverns',status='beta'},
 {name='The Deadmines',status='beta'}, {name='Shadowfang Keep',status='beta'},
 {name='The Stockade',status='beta'}, {name='Blackfathom Deeps',status='beta'},
 {name='Gnomeregan',status='beta'}, {name='Razorfen Kraul',status='beta'},
 {name='Scarlet Monastery',status='beta'}, {name='Razorfen Downs',status='beta'},
 {name='Uldaman',status='beta'},
}
local M={catalog=catalog}; NS.InstancePicker=M
local window,selectedCallback,selectedParent
local hooked=setmetatable({},{__mode='k'})
local function label(parent,text,size,color)
 local f=parent:CreateFontString(nil,'OVERLAY')
 f:SetFont('Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf',size,'')
 f:SetTextColor(unpack(color)); f:SetText(text); f:SetJustifyH('CENTER'); return f
end
local function button(parent,text,w,h,click)
 local b=CreateFrame('Button',nil,parent,'BackdropTemplate'); b:SetSize(w,h)
 b:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
 b:SetBackdropColor(.25,.22,.18,1); b:SetBackdropBorderColor(.48,.40,.30,1)
 b.caption=label(b,text,11,{1,.72,.35}); b.caption:SetPoint('CENTER'); b.caption:SetWidth(w-10)
 b:SetScript('OnEnter',function(self) self:SetBackdropColor(.37,.27,.22,1) end)
 b:SetScript('OnLeave',function(self) self:SetBackdropColor(.25,.22,.18,1) end)
 b:SetScript('OnClick',click); return b
end
local function choose(name,custom)
 local fn=selectedCallback; selectedCallback=nil; selectedParent=nil; window:Hide()
 if fn then fn(name,custom) end
end
local function create()
 local f=CreateFrame('Frame','TheSentencedInstancePicker',UIParent,'BackdropTemplate')
 f:SetSize(500,465); f:SetPoint('CENTER',UIParent,'CENTER',0,0); f:SetFrameStrata('FULLSCREEN_DIALOG'); f:SetFrameLevel(60); f:SetClampedToScreen(true); f:EnableMouse(true)
 f:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
 f:SetBackdropColor(.065,.055,.055,1); f:SetBackdropBorderColor(.67,.39,.22,1)
 local h=label(f,'WYBIERZ INSTANCJĘ',16,{1,.72,.35}); h:SetPoint('TOP',0,-14)
 local note=label(f,'Lista niepełna • strzałki: wybór • Enter: zatwierdź',10,{.68,.68,.68}); note:SetPoint('TOP',0,-42)
 f.choices={}
 local showGroup,refreshSelection; local currentGroup,selected='new',1
 f.newTab=button(f,'NOWE FOREVER',224,28,function() showGroup('new') end); f.newTab:SetPoint('TOPLEFT',20,-62)
 f.otherTab=button(f,'POZOSTAŁE / BETA',224,28,function() showGroup('other') end); f.otherTab:SetPoint('TOPLEFT',256,-62)
 for i,row in ipairs(catalog) do
  local extra=row.min and (row.min..'–'..row.max) or (row.status=='wcześniejsza' and 'starsza' or row.status)
  local b=button(f,row.name..'  •  '..extra,224,30,function() choose(row.name,false) end); b.labelText=row.name..'  •  '..extra
  local position=(i<=9 and i or i-9)-1
  b:SetPoint('TOPLEFT',20+(position%2)*236,-100-math.floor(position/2)*35); f.choices[i]=b
 end
 refreshSelection=function()
  for i,b in ipairs(f.choices) do b.caption:SetText((i==selected and '>  ' or '')..b.labelText) end
 end
 showGroup=function(group)
  currentGroup=group; selected=group=='new' and 1 or 10
  for i,b in ipairs(f.choices) do b:SetShown((i<=9 and group=='new') or (i>9 and group=='other')) end
  f.newTab.caption:SetText((group=='new' and '✓  ' or '')..'NOWE FOREVER')
  f.otherTab.caption:SetText((group=='other' and '✓  ' or '')..'POZOSTAŁE / BETA')
  refreshSelection()
 end
 showGroup('new')
 f.custom=button(f,'INNA INSTANCJA',224,30,function() choose(nil,true) end); f.custom:SetPoint('TOPLEFT',20,-390)
 f.close=button(f,'ANULUJ',110,27,function() M.close() end); f.close:SetPoint('BOTTOMRIGHT',-20,14)
 local keyboardHint=label(f,'TAB: kategoria   •   I: inna   •   ESC: zamknij',10,{.68,.68,.68}); keyboardHint:SetPoint('BOTTOMLEFT',20,19)
 if f.EnableKeyboard then f:EnableKeyboard(true) end
 if f.SetPropagateKeyboardInput then f:SetPropagateKeyboardInput(false) end
 f:SetScript('OnHide',function() selectedCallback=nil; selectedParent=nil end)
 f:SetScript('OnKeyDown',function(_,key)
  local first,last=currentGroup=='new' and 1 or 10,currentGroup=='new' and 9 or #catalog
  if key=='ESCAPE' then M.close(); return end
  if key=='TAB' then showGroup(currentGroup=='new' and 'other' or 'new'); return end
  if key=='I' then choose(nil,true); return end
  if key=='ENTER' or key=='NUMPADENTER' then choose(catalog[selected].name,false); return end
  local n=tonumber(key)
  if n and n>=1 and n<=9 then selected=math.min(last,first+n-1)
  elseif key=='UP' then selected=math.max(first,selected-2)
  elseif key=='DOWN' then selected=math.min(last,selected+2)
  elseif key=='LEFT' then selected=math.max(first,selected-1)
  elseif key=='RIGHT' then selected=math.min(last,selected+1)
  else return end
  refreshSelection()
 end)
 f:Hide(); if UISpecialFrames and tinsert then tinsert(UISpecialFrames,'TheSentencedInstancePicker') end
 return f
end
function M.pick(parent,callback,options)
 if type(callback)~='function' or not UIParent or type(CreateFrame)~='function' then return false end
 if not window then local ok,result=pcall(create); if not ok or not result then return false end; window=result end
 -- An edit box behind the popup must not consume keyboard selection.
 if type(GetCurrentKeyBoardFocus)=='function' then
  local ok,focus=pcall(GetCurrentKeyBoardFocus)
  if ok and not (issecretvalue and issecretvalue(focus)) and (type(focus)=='table' or type(focus)=='userdata') then
   pcall(function() if type(focus.ClearFocus)=='function' then focus:ClearFocus() end end)
  end
 end
 if parent and type(parent.HookScript)=='function' and not hooked[parent] then
  local ok=pcall(parent.HookScript,parent,'OnHide',function(self) if self==selectedParent then M.close() end end)
  if ok then hooked[parent]=true end
 end
 local customLabel=type(options)=='table' and options.customLabel or nil
 if type(customLabel)~='string' or customLabel=='' or #customLabel>60 or customLabel:find('[|%z\001-\031\127]') then customLabel='INNA INSTANCJA' end
 window.custom.caption:SetText(customLabel)
 selectedParent=parent; selectedCallback=callback; window:Show(); return true
end
function M.close() if window then selectedCallback=nil; selectedParent=nil; window:Hide() end end
