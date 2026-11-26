local _, NS = ...
local M={}
NS.BoardItems=M
local linkedFields=setmetatable({},{__mode='k'})
local linkHookInstalled=false

-- Tokens have no protocol separators and cannot introduce arbitrary UI markup.
local function valid(data)
  if type(data)~='string' or #data>120 or not data:match('^item:%d+[:%d%-]*$') then return false end
  local id=tonumber(data:match('^item:(%d+)'))
  return id and id>0 and id<=100000000
end
-- Register only addon fields which actually understand item tokens. This is a
-- post-hook, so it never replaces Blizzard's function or changes its return.
function M.registerEditBox(box)
  if not box then return false end
  linkedFields[box]=true
  if linkHookInstalled then return true end
  if type(hooksecurefunc)~='function' then return false end
  local function insertLink(link)
    if type(link)~='string' then return end
    local data=link:match('|H(item:[^|]+)|h') or link:match('^(item:[%d:%-]+)$')
    if not data or not valid(data) then return end
    local focused=GetCurrentKeyBoardFocus and GetCurrentKeyBoardFocus()
    for field in pairs(linkedFields) do
      local ok,canInsert=pcall(function()
        return (not GetCurrentKeyBoardFocus or focused==field) and field:IsVisible() and field:HasFocus() and type(field.Insert)=='function'
      end)
      if ok and canInsert then pcall(field.Insert,field,'{'..data..'}'); return end
    end
  end
  local ok=false
  if ChatFrameUtil and type(ChatFrameUtil.InsertLink)=='function' then
    ok=pcall(hooksecurefunc,ChatFrameUtil,'InsertLink',insertLink)
  elseif type(ChatEdit_InsertLink)=='function' then
    ok=pcall(hooksecurefunc,'ChatEdit_InsertLink',insertLink)
  end
  linkHookInstalled=ok
  return ok
end
function M.encode(value)
  if type(value)~='string' then return '' end
  value=value:gsub('|c%x%x%x%x%x%x%x%x(|Hitem:[^|]+|h%[[^%]]*%]|h)|r','%1')
  value=value:gsub('|H(item:[^|]+)|h%[[^%]]*%]|h',function(data)
    return valid(data) and '{'..data..'}' or '[nieprawidłowy przedmiot]'
  end)
  -- %c is locale-sensitive and can match UTF-8 continuation bytes on macOS.
  return value:gsub('|',' '):gsub('[%z\1-\31\127]',' '):match('^ *(.-) *$')
end
function M.links(value)
  local result={}; if type(value)~='string' then return result end
  for data in value:gmatch('{(item:[^{}]+)}') do
    if valid(data) and #result<6 then result[#result+1]=data end
  end
  return result
end
function M.label(value)
  return (tostring(value or ''):gsub('{(item:[^{}]+)}',function(data)
    if not valid(data) then return '[nieprawidłowy przedmiot]' end
    local id=tonumber(data:match('^item:(%d+)'))
    local ok,name=pcall(function() return C_Item and C_Item.GetItemInfo and C_Item.GetItemInfo(id) end)
    if ok and type(name)=='string' and not (issecretvalue and issecretvalue(name)) then return '['..name..']' end
    return '[Przedmiot '..id..']'
  end))
end
-- Keep Blizzard item hyperlinks intact in the public guild-chat draft.
function M.chatText(value)
  return (tostring(value or ''):gsub('{(item:[^{}]+)}',function(data)
    if not valid(data) then return '[przedmiot]' end
    local getItem=C_Item and C_Item.GetItemInfo
    if getItem then
      local ok,_,link=pcall(getItem,data)
      if not ok or (not (issecretvalue and issecretvalue(link)) and not link) then ok,_,link=pcall(getItem,tonumber(data:match('^item:(%d+)'))) end
      if ok and not (issecretvalue and issecretvalue(link)) and type(link)=='string' and link:match('|Hitem:%d+') then return link end
      if C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID,tonumber(data:match('^item:(%d+)'))) end
    end
    return M.label('{'..data..'}')
  end))
end

function M.tooltip(owner,data)
  if not valid(data) or not GameTooltip then return end
  GameTooltip:SetOwner(owner,'ANCHOR_RIGHT')
  local ok=pcall(GameTooltip.SetHyperlink,GameTooltip,data)
  if ok then GameTooltip:Show() else GameTooltip:Hide() end
end
local function pickerFont(widget,size)
  -- Preserve the template font if the bundled font is unavailable.
  if NS.Theme and type(NS.Theme.font)=='function' then pcall(NS.Theme.font,widget,size,'body') end
end
-- The picker reads only carried bags; no bank access or item movement.
function M.pick(parent,onPick)
  if not (C_Container and C_Container.GetContainerNumSlots and C_Container.GetContainerItemInfo) then return false end
  local entries={}
  local quest=NS.QuestItems
  local showQuest=quest and quest.enabled()
  for bag=0,math.min(NUM_BAG_SLOTS or 4,5) do
    local ok,count=pcall(C_Container.GetContainerNumSlots,bag)
    if ok and type(count)=='number' and count>=0 and count<=100 then
      for slot=1,count do
        local good,info=pcall(C_Container.GetContainerItemInfo,bag,slot)
        if good and type(info)=='table' and type(info.itemID)=='number' then
          local data=type(info.hyperlink)=='string' and info.hyperlink:match('|H(item:[^|]+)|h') or ('item:'..info.itemID)
          if valid(data) then entries[#entries+1]={data=data,quest=showQuest and quest.isQuest(bag,slot)} end
        end
      end
    end
  end
  if #entries==0 then return false end
  local p=CreateFrame('Frame',nil,parent,'BackdropTemplate'); p:SetSize(320,330); p:SetPoint('CENTER'); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(60); p:EnableMouse(true)
  p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1}); p:SetBackdropColor(.07,.08,.10,.98); p:SetBackdropBorderColor(.65,.36,.25,1)
  local title=p:CreateFontString(nil,'OVERLAY','GameFontNormal'); title:SetPoint('TOPLEFT',12,-12); pickerFont(title,13); title:SetText('Wybierz przedmiot z toreb')
  local buttons={}; local page=1; local pages=math.ceil(#entries/8)
  local previousButton,nextButton
  local pageText=p:CreateFontString(nil,'OVERLAY','GameFontNormal'); pageText:SetPoint('BOTTOMLEFT',94,21); pageText:SetWidth(42); pageText:SetJustifyH('CENTER'); pickerFont(pageText,11)
  local function setEnabled(b,enabled)
    if type(b.SetEnabled)=='function' then b:SetEnabled(enabled)
    elseif enabled then b:Enable() else b:Disable() end
  end
  local function refresh()
    for i,b in ipairs(buttons) do
      local entry=entries[(page-1)*8+i]
      b.data=entry and entry.data
      b:SetShown(entry~=nil)
      if entry then
        local badge=entry.quest and '|cffffca5e✦|r  ' or ''
        b.label:SetText(badge..M.label('{'..entry.data..'}'))
      end
    end
    pageText:SetText(page..' / '..pages)
    setEnabled(previousButton,page>1); setEnabled(nextButton,page<pages)
  end
  for i=1,8 do
    local b=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); b:SetSize(292,26); b:SetPoint('TOPLEFT',14,-32-(i-1)*27)
    b.label=b:GetFontString(); pickerFont(b.label,12); b:SetScript('OnEnter',function(self) M.tooltip(self,self.data) end); b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
    b:SetScript('OnClick',function(self) local data=self.data; p:Hide(); onPick(data) end); buttons[i]=b
  end
  previousButton=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); previousButton:SetSize(82,27); previousButton:SetPoint('BOTTOMLEFT',10,14); pickerFont(previousButton:GetFontString(),11); previousButton:SetText('Poprzednia'); previousButton:SetScript('OnClick',function() if page>1 then page=page-1; refresh() end end)
  nextButton=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); nextButton:SetSize(80,27); nextButton:SetPoint('BOTTOMLEFT',139,14); pickerFont(nextButton:GetFontString(),11); nextButton:SetText('Następna'); nextButton:SetScript('OnClick',function() if page<pages then page=page+1; refresh() end end)
  local close=CreateFrame('Button',nil,p,'UIPanelButtonTemplate'); close:SetSize(80,27); close:SetPoint('BOTTOMRIGHT',-14,14); pickerFont(close:GetFontString(),11); close:SetText('Zamknij'); close:SetScript('OnClick',function() p:Hide() end)
  refresh(); p:Show(); return true
end
