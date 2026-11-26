local _, NS = ...
local M = {}
NS.MemberPicker = M

-- A choice fills a form only. The caller must validate the member and all
-- permissions again when the user submits an operation.
local cache = setmetatable({}, {__mode='k'})
local function safe(value)
  return not (issecretvalue and issecretvalue(value))
end
local function validName(name)
  return safe(name) and type(name)=='string' and #name>0 and #name<=128
    and not name:find('[|%z\001-\031\127]')
end
local function font(widget,size)
  if NS.Theme and type(NS.Theme.font)=='function' then pcall(NS.Theme.font,widget,size,'body') end
end
local function makePicker(parent)
  -- Keep the dialog out of the scroll frame: otherwise it can be clipped or
  -- positioned outside the viewport on long pages.
  local p=CreateFrame('Frame',nil,UIParent,'BackdropTemplate')
  p:SetSize(420,410); p:SetPoint('CENTER',UIParent,'CENTER',0,0); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(60); p:EnableMouse(true)
  if p.SetClampedToScreen then p:SetClampedToScreen(true) end
  if parent.HookScript then parent:HookScript('OnHide',function() if p.search then p.search:ClearFocus() end; p:Hide(); p.callback=nil end) end
  p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
  p:SetBackdropColor(.07,.08,.10,.98); p:SetBackdropBorderColor(.65,.36,.25,1)
  local title=p:CreateFontString(nil,'OVERLAY','GameFontNormal'); title:SetPoint('TOPLEFT',14,-13); font(title,14); title:SetText('WYBIERZ OSOBĘ Z GILDII')
  local ok,native=pcall(CreateFrame,'EditBox',nil,p,'InputBoxTemplate')
  local search=ok and native or CreateFrame('EditBox',nil,p,'BackdropTemplate'); p.search=search
  if not ok or not native then
    search:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
    search:SetBackdropColor(.07,.08,.10,1); search:SetBackdropBorderColor(.27,.29,.32,1)
  end
  search:SetSize(380,28); search:SetPoint('TOPLEFT',17,-40); search:SetAutoFocus(false); search:SetMaxLetters(100); font(search,12)
  local hint=p:CreateFontString(nil,'OVERLAY','GameFontNormalSmall'); hint:SetPoint('TOPLEFT',18,-70); font(hint,10); hint:SetText('Wpisz fragment nicku, aby zawęzić listę.')
  p.rows={}
  for i=1,8 do
    local b=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); b:SetSize(380,27); b:SetPoint('TOPLEFT',18,-91-(i-1)*31)
    font(b:GetFontString(),12)
    b:SetScript('OnClick',function(self)
      local entry=self.entry; local callback=p.callback
      if not entry or type(callback)~='function' then return end
      p.search:ClearFocus(); p:Hide(); p.callback=nil
      pcall(callback,entry.name,entry)
    end)
    p.rows[i]=b
  end
  local pageText=p:CreateFontString(nil,'OVERLAY','GameFontNormalSmall'); p.pageText=pageText
  pageText:SetPoint('BOTTOM',0,52); font(pageText,11)
  local empty=p:CreateFontString(nil,'OVERLAY','GameFontNormalSmall'); p.empty=empty
  empty:SetPoint('TOPLEFT',18,-103); font(empty,11); empty:SetText('Brak osób dla tego wyszukiwania.')
  local prev=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); prev:SetSize(115,28); prev:SetPoint('BOTTOMLEFT',18,15); font(prev:GetFontString(),11); prev:SetText('Poprzednia')
  local nextButton=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); nextButton:SetSize(115,28); nextButton:SetPoint('BOTTOM',0,15); font(nextButton:GetFontString(),11); nextButton:SetText('Następna')
  local close=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); close:SetSize(115,28); close:SetPoint('BOTTOMRIGHT',-18,15); font(close:GetFontString(),11); close:SetText('Zamknij')
  p.refresh=function()
    local query=p.search:GetText() or ''
    query=safe(query) and type(query)=='string' and query:lower() or ''
    local filtered={}
    for _,entry in ipairs(p.entries) do if entry.name:lower():find(query,1,true) then filtered[#filtered+1]=entry end end
    p.pages=math.max(1,math.ceil(#filtered/8)); p.page=math.max(1,math.min(p.page or 1,p.pages))
    for i,b in ipairs(p.rows) do
      local entry=filtered[(p.page-1)*8+i]; b.entry=entry; b:SetShown(entry~=nil)
      if entry then b:SetText(entry.name) end
    end
    p.empty:SetShown(#filtered==0); p.pageText:SetText('Strona '..p.page..' / '..p.pages..'  •  '..#filtered..' osób')
    if prev.SetEnabled then prev:SetEnabled(p.page>1) end
    if nextButton.SetEnabled then nextButton:SetEnabled(p.page<p.pages) end
  end
  search:SetScript('OnTextChanged',function() p.page=1; p.refresh() end)
  search:SetScript('OnEscapePressed',function() search:ClearFocus(); p:Hide(); p.callback=nil end)
  search:SetScript('OnEnterPressed',function()
    local entry=p.rows[1] and p.rows[1].entry; local callback=p.callback
    if not entry or type(callback)~='function' then return end
    search:ClearFocus(); p:Hide(); p.callback=nil; pcall(callback,entry.name,entry)
  end)
  prev:SetScript('OnClick',function() p.page=math.max(1,p.page-1); p.refresh() end)
  nextButton:SetScript('OnClick',function() p.page=math.min(p.pages,p.page+1); p.refresh() end)
  close:SetScript('OnClick',function() p.search:ClearFocus(); p:Hide(); p.callback=nil end)
  return p
end

-- Supply fresh roster() output. No network calls, no profile data and no writes.
-- Returns false when the roster or UI is unavailable; caller can retain its
-- existing editable field as fallback and report the empty roster to the user.
function M.pick(parent,members,onPick)
  if not parent or not UIParent or type(members)~='table' or type(onPick)~='function' or type(CreateFrame)~='function' then return false end
  local entries,seen={},{}
  for _,member in ipairs(members) do
    local name=safe(member) and type(member)=='table' and member.name
    if validName(name) then
      local key=name:lower()
      if not seen[key] then entries[#entries+1]={name=name}; seen[key]=true end
    end
    if #entries>=1000 then break end
  end
  if #entries==0 then return false end
  local p=cache[parent]
  if not p then local ok,result=pcall(makePicker,parent); if not ok or not result then return false end; p=result; cache[parent]=p end
  p.entries=entries; p.callback=onPick; p.page=1; p.search:SetText(''); p.refresh(); p:Show(); p.search:SetFocus()
  return true
end
