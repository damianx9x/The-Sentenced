local all={}
local function make()
  local o={scripts={},shown=true}
  function o:SetSize() end; function o:SetPoint() end; function o:SetFrameStrata() end
  function o:SetFrameLevel() end; function o:EnableMouse() end; function o:SetBackdrop() end
  function o:SetBackdropColor() end; function o:SetBackdropBorderColor() end
  function o:SetWidth() end; function o:SetJustifyH() end; function o:SetEnabled(v) self.enabled=v end
  function o:SetText(v) self.text=v end; function o:SetShown(v) self.shown=v end
  function o:Show() self.shown=true end; function o:Hide() self.shown=false end
  function o:SetScript(k,v) self.scripts[k]=v end
  function o:SetFont(path,size) self.font=path; self.size=size; return not self.failFont end
  function o:CreateFontString() local f=make(); self.fonts=self.fonts or {}; self.fonts[#self.fonts+1]=f; return f end
  function o:GetFontString() if not self.label then self.label=make() end; return self.label end
  return o
end
CreateFrame=function() local o=make();all[#all+1]=o;return o end
local slotCount=17
NUM_BAG_SLOTS=0; C_Container={GetContainerNumSlots=function() return slotCount end,
 GetContainerItemInfo=function(_,slot) return {itemID=slot} end}
local ns={};assert(loadfile('TheSentenced/Theme.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
local chosen;assert(ns.BoardItems.pick({},function(data) chosen=data end))
local popup=all[1];assert(popup.fonts[1].font==ns.Theme.bodyFont and popup.fonts[2].font==ns.Theme.bodyFont)
for i=2,12 do assert(all[i].label.font==ns.Theme.bodyFont,'picker label lacks Unicode font') end
local previous,nextPage,close=all[10],all[11],all[12]
assert(previous.text=='Poprzednia' and nextPage.text=='Następna' and close.text=='Zamknij')
assert(popup.fonts[2].text=='1 / 3' and not previous.enabled and nextPage.enabled)
previous.scripts.OnClick();assert(popup.fonts[2].text=='1 / 3','previous never wraps')
nextPage.scripts.OnClick();assert(all[2].data=='item:9' and popup.fonts[2].text=='2 / 3' and previous.enabled)
nextPage.scripts.OnClick();assert(all[2].data=='item:17' and popup.fonts[2].text=='3 / 3' and not nextPage.enabled)
nextPage.scripts.OnClick();assert(popup.fonts[2].text=='3 / 3','next never wraps')
previous.scripts.OnClick();assert(all[2].data=='item:9' and popup.fonts[2].text=='2 / 3')
all[2].scripts.OnClick(all[2]);assert(chosen=='item:9' and not popup.shown,'picker selection still works')
all={};slotCount=1;assert(ns.BoardItems.pick({},function() end))
assert(all[1].fonts[2].text=='1 / 1' and not all[10].enabled and not all[11].enabled,'single page disables both controls')
all[12].scripts.OnClick();assert(not all[1].shown,'close works')
slotCount=0;assert(not ns.BoardItems.pick({},function() end),'empty bags do not open the picker')
-- Failure to load the bundled face must not prevent the popup or selection.
slotCount=9
local previous=ns.Theme.font;ns.Theme.font=function() error('font unavailable') end
assert(ns.BoardItems.pick({},function() end),'missing font must not break picker')
ns.Theme.font=previous
print('BOARD_PICKER_FONT_OK: Unicode font, pagination, selection and fallback')
