local _,NS=...
-- Selection only: the caller supplies already-visible planner events, and keeps
-- responsibility for permissions and subsequent changes.
local M={}; NS.EventPicker=M
local picker,owner,callback,source,filtered,page,selection=nil,nil,nil,{}, {},1,nil
local PAGE_SIZE=6
local hooked=setmetatable({},{__mode='k'})
local function safe(value)
 if type(issecretvalue)~='function' then return true end
 local ok,result=pcall(issecretvalue,value); return ok and result==false
end
local function clean(value,limit)
 if not safe(value) or type(value)~='string' then return nil end
 local s=value:gsub('[|%z\001-\031\127]','')
 if #s>limit then
  local cut=limit
  while cut>0 and s:byte(cut+1) and s:byte(cut+1)>=128 and s:byte(cut+1)<=191 do cut=cut-1 end
  s=s:sub(1,cut)..'…'
 end
 return s
end
local function copyEvents(events)
 local rows,seen={},{}
 if not safe(events) or type(events)~='table' then return rows end
 local ok=pcall(function()
  for _,event in ipairs(events) do
   if #rows>=100 then break end
   if safe(event) and type(event)=='table' then
    local author,id,title,when=event.author,event.id,event.title,event.when
    if safe(author) and type(author)=='string' and #author>0 and #author<=80 and not author:find('[|%z\001-\031\127]')
      and safe(id) and type(id)=='string' and #id>0 and #id<=22 and id:match('^%d+$') then
     title,when=clean(title,100),clean(when,90)
     local key=author:lower()..'|'..id
     if title and title~='' and when and when~='' and not seen[key] then
      rows[#rows+1]={author=author,id=id,title=title,when=when}; seen[key]=true
     end
    end
   end
  end
 end)
 if not ok then return {} end
 return rows
end
local function font(parent,text,size,color)
 local f=parent:CreateFontString(nil,'OVERLAY')
 f:SetFont('Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf',size,'')
 f:SetTextColor(unpack(color)); f:SetText(text); f:SetJustifyH('LEFT')
 if f.SetWordWrap then f:SetWordWrap(false) end
 if f.SetMaxLines then f:SetMaxLines(1) end
 return f
end
local function button(parent,text,width,height,fn)
 local b=CreateFrame('Button',nil,parent,'BackdropTemplate'); b:SetSize(width,height)
 b:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
 b:SetBackdropColor(.25,.22,.18,1); b:SetBackdropBorderColor(.48,.40,.30,1)
 b.caption=font(b,text,11,{1,.72,.35}); b.caption:SetPoint('CENTER'); b.caption:SetWidth(width-12); b.caption:SetJustifyH('CENTER')
 b:SetScript('OnEnter',function(self) self:SetBackdropColor(.37,.27,.22,1) end)
 b:SetScript('OnLeave',function(self) self:SetBackdropColor(.25,.22,.18,1) end)
 b:SetScript('OnClick',fn); return b
end
local render
local function choose(index)
 local entry=filtered[index]; local fn=callback
 if not entry or not fn then return end
 local author,id=entry.author,entry.id
 M.close(); fn(author,id)
end
local function move(step)
 if #filtered==0 then return end
 selection=math.max(1,math.min(#filtered,(selection or 1)+step))
 page=math.floor((selection-1)/PAGE_SIZE)+1; render()
end
local function setPage(nextPage)
 local pages=math.max(1,math.ceil(#filtered/PAGE_SIZE))
 page=math.max(1,math.min(pages,nextPage)); selection=#filtered>0 and ((page-1)*PAGE_SIZE+1) or nil; render()
end
local function filter(value)
 if not safe(value) or type(value)~='string' then value='' end
 local query=value:lower(); filtered={}
 for _,entry in ipairs(source) do
  local text=(entry.title..' '..entry.when..' '..entry.author):lower()
  if query=='' or text:find(query,1,true) then filtered[#filtered+1]=entry end
 end
 page=1; selection=#filtered>0 and 1 or nil; render()
end
local function keyAction(key)
 if key=='ESCAPE' then M.close(); return end
 if key=='UP' then move(-1); return end
 if key=='DOWN' then move(1); return end
 if key=='PAGEUP' then setPage(page-1); return end
 if key=='PAGEDOWN' then setPage(page+1); return end
 if key=='ENTER' or key=='NUMPADENTER' then choose(selection); return end
end
local function create()
 local f=CreateFrame('Frame','TheSentencedEventPicker',UIParent,'BackdropTemplate')
 f:SetSize(620,500); f:SetPoint('CENTER',UIParent,'CENTER',0,0); f:SetFrameStrata('FULLSCREEN_DIALOG'); f:SetFrameLevel(60); f:SetClampedToScreen(true); f:EnableMouse(true)
 f:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
 f:SetBackdropColor(.065,.055,.055,1); f:SetBackdropBorderColor(.67,.39,.22,1)
 local heading=font(f,'WYBIERZ WYDARZENIE',16,{1,.72,.35}); heading:SetPoint('TOPLEFT',20,-16)
 local ok,native=pcall(CreateFrame,'EditBox',nil,f,'InputBoxTemplate')
 f.search=ok and native or CreateFrame('EditBox',nil,f,'BackdropTemplate'); f.search:SetSize(580,32); f.search:SetPoint('TOPLEFT',20,-49)
 f.search:SetAutoFocus(false); f.search:SetFont('Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf',12,''); f.search:SetTextInsets(9,9,3,3); f.search:SetMaxLetters(80)
 if not ok or not native then
  f.search:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
  f.search:SetBackdropColor(.07,.08,.10,1); f.search:SetBackdropBorderColor(.27,.29,.32,1)
 end
 f.hint=font(f,'Szukaj po nazwie, terminie lub organizatorze',10,{.68,.68,.68}); f.hint:SetPoint('TOPLEFT',28,-92)
 f.rows={}
 for i=1,PAGE_SIZE do
  local slot=i; local b=button(f,'',580,43,function() choose((page-1)*PAGE_SIZE+slot) end)
  b:SetPoint('TOPLEFT',20,-112-(i-1)*48); b.caption:SetJustifyH('LEFT'); b.caption:ClearAllPoints(); b.caption:SetPoint('TOPLEFT',10,-6); b.caption:SetWidth(556)
  b.detail=font(b,'',10,{.70,.68,.63}); b.detail:SetPoint('TOPLEFT',10,-24); b.detail:SetWidth(556); f.rows[i]=b
 end
 f.empty=font(f,'',12,{.70,.68,.63}); f.empty:SetPoint('TOPLEFT',22,-120); f.empty:SetWidth(570)
 f.prev=button(f,'<',52,29,function() setPage(page-1) end); f.prev:SetPoint('BOTTOMLEFT',20,20)
 f.page=font(f,'',11,{.70,.68,.63}); f.page:SetPoint('BOTTOMLEFT',85,28)
 f.next=button(f,'>',52,29,function() setPage(page+1) end); f.next:SetPoint('BOTTOMLEFT',150,20)
 f.close=button(f,'ANULUJ',110,29,function() M.close() end); f.close:SetPoint('BOTTOMRIGHT',-20,20)
 f.search:SetScript('OnTextChanged',function(self) filter(self:GetText()) end)
 f.search:SetScript('OnArrowPressed',function(_,key) keyAction(key) end)
 f.search:SetScript('OnEnterPressed',function() choose(selection) end)
 f.search:SetScript('OnEscapePressed',function() M.close() end)
 if f.EnableKeyboard then f:EnableKeyboard(true) end
 if f.SetPropagateKeyboardInput then f:SetPropagateKeyboardInput(false) end
 f:SetScript('OnKeyDown',function(_,key) keyAction(key) end)
 f:SetScript('OnHide',function() if f.search.ClearFocus then f.search:ClearFocus() end; owner=nil; callback=nil; source={}; filtered={}; selection=nil end)
 f:Hide(); if UISpecialFrames and tinsert then tinsert(UISpecialFrames,'TheSentencedEventPicker') end
 return f
end
render=function()
 if not picker then return end
 local pages=math.max(1,math.ceil(#filtered/PAGE_SIZE)); picker.page:SetText(page..' / '..pages)
 picker.empty:SetText(#filtered==0 and (#source==0 and 'Brak dostępnych wydarzeń w addonzie.' or 'Brak wyników wyszukiwania.') or '')
 for i,b in ipairs(picker.rows) do
  local index=(page-1)*PAGE_SIZE+i; local item=filtered[index]
  b:SetShown(item~=nil)
  if item then b.caption:SetText((index==selection and '>  ' or '')..item.title); b.detail:SetText(item.when..'  •  '..item.author) end
 end
end
function M.pick(parent,events,onSelect)
 if type(onSelect)~='function' or not UIParent or type(CreateFrame)~='function' then return false end
 if not picker then local ok,result=pcall(create); if not ok or not result then return false end; picker=result end
 if type(GetCurrentKeyBoardFocus)=='function' then
  local ok,focus=pcall(GetCurrentKeyBoardFocus)
  if ok and safe(focus) and (type(focus)=='table' or type(focus)=='userdata') then pcall(function() if type(focus.ClearFocus)=='function' then focus:ClearFocus() end end) end
 end
 if parent and type(parent.HookScript)=='function' and not hooked[parent] then
  local ok=pcall(parent.HookScript,parent,'OnHide',function(self) if self==owner then M.close() end end)
  if ok then hooked[parent]=true end
 end
 owner=parent; callback=onSelect; source=copyEvents(events); picker.search:SetText(''); filter(''); picker:Show(); picker.search:SetFocus(); return true
end
function M.close() if picker then picker:Hide() end end
