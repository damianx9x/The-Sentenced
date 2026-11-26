local frames={}
local function widget()
  local w={shown=false,scripts={}}
  function w:SetSize() end; function w:SetPoint(...) self.point={...} end; function w:ClearAllPoints() end
  function w:SetFrameStrata() end; function w:EnableMouse(v) self.mouse=v end
  function w:SetBackdrop() end; function w:SetBackdropColor() end; function w:SetBackdropBorderColor() end
  function w:SetWidth(v) self.width=v end; function w:SetHeight() end; function w:SetColorTexture() end; function w:SetTexture(v) self.texture=v end
  function w:SetText(v) self.text=v end; function w:SetTextColor() end; function w:SetJustifyH() end
  function w:SetAlpha(v) self.alpha=v end; function w:Show() self.shown=true end; function w:Hide() self.shown=false end
  function w:SetScript(k,v) self.scripts[k]=v end
  function w:CreateTexture() return widget() end
  function w:CreateFontString() local child=widget(); self.fonts=self.fonts or {}; self.fonts[#self.fonts+1]=child; return child end
  return w
end
UIParent=widget()
function CreateFrame(_,name,parent,template)
  local f=widget(); f.parent=parent; f.template=template
  frames[#frames+1]=f; if name then _G[name]=f end; return f
end
local combat=false
InCombatLockdown=function() return combat end
local ns={}
assert(loadfile('TheSentenced/EventNotifications.lua'))('TheSentenced',ns)
local driver=TheSentencedSignupNotice
assert(driver and driver.Preview and not driver.shown,'preview available without showing UI')
assert(not ns.notifyEventSignup({title='Raid'},'Gracz','NIE'))
assert(not ns.notifyEventSignup({title='Raid'},'', 'DPS'))
combat=true
assert(ns.notifyEventSignup({title='Wyprawa |cffff0000'},'Gracz|H','HEAL'))
driver.scripts.OnUpdate(driver,.2)
assert(#frames==1,'do not display notice while in combat')
combat=false; driver.scripts.OnUpdate(driver,.2)
local banner=frames[2]
assert(banner and banner.shown and banner.mouse==false,'notice is visible and noninteractive')
assert(banner.heading.text=='NOWY UCZESTNIK')
assert(banner.name.text=='GraczH  •  HEAL' and not banner.event.text:find('|',1,true),'unsafe markup removed')
combat=true; driver.scripts.OnUpdate(driver,.2); assert(not banner.shown,'hide during combat')
combat=false
for _=1,30 do if driver.shown then driver.scripts.OnUpdate(driver,.2) end end
assert(not banner.shown and not driver.shown,'notice finishes')
assert(driver:Preview()); driver.scripts.OnUpdate(driver,.2)
assert(banner.heading.text:find('TEST',1,true) and banner.event.text=='Przykładowa wyprawa','preview is clearly fictional')
for _=1,6 do assert(ns.notifyEventSignup({title='Raid'},'Gracz','DPS')) end
assert(not ns.notifyEventSignup({title='Raid'},'Nadmiar','DPS'),'queue remains bounded')
for _=1,220 do if driver.shown then driver.scripts.OnUpdate(driver,.2) end end
assert(not banner.shown and not driver.shown,'queued notifications finish')
local gameTime=100
GetTime=function() return gameTime end
combat=true
assert(ns.notifyEventSignup({title='Raid'},'Stary zapis','DPS'))
gameTime=131; driver.scripts.OnUpdate(driver,.2)
assert(not driver.shown and not banner.shown,'expired notices are discarded during long combat')
combat=false; driver.scripts.OnUpdate(driver,.2)
assert(not banner.shown,'expired notice must not appear after combat')
GetTime=function() error('clock unavailable') end
combat=true; assert(ns.notifyEventSignup({title='Raid'},'Stary zapis','DPS'))
driver.scripts.OnUpdate(driver,31)
assert(not driver.shown and not banner.shown,'fallback clock also expires a queued notice')
combat=false
CreateFrame=nil
local missing={}; assert(loadfile('TheSentenced/EventNotifications.lua'))('TheSentenced',missing)
assert(not missing.notifyEventSignup({title='Raid'},'Gracz','DPS'),'missing API safely degrades')
print('EVENT_NOTIFICATIONS_OK: combat, preview, bounded queue, sanitization and lifecycle')
