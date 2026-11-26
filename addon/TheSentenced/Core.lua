local addonName, NS = ...
local app = CreateFrame('Frame')
local function diag(key,value) if NS.Diagnostics then pcall(NS.Diagnostics.mark,key,value) end end
local db
local ui
local page = 'START'
local rosterQuery = ''
local onlyOnline = false
local craftQuery = ''
local craftOnline = false
local resourceQuery, resourceOnline, resourcePageNumber = '', false, 1
local selectedPlayer
local profileView='OVERVIEW'
local lootQuery = ''
local lootByPlayer = false
local groups = {
  {id='HOME', label='START', pages={'START'}},
  {id='COMMUNITY', label='GILDIA I OGŁOSZENIA', pages={'GILDIA','RZEMIOSŁO','ZASOBY','TABLICA','PROFIL','DISCORD','SIEĆ','HISTORIA'}},
  {id='ADVENTURES', label='WYPRAWY I ZAPISY', pages={'WYDARZENIA','RAIDY','PRZYGOTOWANIE'}},
  {id='REWARDS', label='PRZEDMIOTY I ŁUPY', pages={'ŁUPY'}},
  {id='WORLD', label='MAPA I ODKRYCIA', pages={'MAPA'}},
  {id='PERSONAL', label='USTAWIENIA', pages={'USTAWIENIA','POSTAĆ','POMOC'}},
  {id='STAFF', label='KADRA', pages={'KADRA'}},
}
local groupIcons={HOME='INV_Misc_GroupLooking',COMMUNITY='INV_BannerPVP_01',ADVENTURES='INV_Misc_Map_01',REWARDS='INV_Misc_Coin_01',WORLD='INV_Misc_Map_01',PERSONAL='INV_Misc_EngGizmos_17',STAFF='INV_Misc_Book_11'}
local groupByPage={}
for _,group in ipairs(groups) do for _,name in ipairs(group.pages) do groupByPage[name]=group.id end end
local palette = NS.Theme and NS.Theme.palette or {}
local red = palette.red or {0.96, 0.31, 0.24}
local gold = palette.gold or {1, 0.72, 0.35}
local muted = palette.muted or {0.59, 0.64, 0.71}
local white = palette.text or {0.92, 0.93, 0.94}
local pools, counters, recycle = {}, {}, false
local function acquire(key, make, parent)
  if not recycle then return make() end
  counters[key]=(counters[key] or 0)+1
  local pool=pools[key] or {}; pools[key]=pool
  local object=pool[counters[key]]
  if not object then object=make(); pool[counters[key]]=object end
  object:SetParent(parent); object:ClearAllPoints(); object:Show()
  return object
end
local function frame(kind, parent, template)
  return acquire('frame:'..kind..':'..(template or ''),function() return CreateFrame(kind,nil,parent,template) end,parent)
end
local function texture(parent, layer)
  return acquire('texture:'..(layer or 'BACKGROUND'),function() return parent:CreateTexture(nil,layer or 'BACKGROUND') end,parent)
end
local function fontString(parent)
  return acquire('font',function() return parent:CreateFontString(nil,'OVERLAY') end,parent)
end
local function plain(v) return tostring(v or ''):gsub('|', '') end
local function tr(s) return NS.Language and NS.Language.get(s) or s end
local function preview(value,limit)
  local s=plain(value)
  if #s<=limit then return s end
  local last=limit
  while last>0 and s:byte(last+1) and s:byte(last+1)>=128 and s:byte(last+1)<=191 do last=last-1 end
  return s:sub(1,last)..'…'
end
local function log(s) diag('ui.notice'); print('|cffffb85cTHE SENTENCED|r  '..tr(s)) end
local function solid(parent, r,g,b,a, layer)
  local t = texture(parent, layer or 'BACKGROUND')
  t:SetAllPoints(parent); t:SetColorTexture(r,g,b,a or 1); return t
end
local function font(parent, text, size, color, justify)
  local f = fontString(parent)
  -- Recycled text can have a fixed width or line spacing from a previous page.
  -- Reset both before anchoring it in its new context (notably right-aligned labels).
  f:SetWidth(0); f:SetHeight(0); f:SetSpacing(0)
  local face = 'Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf'
  f:SetFont(face, size or 12, '')
  f:SetTextColor(unpack(color or white)); f:SetJustifyH(justify or 'LEFT')
  f:SetWordWrap(true); f:SetText(tr(text or '')); return f
end
local function button(parent, label, w, h, click, accent)
  local b=frame('Button',parent,'UIPanelButtonTemplate')
  b:SetSize(w,h); b:SetText('')
  local tx=font(b,label,12,accent and gold or white,'CENTER');tx:SetPoint('CENTER');tx:SetWidth(w-12);b.caption=tx
  b:SetScript('OnEnter',nil);b:SetScript('OnLeave',nil)
  b:SetScript('OnClick',function(...) if NS.Diagnostics then return NS.Diagnostics.run('ui.click',click,...) end;return click(...) end)
  return b
end

-- Use the same menu control as the game's group finder when available.
-- Older clients keep the existing buttons rather than losing the form.
local function nativeChoice(parent, labels, selected, choose, width)
  if not MenuUtil then return nil end
  local ok,dropdown=pcall(CreateFrame,'DropdownButton',nil,parent,'WowStyle1DropdownTemplate')
  if not ok or not dropdown or type(dropdown.SetupMenu)~='function' then return nil end
  dropdown:SetWidth(width or 260)
  dropdown:SetDefaultText('Wybierz')
  local menuFont='Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf'
  if dropdown.Text and dropdown.Text.SetFont then dropdown.Text:SetFont(menuFont,12,'') end
  dropdown:SetupMenu(function(_,root)
    for index,label in ipairs(labels) do
      local radio=root:CreateRadio(label,function(value) return selected()==value end,function(value) choose(value) end,index)
      if radio.AddInitializer then radio:AddInitializer(function(control)
        if control.fontString then control.fontString:SetFont(menuFont,12,'') end
      end) end
    end
  end)
  return dropdown
end

local function edit(parent, w, h, initial, placeholder)
  -- Use the game's own edit-box chrome where the client provides it.
  -- Some client builds do not ship the template, so retain a readable fallback.
  local box = acquire('edit:blizzard',function()
    local ok, native=pcall(CreateFrame,'EditBox',nil,parent,'InputBoxTemplate')
    if ok and native then native.tsNativeInput=true; return native end
    local fallback=CreateFrame('EditBox',nil,parent,'BackdropTemplate'); fallback.tsNativeInput=false; return fallback
  end,parent)
  box:SetSize(w,h); box:SetMultiLine(false); box:SetScript('OnEnterPressed',nil); box:SetAutoFocus(false); box:SetFontObject(ChatFontNormal); box:SetFont('Interface\\AddOns\\TheSentenced\\Fonts\\DejaVuSans.ttf',12,'')
  box:SetTextInsets(9,9,3,3); box:SetMaxLetters(100)
  if not box.tsNativeInput and box.SetBackdrop then
    box:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
    box:SetBackdropColor(.07,.08,.10,1); box:SetBackdropBorderColor(.27,.29,.32,1)
  end
  box:SetText(initial or ''); box:SetScript('OnEscapePressed',function(self) self:ClearFocus() end)
  local hint=font(box,placeholder or '',11,muted); hint:SetPoint('LEFT',9,0); hint:SetPoint('RIGHT',-5,0); box.hint=hint
  local function refresh(self) hint:SetShown(self:GetText()=='' and not self:HasFocus()) end
  box:SetScript('OnEditFocusGained',refresh); box:SetScript('OnEditFocusLost',refresh)
  box:SetScript('OnTextChanged',refresh); refresh(box); return box
end
local function clear()
  recycle=false
  ui.pickerGeneration=(ui.pickerGeneration or 0)+1
  for _,pool in pairs(pools) do for _,object in ipairs(pool) do object:Hide() end end
  counters={}
  if not ui.content then
    ui.content=CreateFrame('Frame',nil,ui.scrollChild)
    ui.content:SetPoint('TOPLEFT'); ui.content:SetPoint('TOPRIGHT')
  end
  ui.content:SetHeight(1); ui.y=-4; recycle=true
end
local function text(t, size, col, gap)
  local f=font(ui.content,t,size,col); f:SetPoint('TOPLEFT', 4,ui.y); f:SetWidth(625)
  f:SetSpacing(4); local h=math.max(size or 12, f:GetStringHeight()); ui.y=ui.y-h-(gap or 14)
  return f
end
local function section(kicker,title,desc)
  if kicker then text(kicker,10,gold,7) end; local heading=text(title,23,gold,9); if NS.Theme then NS.Theme.font(heading,23,'title') end
  if desc then text(desc,12,muted,20) end
end
local function bar(title, subtitle, color, click)
  local f=frame(click and 'Button' or 'Frame',ui.content); f:SetPoint('TOPLEFT',0,ui.y); f:SetSize(625,48)
  if click then f:SetScript('OnClick',click) end
  solid(f,.105,.095,.082,1); local s=texture(f,'ARTWORK'); s:SetSize(3,48); s:SetPoint('LEFT'); s:SetColorTexture(unpack(color or red))
  local divider=texture(f,'BORDER');divider:SetPoint('BOTTOMLEFT',3,0);divider:SetPoint('BOTTOMRIGHT');divider:SetHeight(1);divider:SetColorTexture(.42,.32,.20,.55)
  local t=font(f,title,13,white); t:SetPoint('TOPLEFT',13,-8); t:SetWidth(590)
  local d=font(f,subtitle or '',10,muted); d:SetPoint('TOPLEFT',13,-27); d:SetWidth(590)
  ui.y=ui.y-56; return f
end
local function finish() recycle=false; ui.content:SetHeight(math.max(1,-ui.y+15)); ui.scrollChild:SetHeight(math.max(480,-ui.y+15)); ui.scroll:SetVerticalScroll(0) end
local function roster()
  local result={}
  if not IsInGuild or not IsInGuild() or not GetNumGuildMembers or not GetGuildRosterInfo then return result end
  local n=GetNumGuildMembers() or 0
  for i=1,n do
    local name, rank, rankIndex, level, className, zone, note, officerNote, online, status, class=GetGuildRosterInfo(i)
    if issecretvalue and issecretvalue(note) then note=nil end
    if name then result[#result+1]={name=name,rank=rank,rankIndex=rankIndex,level=level,className=className,zone=zone,note=note,online=online,class=class} end
  end
  table.sort(result,function(a,b)
    if not not a.online ~= not not b.online then return a.online and true or false end
    return a.name:lower()<b.name:lower()
  end)
  return result
end
local function requestRoster()
  if C_GuildInfo and C_GuildInfo.GuildRoster and IsInGuild and IsInGuild() then C_GuildInfo.GuildRoster() end
end
local function addAction(label, callback, width)
  local b=button(ui.content,label,width or 200,32,callback,true); b:SetPoint('TOPLEFT',4,ui.y); ui.y=ui.y-42; return b
end
local function getProfessions()
  local labels={}
  for _,entry in ipairs(NS.NativeProfessions and NS.NativeProfessions.own() or {}) do
    labels[#labels+1]=entry.name..(entry.rank and ('  '..entry.rank..(entry.max and (' / '..entry.max) or '')) or '')
  end
  return labels
end

local render,openProfilePopup,openCraftRequest,showPlannerCompose
local function feature(key)
  return not db or type(db.options)~='table' or db.options[key]~=false
end
NS.FeatureEnabled=feature
local function canManageGuildEntry(actor,author)
  return actor and (actor.rankIndex==0 or actor.name:lower()==author:lower())
end

local guildKey,member,me
local function start()
  local members=roster(); local online=0
  for _,m in ipairs(members) do if m.online then online=online+1 end end
  local guild=GetGuildInfo and GetGuildInfo('player') or nil
  local key=guildKey()
  local plans=feature('planner') and key and db.planners and db.planners[key]
  local board=feature('board') and key and db.boards and db.boards[key]
  local finds=key and db.finds and db.finds[key]
  local eventCount,findCount,lootCount=0,0,0
  local latestEvent, nextEvent
  local today=date and date("%Y-%m-%d") or nil
  for _,e in pairs((plans and plans.items) or {}) do
    eventCount=eventCount+1
    if not latestEvent or (tostring(e.id)>tostring(latestEvent.id)) then latestEvent=e end
    local day=type(e.when)=="string" and e.when:match("^(%d%d%d%d%-%d%d%-%d%d)")
    if day and today and day>=today and (not nextEvent or tostring(e.when)<tostring(nextEvent.when)) then nextEvent=e end
  end
  for _,e in pairs((finds and finds.items) or {}) do
    if e.type=='MAP' then findCount=findCount+1 elseif e.type=='LOOT' then lootCount=lootCount+1 end
  end
  local boardCount=board and board.items and #board.items or 0
  local ready=0; for i=1,6 do if db.checks[i] then ready=ready+1 end end
  local hero=frame('Frame',ui.content); hero:SetPoint('TOPLEFT',0,ui.y); hero:SetSize(625,76)
  solid(hero,.12,.13,.16,1)
  local crestArt=texture(hero,'ARTWORK');crestArt:SetSize(62,62);crestArt:SetPoint('RIGHT',-12,0);crestArt:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\GuildCrest.tga');crestArt:SetAlpha(1)
  local glow=texture(hero,'ARTWORK'); glow:SetPoint('TOPLEFT',0,0); glow:SetSize(3,76); glow:SetColorTexture(.98,.36,.22,1); ui.heroLight=glow
  local title=font(hero,'Centrum gildii',24,gold); title:SetPoint('TOPLEFT',20,-13);if NS.Theme then NS.Theme.font(title,24,'title') end
  local desc=font(hero,guild and plain(guild) or 'Dołącz do gildii',13,muted)
  desc:SetPoint('TOPLEFT',21,-49);desc:SetWidth(490)
  local alpha=font(hero,'ALFA  0.6.38',10,gold); alpha:SetPoint('TOPRIGHT',-102,-18)
  ui.y=ui.y-86
  local shortcuts={{'RAJDY I WYPRAWY','WYDARZENIA'},{'LUDZIE I PROFESJE','RZEMIOSŁO'},{'POŁĄCZENIE DISCORD','DISCORD'}}
  for i,v in ipairs(shortcuts) do
    local b=button(ui.content,v[1],200,32,function() page=v[2]; render() end,true)
    b:SetPoint('TOPLEFT',4+(i-1)*207,ui.y)
  end
  ui.y=ui.y-43
  local stats={
    {tostring(online)..' / '..#members,'GILDIA ONLINE'},
    {tostring(eventCount),'WYDARZENIA ADDONA'},
    {tostring(boardCount),'OGŁOSZENIA'},
  }
  local statIcons={'Interface\\Icons\\INV_Misc_GroupLooking','Interface\\Icons\\INV_Misc_Map_01','Interface\\Icons\\INV_Misc_Note_01'}
  for i,s in ipairs(stats) do
    local f=frame('Frame',ui.content); f:SetPoint('TOPLEFT',(i-1)*210,ui.y); f:SetSize(205,54); solid(f,.13,.14,.17,1)
    local icon=texture(f,'ARTWORK'); icon:SetSize(32,32); icon:SetPoint('RIGHT',-12,0); icon:SetTexture(statIcons[i])
    local number=font(f,s[1],20,white); number:SetPoint('TOPLEFT',14,-5)
    local label=font(f,s[2],11,white); label:SetPoint('TOPLEFT',14,-33)
    if i==1 and #members>0 then
      local track=texture(f,'ARTWORK'); track:SetPoint('BOTTOMLEFT',14,3); track:SetSize(110,3); track:SetColorTexture(.25,.20,.13,1)
      if online>0 then local fill=texture(f,'OVERLAY'); fill:SetPoint('BOTTOMLEFT',14,3); fill:SetSize(110*online/#members,3); fill:SetColorTexture(.35,.8,.35,1) end
    end
  end
  ui.y=ui.y-65
  local function homeBar(title,subtitle,color,destination)
    local f=frame(destination and 'Button' or 'Frame',ui.content); f:SetPoint('TOPLEFT',0,ui.y); f:SetSize(625,44)
    if destination then
      f:SetScript('OnClick',function() page=destination; render() end)
      f:SetHighlightTexture('Interface\\QuestFrame\\UI-QuestTitleHighlight')
      local arrow=font(f,'›',19,gold); arrow:SetPoint('RIGHT',-13,1)
    end
    solid(f,.112,.12,.146,1)
    local mark=texture(f,'ARTWORK'); mark:SetSize(3,44); mark:SetPoint('LEFT'); mark:SetColorTexture(unpack(color))
    local label=font(f,title,12,white); label:SetPoint('TOPLEFT',13,-4); label:SetWidth(565)
    local detail=font(f,subtitle,11,white); detail:SetPoint('TOPLEFT',13,-21); detail:SetWidth(565)
    ui.y=ui.y-50
  end
  local shownEvent=nextEvent or latestEvent
  homeBar(nextEvent and 'NAJBLIŻSZE WYDARZENIE' or 'OSTATNIO DODANE WYDARZENIE', shownEvent and preview(plain(shownEvent.title)..'  •  '..plain(shownEvent.when),95) or 'Nie odebrano jeszcze wydarzeń gildii.',red,'WYDARZENIA')
  local snapshot=NS.GuildAccess and NS.GuildAccess.snapshot()
  local now=GetServerTime and GetServerTime() or 0
  if type(snapshot)=='table' and snapshot.schema==1 and type(snapshot.generatedAt)=='number' and snapshot.generatedAt>0 then
    local nearest
    for _,list in ipairs({snapshot.raids or {},snapshot.expeditions or {}}) do
      if type(list)=='table' then for _,item in ipairs(list) do
        if type(item)=='table' and type(item.title)=='string' and type(item.when)=='number' and item.when>=now and (not nearest or item.when<nearest.when) then nearest=item end
      end end
    end
    if nearest then
      local stamp=date and date('%Y-%m-%d %H:%M',nearest.when) or tostring(nearest.when)
      local stale=type(now)=='number' and now>0 and (now-snapshot.generatedAt>1200 or snapshot.generatedAt>now+300)
      homeBar('NAJBLIŻSZE Z DISCORDA',preview(plain(nearest.title)..'  •  '..stamp..(stale and '  •  dane mogą być nieaktualne' or ''),95),gold,'DISCORD')
    end
  end
  local latestPost=boardCount>0 and board.items[1] or nil
  local latestPostText=latestPost and latestPost.text
  if latestPostText and NS.BoardItems and NS.BoardItems.label then latestPostText=NS.BoardItems.label(latestPostText) end
  homeBar('NAJNOWSZE OGŁOSZENIE',latestPost and preview(plain(latestPostText)..'  •  '..plain(latestPost.sender),95) or 'Brak odebranych ogłoszeń.',gold,'TABLICA')
  homeBar('ODKRYCIA I ŁUPY',findCount..' miejsc  •  '..lootCount..' zgłoszeń łupów  •  zapisane na tej postaci',red,'MAPA')
  homeBar('PRZED WYPRAWĄ  /  '..ready..' / 6','Twoja prywatna lista przygotowania.',gold,'PRZYGOTOWANIE')
  local motd
  if guild and type(GetGuildRosterMOTD)=='function' then
    local ok,value=pcall(GetGuildRosterMOTD)
    if ok and type(value)=='string' and value~='' then motd=value end
  end
  text('WIADOMOŚĆ DNIA GILDII',11,gold,5)
  text(motd and plain(motd) or (guild and 'Brak wiadomości dnia lub dane nie zostały jeszcze pobrane.' or 'Dołącz do gildii, aby zobaczyć wiadomość dnia.'),12,white,12)
  text('KLASY ONLINE  /  ROSTER WOW',11,gold,5)
  local classes={}
  for _,m in ipairs(members) do
    if m.online then
      local key=(type(m.class)=='string' and m.class~='') and m.class or (m.className or 'UNKNOWN')
      if not classes[key] then classes[key]={name=(m.className and m.className~='') and m.className or 'Nieznana klasa',token=m.class,count=0} end
      classes[key].count=classes[key].count+1
    end
  end
  local rows={}; for _,row in pairs(classes) do rows[#rows+1]=row end
  table.sort(rows,function(x,y) if x.count~=y.count then return x.count>y.count end return x.name<y.name end)
  if #rows>5 then
    local rest=0; for i=6,#rows do rest=rest+rows[i].count end
    for i=#rows,6,-1 do rows[i]=nil end
    rows[#rows+1]={name='Pozostałe',count=rest}
  end
  if #rows==0 then text('Brak danych o klasach online w rosterze.',12,white,12) else
    for _,row in ipairs(rows) do
      local y=ui.y
      local label=font(ui.content,plain(row.name)..'  —  '..row.count,11,white); label:SetPoint('TOPLEFT',4,y); label:SetWidth(200)
      local base=texture(ui.content,'BACKGROUND'); base:SetPoint('TOPLEFT',215,y-1); base:SetSize(340,12); base:SetColorTexture(.16,.13,.09,1)
      local fill=texture(ui.content,'ARTWORK'); fill:SetPoint('TOPLEFT',215,y-1); fill:SetSize(340*row.count/online,12); fill:SetTexture('Interface\\TargetingFrame\\UI-StatusBar')
      local c=RAID_CLASS_COLORS and row.token and RAID_CLASS_COLORS[row.token]
      fill:SetVertexColor(c and c.r or .75,c and c.g or .55,c and c.b or .25,1)
      ui.y=ui.y-20
    end
    ui.y=ui.y-8
  end
  text('Liczby obejmują dane odebrane przez tę postać. Historia może być niepełna; synchronizacja offline nie działa jeszcze automatycznie.',11,muted)
end
local function guildPage()
  section('SPOŁECZNOŚĆ  /  ROSTER','Ludzie gildii','Dane i publiczne notatki z gry. Wyszukaj poziom, np. 40, 40-50 lub >=55.')
  local searchEnabled=feature('rosterSearch')
  if searchEnabled then
  local search=edit(ui.content,310,31,rosterQuery,'Nick, klasa, notatka, poziom...'); search:SetPoint('TOPLEFT',4,ui.y)
  search:SetScript('OnEnterPressed',function(self) rosterQuery=self:GetText(); self:ClearFocus(); render() end)
  local searchBtn=button(ui.content,'SZUKAJ',90,31,function() rosterQuery=search:GetText(); render() end); searchBtn:SetPoint('LEFT',search,'RIGHT',7,0)
  local filter=button(ui.content,onlyOnline and 'ONLINE: TAK' or 'ONLINE: WSZYSCY',165,31,function() onlyOnline=not onlyOnline; rosterQuery=search:GetText(); render() end); filter:SetPoint('LEFT',searchBtn,'RIGHT',7,0)
  ui.y=ui.y-43
  end
  if not IsInGuild or not IsInGuild() then text('Twoja postać nie należy obecnie do gildii.',13,muted); return end
  local all=roster(); local shown=0; local q=rosterQuery
  for _,m in ipairs(all) do
    if not searchEnabled or ((not onlyOnline or m.online) and NS.RosterSearch.matches(m,q)) then
      shown=shown+1
      local subtitle=plain(m.className)..'  •  '..plain(m.rank)..'  •  '..plain(m.zone)
      if type(m.note)=='string' and m.note~='' then subtitle=subtitle..'  •  '..preview(m.note,40) end
      subtitle=preview(subtitle,72)
      local f=bar((m.online and '|cff70e3a5●|r  ' or '|cff77808c●|r  ')..plain(m.name)..'  |cff9aa4b1'..plain(m.level)..'|r',subtitle,m.online and {0.3,.75,.53} or {.3,.33,.37},function() selectedPlayer=m.name; profileView='OVERVIEW'; if openProfilePopup then openProfilePopup(m.name) end end)
      local b=button(f,'SZEPT',73,27,function() if ChatFrame_SendTell then ChatFrame_SendTell(m.name) else log('Otwórz szept ręcznie: '..plain(m.name)) end end)
      b:SetPoint('RIGHT',-88,0)
      local profile=button(f,'PROFIL',74,27,function() selectedPlayer=m.name; profileView='OVERVIEW'; if openProfilePopup then openProfilePopup(m.name) end end)
      profile:SetPoint('RIGHT',-8,0)
    end
  end
  if shown==0 then text(#all==0 and 'Roster jeszcze się ładuje lub nie jest dostępny. Użyj przycisku odświeżania.' or 'Brak wyników dla wybranego filtra.',12,muted) end
  addAction('ODŚWIEŻ ROSTER',function() requestRoster(); log('Prośba o odświeżenie rosteru została wysłana.') end)
end
local function craftPage()
  local en=NS.Language and NS.Language.language()=='en'
  section(en and 'COMMUNITY  /  PROFESSIONS' or 'SPOŁECZNOŚĆ  /  PROFESJE',en and 'Find a crafter' or 'Znajdź rzemieślnika',en and 'Guild roster professions and voluntarily shared profiles. Data may be incomplete.' or 'Profesje z rosteru gry i dobrowolnych profili. Dane mogą być niepełne.')
  local search=edit(ui.content,310,31,craftQuery,en and 'Character or profession...' or 'Postać lub profesja...'); search:SetPoint('TOPLEFT',4,ui.y)
  local function apply() craftQuery=search:GetText(); search:ClearFocus(); render() end
  search:SetScript('OnEnterPressed',apply)
  local find=button(ui.content,en and 'SEARCH' or 'SZUKAJ',90,31,apply); find:SetPoint('LEFT',search,'RIGHT',7,0)
  local filter=button(ui.content,craftOnline and (en and 'ONLINE: YES' or 'ONLINE: TAK') or (en and 'ONLINE: ALL' or 'ONLINE: WSZYSCY'),165,31,function() craftQuery=search:GetText(); craftOnline=not craftOnline; render() end); filter:SetPoint('LEFT',find,'RIGHT',7,0)
  ui.y=ui.y-43
  addAction(en and 'REQUEST CRAFTING' or 'POPROŚ O WYTWORZENIE',function()if openCraftRequest then openCraftRequest() end end,250)
  local native=NS.NativeProfessions and NS.NativeProfessions.read(C_Club)
  local rows=NS.CraftDirectory.search(roster(),NS.Profiles and NS.Profiles.get,craftQuery,craftOnline,native)
  if #rows==0 then text(en and 'No matching professions. Guild data may still be loading.' or 'Brak pasujących profesji. Dane gildii mogą się jeszcze wczytywać.',12,muted) end
  for _,row in ipairs(rows) do
    local person=row.member
    local seen=row.source=='game' and (en and 'Game roster • skill level unknown' or 'Roster gry • poziom profesji nieznany') or (en and 'Received: unknown' or 'Odebrano: nieznana data')
    if row.received and row.received>0 and date then local ok,value=pcall(date,'%Y-%m-%d %H:%M',row.received); if ok and type(value)=='string' then seen=(en and 'Received: ' or 'Odebrano: ')..value end end
    local f=bar(plain(person.name)..'  •  '..plain(row.profession),seen..(person.online and '  •  ONLINE' or '  •  OFFLINE'),person.online and gold or muted)
    local whisper=button(f,en and 'WHISPER' or 'SZEPT',90,27,function() if ChatFrame_SendTell then ChatFrame_SendTell(person.name) else log('Otwórz szept ręcznie: '..plain(person.name)) end end); whisper:SetPoint('RIGHT',-8,0)
  end
  text(en and 'Recipes and availability are not verified. Ask the player before ordering.' or 'Receptury i dostępność nie są sprawdzane. Zapytaj gracza przed złożeniem prośby.',11,muted)
end
local function isGuildOfficer()
  if not (IsInGuild and IsInGuild() and GetGuildInfo) or (NS.GuildAccess and not NS.GuildAccess.isMember()) then return false end
  local _,rank,index=GetGuildInfo('player')
  if issecretvalue and (issecretvalue(rank) or issecretvalue(index)) then return false end
  return index==0 or type(rank)=='string' and (rank:lower()=='officer' or rank:lower()=='oficer')
end

local function transferFields(initial,onResult,staff)
  text('Skopiuj kod do /bot → Addon → Synchronizacja dodatku na Discordzie.',11,muted,8)
  local outgoing=edit(ui.content,615,31,NS.TransferSync.code(staff),'Tutaj pojawi się kod żądania')
  outgoing:SetPoint('TOPLEFT',4,ui.y);outgoing:SetMaxLetters(1200)
  outgoing:SetScript('OnEditFocusGained',function(self) self:HighlightText() end)
  ui.y=ui.y-43
  text('Otwórz plik z odpowiedzią bota, skopiuj całość i wczytaj tutaj.',11,muted,8)
  local incoming=edit(ui.content,470,31,initial,'Odpowiedź TSB1 od bota')
  incoming:SetPoint('TOPLEFT',4,ui.y);incoming:SetMaxLetters(16384)
  local apply=button(ui.content,'WCZYTAJ',130,31,function()
    local code=incoming:GetText()
    incoming:ClearFocus()
    onResult(code)
  end)
  apply:SetPoint('LEFT',incoming,'RIGHT',10,0);ui.y=ui.y-43
end

local transferDraft,pairDraft='',''
local manualDiscordOpen=false
local function discordPage()
  section('THE SENTENCED / DISCORD','Połączenie z Discordem','Wydarzenia i zapisy gildii w jednym miejscu.')
  if NS.GuildAccess and not NS.GuildAccess.isMember() then
    text('Połączenie jest dostępne dla aktywnych członków The Sentenced w WoW Forever.',12,muted)
    return
  end
  local auto = NS.GuildAccess and NS.GuildAccess.snapshot()
  local status = db.autoDiscord == false and 'Wyłączony' or auto and ('Odczyt: '..date('%d.%m %H:%M',auto.generatedAt)) or 'Czeka na program towarzyszący'
  text('Automatyczne dane z Discorda: '..status,12,gold)
  if auto then
    for _,raid in ipairs(auto.raids or {}) do
      if type(raid.title)=='string' and type(raid.when)=='number' then
        bar(plain(raid.title),date('%d.%m %H:%M',raid.when)..'  •  Wydarzenie Discord',gold)
      end
    end
    for _,run in ipairs(auto.expeditions or {}) do
      if type(run.title)=='string' and type(run.when)=='number' then
        bar(plain(run.title),date('%d.%m %H:%M',run.when)..'  •  Wyprawa Discord',gold)
      end
    end
  end
  if auto then
    addAction(manualDiscordOpen and 'UKRYJ KODY RĘCZNE' or 'PAROWANIE I ZAPISY RĘCZNE',function()
      manualDiscordOpen=not manualDiscordOpen
      render()
    end,285)
    if not manualDiscordOpen then return end
  end
  text('Przy pierwszym połączeniu użyj na Discordzie /bot → Addon → Połącz addon.',12,white)
  local pair=edit(ui.content,310,31,pairDraft,'Jednorazowy kod parowania (18 znaków)'); pair:SetPoint('TOPLEFT',4,ui.y);pair:SetMaxLetters(18)
  local function prepare(operation,payload)
    local code,err=NS.TransferSync.request(operation,payload); if not code then log(err);return end
    transferDraft='';render()
  end
  local connect=button(ui.content,'POŁĄCZ',125,31,function()pairDraft=pair:GetText();prepare('pair',pairDraft)end);connect:SetPoint('LEFT',pair,'RIGHT',10,0);ui.y=ui.y-42
  addAction('POBIERZ AKTUALNE DANE',function()prepare('snapshot','')end,260)
  transferFields(transferDraft,function(code)
    local ok,message=NS.TransferSync.accept(code)
    log(message)
    transferDraft=ok and '' or code
    if ok then render() end
  end)
  local data=NS.TransferSync.snapshot()
  if data then
    text('POŁĄCZONO: '..plain(data.label)..' • '..date('%d.%m %H:%M',data.generatedAt),11,gold)
    text('Zapisy z Discorda. Wybór przygotuje żądanie; zmiana nastąpi po przesłaniu kodu botowi. Zamknięte zapisy są tylko do odczytu.',11,muted)
    for _,raid in ipairs(data.raids)do
      local r=raid
      local f=bar(preview(r.title,34),date('%d.%m %H:%M',r.when)..' • '..(r.ownStatus~='' and r.ownStatus or 'brak zapisu')..' • '..r.status,gold)
      if r.status=='ACTIVE' then
        for i,v in ipairs({{'TAK','YES'},{'MOŻE','MAYBE'},{'NIE','NO'}})do
          local status=v[2];local b=button(f,v[1],75,27,function()prepare('raid.signup',r.id..':'..status..':'..r.revision)end);b:SetPoint('RIGHT',-8-(3-i)*80,0)
        end
      end
    end
  end
  text('POWITANIA W GRZE',10,gold)
  local pending=NS.GuildWelcome and NS.GuildWelcome.pending()or {}
  text('Kolejka właściciela: '..#pending..'. Pobierana lokalnym mostem po /reload. Enter wysyła wiadomość w Twoim imieniu na /g.',11,muted)
  if #pending>0 then addAction('PRZYGOTUJ POWITANIE /g',function()local _,message=NS.GuildWelcome.prepare();log(message)end,300)end
end
local staffApplication,staffDecision,staffStatus
local function staffPage()
  if not isGuildOfficer() then return end
  section(nil,'Kadra gildii','Wnioski rekrutacyjne i wiadomości na Discordzie.')
  addAction(ui.staffPostMode and 'WNIOSKI REKRUTACYJNE' or 'NAPISZ NA DISCORDZIE',function()
    ui.staffPostMode=not ui.staffPostMode;ui.staffPostConfirm=false;render()
  end,240)
  local bridge=NS.TransferSync
  local automatic,automaticStatus=bridge.localStaff()
  local manual=bridge.staffSnapshot()
  local data=manual or automatic
  local function request(operation,payload)
    local code,problem=bridge.request(operation,payload)
    staffStatus=code and 'Żądanie oczekuje na przesłanie do bota.' or problem
    staffDecision=nil
    render()
  end
  local reviewPage=data and data.page or 1
  local awaiting=bridge.waitingForStaffBridge()
  if automatic then
    text('Połączono z lokalnym synchronizatorem. Kolejka odświeża się po przeładowaniu gry.',12,gold,9)
    addAction(awaiting and 'ZAPISZ I PRZEŁADUJ' or 'ODŚWIEŻ PO PRZEŁADOWANIU',function() ReloadUI() end,275)
  elseif not ui.staffPostMode then
    addAction('POBIERZ WNIOSKI',function() request('staff.review.list',tostring(reviewPage)) end,205)
  end
  if awaiting then text('Operacja oczekuje na potwierdzenie bota po zapisaniu danych gry.',12,gold,9) end
  if staffStatus or automaticStatus then text(staffStatus or automaticStatus,12,gold) end
  if automatic then
    addAction(ui.staffManual and 'UKRYJ KODY RĘCZNE' or 'POKAŻ KODY RĘCZNE',function() ui.staffManual=not ui.staffManual; render() end,240)
  end
  if ui.staffPostMode then
    local channels={'general','calendar','expeditions','addons'}
    local labels={'#ogólny','#kalendarz','#wyprawy','#addon-the-sentenced'}
    local selected=ui.staffPostChannel or 1
    section(nil,'Wiadomość kadry','Bot podpisze wpis nazwą kadry. Tekst i linki w jednym wierszu.')
    local choose=function(index) ui.staffPostChannel=index;ui.staffPostConfirm=false;render() end
    local picker=nativeChoice(ui.content,labels,function() return selected end,choose,270)
    if picker then picker:SetPoint('TOPLEFT',4,ui.y);ui.y=ui.y-37
    else addAction(labels[selected]..'  ▸',function() choose(selected%#channels+1) end,270) end
    local input=edit(ui.content,600,31,ui.staffPostBody or '','Wpisz wiadomość')
    input:SetMaxLetters(380);input:SetPoint('TOPLEFT',4,ui.y);ui.y=ui.y-43
    local updateHint=input:GetScript('OnTextChanged')
    input:SetScript('OnTextChanged',function(box) updateHint(box);ui.staffPostBody=box:GetText() end)
    if ui.staffPostConfirm then
      local payload=ui.staffPostConfirm
      text('Opublikować w '..labels[selected]..'?',12,gold)
      addAction('PRZEKAŻ BOTOWI',function()
        local current=bridge.staffPostPayload(channels[selected],input:GetText())
        ui.staffPostConfirm=false
        if current~=payload then staffStatus='Treść zmieniła się. Sprawdź podgląd ponownie.';render();return end
        if automatic and not ui.staffManual then
          local _,message=bridge.queueLocalPost(payload);staffStatus=message;render()
        else request('staff.post',payload) end
      end,210)
      addAction('ANULUJ',function() ui.staffPostConfirm=false;render() end,120)
    else
      addAction('SPRAWDŹ PRZED WYSŁANIEM',function()
        local payload,problem=bridge.staffPostPayload(channels[selected],input:GetText())
        ui.staffPostConfirm=payload;staffStatus=problem;render()
      end,270)
    end
  end
  if not automatic or ui.staffManual then
    transferFields('',function(code)
      local ok,message=bridge.accept(code,true)
      staffStatus=message
      if ok then staffApplication=nil;staffDecision=nil end
      render()
    end,true)
  end
  if ui.staffPostMode or not data then return end
  section(nil,'Oczekujące wnioski',date('Stan Discorda z %d.%m %H:%M',data.generatedAt))
  for _,application in ipairs(data.applications) do
    local entry=application
    local opened=staffApplication==entry.id
    local card=bar(preview(entry.name,40),nil,opened and gold or muted)
    local inspect=button(card,opened and 'ZWIŃ' or 'ZOBACZ WNIOSEK',165,29,function()
      if opened then staffApplication=nil else staffApplication=entry.id end
      staffDecision=nil
      render()
    end)
    inspect:SetPoint('RIGHT',-8,0)
    if opened then
      for _,field in ipairs(entry.fields) do
        text(plain(field.label),11,gold)
        text(plain(field.value),12,white,8)
      end
      if staffDecision then
        local chosen=staffDecision
        text((chosen=='approve' and 'Przyjąć ' or 'Odrzucić wniosek ')..plain(entry.name)..'?',12,gold,5)
        addAction(automatic and 'PRZEKAŻ DECYZJĘ' or 'PRZYGOTUJ DECYZJĘ',function()
          local payload=table.concat({reviewPage,chosen,entry.id,entry.revision},':')
          if automatic and not ui.staffManual then
            local _,message=bridge.queueLocalDecision(payload)
            staffStatus=message;staffDecision=nil;render()
          else request('staff.review.decide',payload) end
        end,230)
        addAction('ANULUJ',function() staffDecision=nil; render() end,120)
      else
        local accept=button(ui.content,'AKCEPTUJ',140,31,function() staffDecision='approve'; render() end,true)
        accept:SetPoint('TOPLEFT',4,ui.y)
        local decline=button(ui.content,'ODRZUĆ',140,31,function() staffDecision='reject'; render() end)
        decline:SetPoint('LEFT',accept,'RIGHT',10,0)
        ui.y=ui.y-42
      end
    end
  end
  if #data.applications==0 then text('Brak wniosków na tej stronie.',12,muted) end
  if reviewPage>1 then addAction('POPRZEDNIA STRONA',function() request('staff.review.list',tostring(reviewPage-1)) end,220) end
  if data.hasMore then addAction('NASTĘPNA STRONA',function() if automatic then ui.staffManual=true end; request('staff.review.list',tostring(reviewPage+1)) end,220) end
end

local function showPrivateEvent(e)
  if not ui.privateEventPopup then
    local saved=recycle; recycle=false
    local p=CreateFrame('Frame','TheSentencedPrivateEvent',UIParent,'BackdropTemplate')
    p:SetSize(440,205); p:SetPoint('CENTER',UIParent,'CENTER',0,0); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(20); p:SetClampedToScreen(true); p:EnableMouse(true)
    p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1}); p:SetBackdropColor(.07,.08,.10,.98); p:SetBackdropBorderColor(.65,.36,.25,1)
    p.title=font(p,'',16,gold); p.title:SetPoint('TOPLEFT',16,-18); p.title:SetWidth(400)
    p.when=font(p,'',12,white); p.when:SetPoint('TOPLEFT',16,-55); p.when:SetWidth(400)
    local info=font(p,'Prywatny plan na tej postaci. Nie ma zapisów ani synchronizacji.',11,muted); info:SetPoint('TOPLEFT',16,-95); info:SetWidth(400)
    local close=button(p,'ZAMKNIJ',120,30,function() p:Hide() end); close:SetPoint('BOTTOMRIGHT',-16,16)
    tinsert(UISpecialFrames,'TheSentencedPrivateEvent'); ui.privateEventPopup=p; recycle=saved
  end
  local p=ui.privateEventPopup; p.title:SetText(plain(e.title)); p.when:SetText(plain(e.when)); p:Show()
end
local privateTitleField,privateWhenField
local privateDraftTitle,privateDraftWhen='',''
local function eventsPage()
  section('PLANER GILDII','Wydarzenia gildii','Zorganizuj wyprawę, sprawdź zapisy i przejdź do kalendarza.')
  addAction('+ NOWE WYDARZENIE',function() showPlannerCompose() end,250)
  addAction('OTWÓRZ KALENDARZ GRY',function()
    if type(ToggleCalendar)~='function' then log('Kalendarz gry jest niedostępny w tym kliencie.');return end
    local ok=pcall(ToggleCalendar);if not ok then log('Nie udało się otworzyć kalendarza gry.') end
  end,230)
  addAction('ODŚWIEŻ KALENDARZ GRY',function()
    if not NS.GameCalendar.refresh() then log('Kalendarz gry jest niedostępny w tym kliencie.');return end
    log('Wczytywanie kalendarza gry. Jeśli lista jest pusta, odśwież ją ponownie za chwilę.')
    if C_Timer and C_Timer.After then C_Timer.After(1,function()if ui and ui.root:IsShown() and page=='WYDARZENIA' and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render()end end)end
  end,230)
  local gameEvents,gameStatus=NS.GameCalendar.events()
  text('WYDARZENIA Z KALENDARZA GRY',10,gold,8)
  if not gameEvents then text('Kalendarz gildii jest niedostępny w tym kliencie.',11,muted)
  elseif #gameEvents==0 then text('Nie odebrano wydarzeń. Odśwież kalendarz; pusta lista nie potwierdza braku wpisów.',11,muted)
  else
    for i=1,math.min(#gameEvents,10) do local e=gameEvents[i];bar(preview(e.title,90),e.when..'  •  czas gry',gold) end
    if #gameEvents>10 or gameStatus=='partial' then text('Widok jest skrócony lub niepełny. Otwórz kalendarz gry, aby zobaczyć całość.',11,muted) end
  end
  if feature('calendar') then text('W szczegółach wyprawy wybierz Do kalendarza, aby skopiować ją z zaproszeniami.',11,muted) end
  text('WYDARZENIA Z DISCORDA',10,gold,8)
  local bridge=NS.GuildAccess and NS.GuildAccess.snapshot()
  if type(bridge)~='table' or bridge.schema~=1 or type(bridge.generatedAt)~='number' or bridge.generatedAt<=0 then
    text('Brak danych z lokalnego mostu Discord. Ta funkcja jest obecnie dostępna tylko na skonfigurowanym komputerze.',11,muted)
  else
    local clock=(GetServerTime and GetServerTime()) or 0
    if type(clock)=='number' and clock>0 and (bridge.generatedAt>clock+300 or clock-bridge.generatedAt>1200) then text('Dane z Discorda są nieaktualne. Most aktualizuje plik; gra wczytuje go po przeładowaniu interfejsu.',11,muted)
    else text('Odczyt z lokalnego mostu. Zmiany pojawią się po przeładowaniu interfejsu.',11,muted) end
    local shown=0
    for _,group in ipairs({{bridge.raids,'RAID'},{bridge.expeditions,'WYPRAWA'}}) do
      if type(group[1])=='table' then for i=1,math.min(#group[1],10) do
        local e=group[1][i]
        if type(e)=='table' and type(e.title)=='string' and type(e.when)=='number' and type(e.id)=='number' then
          local when=tostring(e.when);if date then local ok,value=pcall(date,'%Y-%m-%d %H:%M',e.when);if ok and type(value)=='string' then when=value end end
          bar(group[2]..'  •  '..preview(e.title,70),(group[2]=='RAID' and 'Termin: ' or 'Ważna do: ')..when..'  •  Discord #'..e.id,gold);shown=shown+1
        end
      end end
    end
    if shown==0 then text('Brak przyszłych raidów i otwartych wypraw w ostatniej migawce.',11,muted) end
  end
  NS.renderPlanner()
  section('PLANER  /  TYLKO TY','Prywatne notatki','Tylko na tej postaci. Nie są wydarzeniami gildii i nie mają zapisów.')
  local title=edit(ui.content,220,32,privateDraftTitle,'Nazwa, np. Raid / Dungeon'); title:SetPoint('TOPLEFT',4,ui.y)
  local when=edit(ui.content,200,32,privateDraftWhen,'Termin, np. sobota 20:00'); when:SetPoint('LEFT',title,'RIGHT',8,0)
  privateTitleField,privateWhenField=title,when
  local add=button(ui.content,'ZAPISZ NOTATKĘ',145,32,function()
    local t=title:GetText():match('^%s*(.-)%s*$'); local d=when:GetText():match('^%s*(.-)%s*$')
    if t=='' or d=='' then log('Podaj nazwę i termin.'); return end
    if #db.events>=40 then log('Limit 40 lokalnych planów.'); return end
    diag('local.note_saved');table.insert(db.events,{title=t,when=d}); privateDraftTitle,privateDraftWhen='',''; render()
  end,true); add:SetPoint('LEFT',when,'RIGHT',8,0); ui.y=ui.y-46
  if #db.events==0 then text('Brak planów. Dodaj pierwszy wpis powyżej.',12,muted) end
  for i,e in ipairs(db.events) do
    local f=bar(plain(e.title),plain(e.when)..'  •  tylko lokalnie',gold)
    local b=button(f,'USUŃ',65,26,function() table.remove(db.events,i); render() end); b:SetPoint('RIGHT',-8,0)
    local open=button(f,'SZCZEGÓŁY',100,26,function() showPrivateEvent(e) end); open:SetPoint('RIGHT',-80,0)
  end
  text('Tylko Ty widzisz prywatne notatki.',11,muted)
end
local boardTypes={'GRUPA','SPRZEDAM','KUPIĘ','USŁUGI','POMOC','INNE'}
local boardType,boardReply=1,nil
local boardTemplates={
 'Szukam grupy.',
 'Sprzedam:',
 'Kupię:',
 'Oferuję usługę:',
 'Szukam pomocy:',
 'Ogłoszenie:',
}
local function boardTable()
  local key=guildKey(); if not key then return nil end
  if not feature('board') then return nil end
  db.boards=db.boards or {}; db.boards[key]=db.boards[key] or {items={},counter=0}
  local board=db.boards[key]
  board.cancelled=board.cancelled or {}
  return board
end
local function boardId(store)
  store.counter=store.counter+1
  local stamp=(GetServerTime and GetServerTime()) or (time and time()) or 0
  return tostring(stamp)..string.format('%04d',store.counter%10000)
end
-- Comments can arrive before the author replays their announcement.
-- The bounded holding area never crosses guilds and senders are checked again on apply.
local pendingBoardReplies={}
function NS.receiveBoard(message,sender)
  if NS.TestCleanup and NS.TestCleanup.block(guildKey(),'TSGuildHall',message,sender) then return end
  if type(message)~='string' or #message>200 then diag('drop.board.length_or_type'); return end
  local who=member(sender); local board=boardTable(); if not who or not board then diag('drop.board.member_or_scope'); return end
  local author,postId=message:match('^B3|([^|]+)|(%d+)$')
  if author then
    if #postId>22 or not canManageGuildEntry(who,author) then return end
    local poster=member(author)
    local key=(poster and poster.name or author)..'|'..postId
    local current
    for i,entry in ipairs(board.items) do if entry.key==key then current=i; break end end
    if board.cancelled[key] or (not poster and not current) then return end
    local count=0
    local owner=poster and poster.name or board.items[current].sender
    for _,record in pairs(board.cancelled) do if record.author==owner then count=count+1 end end
    if count>=128 and not current then return end
    board.cancelled[key]={author=owner,actor=who.name}
    if current then table.remove(board.items,current) end
    if ui and ui.boardDetail and ui.boardDetail:IsShown() and ui.boardDetail.entry and ui.boardDetail.entry.key==key then
      ui.boardDetail:Hide()
    end
    if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildHall',message,who.name) end
    if ui and ui.root:IsShown() and (page=='TABLICA' or page=='START') then render() end
    return
  end
  local id,kind,content=message:match('^B1|(%d+)|([^|]+)|([^|]+)$')
  if id then
    if #id>22 then return end
    local valid=false; for _,category in ipairs(boardTypes) do if kind==category then valid=true end end
    if not valid then return end
    local key=who.name..'|'..id
    if board.cancelled[key] then return end
    for _,entry in ipairs(board.items) do if entry.key==key then return end end
    diag('accept.board.create'); table.insert(board.items,1,{sender=who.name,id=id,text=kind..' — '..content,key=key,replies={}})
    while #board.items>100 do table.remove(board.items) end
  else
    local author,parentId,replyId,reply=message:match('^B2|([^|]+)|(%d+)|(%d+)|([^|]+)$')
    if not author or #replyId>22 then diag('drop.board.reply_format'); return end
    local poster=member(author); if not poster then diag('drop.board.reply_author'); return end
    local key=poster.name..'|'..parentId
    if board.cancelled[key] then return end
    local thread
    for _,entry in ipairs(board.items) do if entry.key==key then thread=entry; break end end
    if not thread then
      diag('hold.board.reply_parent')
      local g=guildKey(); local t=(GetTime and GetTime()) or 0
      for i=#pendingBoardReplies,1,-1 do local p=pendingBoardReplies[i]; if p.scope~=g or t<p.time or t-p.time>120 then table.remove(pendingBoardReplies,i) end end
      for _,p in ipairs(pendingBoardReplies) do if p.sender==who.name and p.message==message then return end end
      if g and #pendingBoardReplies<40 then pendingBoardReplies[#pendingBoardReplies+1]={scope=g,time=t,sender=who.name,message=message,parent=key} end
      return
    end
    local replyKey=who.name..'|'..replyId
    for _,r in ipairs(thread.replies) do if r.key==replyKey then diag('drop.board.reply_duplicate'); return end end
    if #thread.replies>=30 then diag('drop.board.reply_limit'); return end
    diag('accept.board.reply'); table.insert(thread.replies,{sender=who.name,text=reply,key=replyKey})
  end
  if ui and ui.boardDetail and ui.boardDetail:IsShown() and ui.boardDetail.refresh then ui.boardDetail.refresh() end
  if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildHall',message,who.name) end
  if id then
    local g=guildKey(); local t=(GetTime and GetTime()) or 0; local key=who.name..'|'..id
    local remaining,ready={},{}
    for _,p in ipairs(pendingBoardReplies) do
      if p.scope==g and t>=p.time and t-p.time<=120 then
        if p.parent==key then ready[#ready+1]=p else remaining[#remaining+1]=p end
      end
    end
    pendingBoardReplies=remaining
    for _,p in ipairs(ready) do NS.receiveBoard(p.message,p.sender) end
  end
  if ui and ui.root:IsShown() and page=='TABLICA' and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render() end
end
-- Retry an accepted board message with its original ID; receivers deduplicate it.
-- Queue is bounded and fenced to the guild. This is not a delivery receipt.
local boardRetries = {}
local function retryBoard(payload,scope)
  if not scope or #boardRetries>=16 or not (C_Timer and C_Timer.After) then return end
  local job={payload=payload,scope=scope,attempts=0}; boardRetries[#boardRetries+1]=job
  local function finish()
    for i,e in ipairs(boardRetries) do if e==job then table.remove(boardRetries,i); break end end
  end
  local function schedule(delay)
    local ok=pcall(C_Timer.After,delay,function()
      local current=boardTable()
      if guildKey()~=job.scope or not current then finish(); return end
      local createId=job.payload:match('^B1|(%d+)|')
      local who=me()
      if createId and who and current.cancelled[who.name..'|'..createId] then finish(); return end
      if C_ChatInfo and C_ChatInfo.SendAddonMessageLogged then
        pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildHall',job.payload,'GUILD')
      end
      job.attempts=job.attempts+1
      if job.attempts<2 then schedule(9) else finish() end
    end)
    if not ok then finish() end
  end
  schedule(3)
end
local function boardSend(payload)
  if not feature('board') then return false,'Tablica jest wyłączona w ustawieniach.' end
  local who=me()
  if not who then diag('blocked.board.self_unresolved'); return false,'Odśwież roster gildii.' end
  if #payload>200 then diag('blocked.board.too_long',#payload); return false,'Wiadomość jest za długa.' end
  if not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then return false,'Wysyłanie jest niedostępne.' end
  local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildHall',payload,'GUILD')
  if not ok or type(result)~='number' or result~=0 then return false,'Nie udało się wysłać.' end
  NS.receiveBoard(payload,who.name); retryBoard(payload,guildKey()); return true
end
local function boardPopupBase(name,w,h)
  local previous=recycle; recycle=false
  local p=CreateFrame('Frame',name,UIParent,'BackdropTemplate')
  -- Blizzard's dropdown menu must render above this dialog, while the dialog
  -- itself must stay above the addon window.
  p:SetSize(w,h); p:SetPoint('CENTER'); p:SetFrameStrata('DIALOG'); p:SetFrameLevel((ui.root:GetFrameLevel() or 0)+30); p:SetClampedToScreen(true); p:EnableMouse(true)
  p:SetBackdrop({bgFile='Interface\\DialogFrame\\UI-DialogBox-Background',edgeFile='Interface\\DialogFrame\\UI-DialogBox-Gold-Border',tile=true,tileSize=32,edgeSize=24,insets={left=6,right=6,top=6,bottom=6}})
  p:SetBackdropColor(.35,.3,.24,1); p:SetBackdropBorderColor(1,1,1,1)
  local bg=p:CreateTexture(nil,'BACKGROUND',nil,-7);bg:SetPoint('TOPLEFT',6,-6);bg:SetPoint('BOTTOMRIGHT',-6,6);bg:SetColorTexture(.065,.052,.039,.98)
  p:SetMovable(true); p:RegisterForDrag('LeftButton'); p:SetScript('OnDragStart',function(self) self:StartMoving() end); p:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end)
  p:SetScript('OnHide',function(self) self:StopMovingOrSizing() end)
  local close=button(p,'×',30,30,function() p:Hide() end); close:SetPoint('TOPRIGHT',-8,-8)
  tinsert(UISpecialFrames,name); recycle=previous; return p
end
local function composeBoard(store)
  local oldRecycle=recycle; recycle=false
  if not ui.boardCompose then
    local p=boardPopupBase('TheSentencedBoardCompose',540,420); ui.boardCompose=p
    local title=font(p,'NOWE OGŁOSZENIE  •  WYBIERZ KATEGORIĘ',16,gold); title:SetPoint('TOPLEFT',16,-18)
    local updateGroupPreview
    p.categories={}
    p.refreshCategories=function(fromMenu)
      for i,b in ipairs(p.categories) do b.caption:SetText((i==boardType and '✓  ' or '○  ')..boardTypes[i]) end
      if not fromMenu and p.categoryDropdown and p.categoryDropdown.GenerateMenu then p.categoryDropdown:GenerateMenu() end
      if p.groupPanel then p.groupPanel:SetShown(boardType==1) end
      if p.template then p.template:SetShown(boardType~=1) end
      if p.input and p.input.hint then p.input.hint:SetText(tr(boardType==1 and 'Dodatkowy opis — nagłówek powstaje automatycznie' or 'Treść ogłoszenia...')) end
      if boardType==1 and updateGroupPreview then updateGroupPreview() end
    end
    p.categoryDropdown=nativeChoice(p,boardTypes,function()return boardType end,function(index) boardType=index;p.refreshCategories(true) end,250) or false
    if p.categoryDropdown then p.categoryDropdown:SetPoint('TOPLEFT',16,-53)
    else for i,label in ipairs(boardTypes) do
      local index=i;local b=button(p,label,162,28,function() boardType=index; p.refreshCategories() end,true)
      b:SetPoint('TOPLEFT',16+((i-1)%3)*170,-53-math.floor((i-1)/3)*34); p.categories[i]=b
    end end
    p.input=edit(p,505,32,'','Treść ogłoszenia...'); p.input:SetPoint('TOPLEFT',16,-130); p.input:SetMaxLetters(200)
    if NS.BoardItems.registerEditBox then NS.BoardItems.registerEditBox(p.input) end
    p.groupPanel=frame('Frame',p); p.groupPanel:SetPoint('TOPLEFT',16,-220); p.groupPanel:SetSize(505,125)
    p.groupInstance=''; p.groupCustom=false; p.groupRoles={TANK=false,HEAL=false,DPS=false}; p.templatePrefix=''; p.templateType=0
    local instance=button(p.groupPanel,'WYBIERZ MIEJSCE / CEL',172,30,function()
      local opened=NS.InstancePicker and NS.InstancePicker.pick(p,function(name,custom)
        p.groupCustom=custom and true or false; p.groupInstance=name or ''
        p.groupOther:SetShown(p.groupCustom); p.groupChoice:SetShown(not p.groupCustom)
        p.groupChoice:SetText(name or 'Wybierz miejsce lub cel')
        if p.groupCustom then p.groupOther:SetFocus() end
        if updateGroupPreview then updateGroupPreview() end
      end,{customLabel='INNY CEL / MIEJSCE'})
      if not opened then log('Lista miejsc jest niedostępna.') end
    end,true); instance:SetPoint('TOPLEFT',0,0); p.groupInstanceButton=instance
    p.groupChoice=font(p.groupPanel,'Wybierz miejsce lub cel',11,muted); p.groupChoice:SetPoint('TOPLEFT',182,-7); p.groupChoice:SetWidth(320)
    p.groupOther=edit(p.groupPanel,320,30,'','Inne miejsce lub cel'); p.groupOther:SetPoint('TOPLEFT',182,0); p.groupOther:Hide()
    local roleLabel=font(p.groupPanel,'POTRZEBNE ROLE',10,gold); roleLabel:SetPoint('TOPLEFT',0,-45)
    p.groupRoleButtons={}
    for i,role in ipairs({'TANK','HEAL','DPS'}) do
      local r=role; local b=button(p.groupPanel,'○  '..r,76,28,function()
        p.groupRoles[r]=not p.groupRoles[r]
        p.groupRoleButtons[r].caption:SetText((p.groupRoles[r] and '✓  ' or '○  ')..r)
        if updateGroupPreview then updateGroupPreview() end
      end,true)
      b:SetPoint('TOPLEFT',(i-1)*82,-61); p.groupRoleButtons[r]=b
    end
    local clockLabel=font(p.groupPanel,'GODZINA (STREFĘ PODAJ W OPISIE)',10,gold); clockLabel:SetPoint('TOPLEFT',264,-45)
    p.groupClock=edit(p.groupPanel,105,28,'','GG:MM'); p.groupClock:SetPoint('TOPLEFT',264,-61)
    p.groupPreview=font(p.groupPanel,'',10,muted); p.groupPreview:SetPoint('TOPLEFT',0,-98); p.groupPreview:SetWidth(500); p.groupPreview:SetHeight(30)
    local function groupPrefix()
      local name=p.groupCustom and p.groupOther:GetText() or p.groupInstance
      name=(name or ''):match('^%s*(.-)%s*$')
      if name=='' then return nil,'Wybierz miejsce lub cel dla ogłoszenia.' end
      local at=p.groupClock:GetText():match('^%s*(.-)%s*$')
      if at~='' then
        local hour,minute=at:match('^(%d%d):(%d%d)$'); hour,minute=tonumber(hour),tonumber(minute)
        if not hour or hour>23 or not minute or minute>59 then return nil,'Podaj godzinę GG:MM albo pozostaw pole puste.' end
      end
      local chosen={}; for _,r in ipairs({'TANK','HEAL','DPS'}) do if p.groupRoles[r] then chosen[#chosen+1]=r end end
      return 'Szukam grupy: '..name..(at~='' and (' • '..at) or '')..(#chosen>0 and (' • potrzebne: '..table.concat(chosen,', ')) or '')
    end
    updateGroupPreview=function()
      local prefix,err=groupPrefix()
      p.groupPreview:SetText(prefix and ('PODGLĄD: '..prefix) or (err or 'Wybierz miejsce lub cel.'))
    end
    local function removeUnchangedTemplate(value)
      if value==p.templatePrefix then return '' end
      local marker=p.templatePrefix..' — '
      if value:sub(1,#marker)==marker then return value:sub(#marker+1):match('^%s*(.-)%s*$') end
      return nil
    end
    for _,field in ipairs({p.groupClock,p.groupOther}) do
      local previous=field:GetScript('OnTextChanged')
      field:SetScript('OnTextChanged',function(self,...)
        if previous then previous(self,...) end
        updateGroupPreview()
      end)
    end
    local choose=button(p,'+ PRZEDMIOT Z TOREB',220,30,function()
      local opened=NS.BoardItems.pick(p,function(data)
        local old=p.input:GetText(); local value=old..(old=='' and '' or ' ')..'{'..data..'}'
        if #value>150 then log('Brak miejsca na przedmiot. Skróć ogłoszenie.'); return end
        p.input:SetText(value)
      end)
      if not opened then log('Brak dostępnych przedmiotów w noszonych torbach.') end
    end); choose:SetPoint('TOPLEFT',16,-176)
    local template=button(p,'WSTAW SZABLON',155,30,function()
      if boardType==1 then
        local prefix,err=groupPrefix(); updateGroupPreview()
        if not prefix then log(err) end
        return
      end
      local prefix=boardTemplates[boardType]
      local existing=p.input:GetText():match('^%s*(.-)%s*$')
      if p.templatePrefix~='' and existing~='' then
        local remainder=removeUnchangedTemplate(existing)
        if remainder==nil then
          log('Zmieniono wcześniejszy szablon. Tekst zachowano; popraw go ręcznie.'); return
        end
        existing=remainder
      end
      if existing==prefix or existing:sub(1,#prefix+#' — ')==prefix..' — ' then p.templatePrefix=prefix; p.templateType=boardType; return end
      local combined=prefix..(existing~='' and (' — '..existing) or '')
      if #combined>200 then log('Szablon i treść są zbyt długie. Skróć tekst przed wstawieniem.'); return end
      p.input:SetText(combined); p.templatePrefix=prefix; p.templateType=boardType
    end); p.template=template; template:SetPoint('TOPLEFT',245,-176)
    local publish=button(p,'OPUBLIKUJ',155,30,function()
      local storeNow=boardTable(); if not storeNow then log('Dołącz do gildii.'); return end
      local raw=p.input:GetText():match('^%s*(.-)%s*$')
      if p.templatePrefix~='' and p.templateType~=boardType and raw~='' then
        local remainder=removeUnchangedTemplate(raw)
        if remainder==nil then
          log('Zmieniono wcześniejszy szablon. Tekst zachowano; popraw go ręcznie przed publikacją.'); return
        end
        raw=remainder
      end
      if boardType==1 then
        local prefix,err=groupPrefix(); if not prefix then updateGroupPreview(); log(err); return end
        if raw:find('^Szukam grupy:') then
          p.groupPreview:SetText('W polu treści zostaw dodatkowy opis; nagłówek powstaje automatycznie.')
          log('Usuń nagłówek z pola treści; wybrane miejsce i role zostaną dodane automatycznie.'); return
        end
        raw=prefix..(raw~='' and (' — '..raw) or '')
      end
      local message=NS.BoardItems.encode(raw); if message=='' then log('Wpisz treść ogłoszenia.'); return end
      local ok,why=boardSend(table.concat({'B1',boardId(storeNow),boardTypes[boardType],message},'|'))
      log(ok and 'Próba wysłania. Odbiór przez innych nie jest gwarantowany.' or (why or 'Błąd'))
      if ok then
        p.input:SetText(''); p.templatePrefix=''; p.templateType=0; p.groupInstance=''; p.groupCustom=false; p.groupOther:SetText(''); p.groupOther:Hide(); p.groupChoice:Show(); p.groupChoice:SetText('Wybierz miejsce lub cel'); p.groupClock:SetText('')
        for _,r in ipairs({'TANK','HEAL','DPS'}) do p.groupRoles[r]=false; p.groupRoleButtons[r].caption:SetText('○  '..r) end
        updateGroupPreview()
        p:Hide(); render()
      end
    end,true); publish:SetPoint('BOTTOMRIGHT',-18,18)
    local hint=font(p,'Wybierz typ i uzupełnij ogłoszenie.',10,muted); hint:SetPoint('BOTTOMLEFT',16,26); hint:SetWidth(340)
  end
  local p=ui.boardCompose; p.refreshCategories(); p:Show(); recycle=oldRecycle
end
openCraftRequest=function()
  local store=boardTable();if not store then log('Dołącz do gildii.');return end
  local existing=ui.boardCompose and ui.boardCompose.input and ui.boardCompose.input:GetText() or ''
  if existing:match('%S') then composeBoard(store);log('Zachowano niedokończony szkic ogłoszenia.');return end
  boardType=5;composeBoard(store)
  ui.boardCompose.templatePrefix='';ui.boardCompose.templateType=0
  local en=NS.Language and NS.Language.language()=='en'
  ui.boardCompose.input:SetText(en and 'Looking for crafting: ' or 'Szukam wytworzenia: ');ui.boardCompose.input:SetFocus()
end
local function showBoardDetail(entry)
  local oldRecycle=recycle; recycle=false
  if not ui.boardDetail then
    local p=boardPopupBase('TheSentencedBoardDetail',570,490); ui.boardDetail=p
    local share=button(p,'LINK DO /G',110,25,function()
      local current=p.entry
      if not current or not feature('guildLinks') or not NS.GuildLinks then return end
      local ok,reason=NS.GuildLinks.prepare('B',current.sender,current.id,current.text,NS.GuildAccess.scopeId())
      if not ok then log(reason or 'Link do ogłoszenia jest niedostępny.') end
    end); share:SetPoint('TOPRIGHT',-51,-14)
    p.share=share
    p.remove=button(p,'USUŃ',104,25,function()
      local e=p.entry
      if not e or not canManageGuildEntry(me(),e.sender) then return end
      if not p.confirmRemove then
        p.confirmRemove=true; p.remove.caption:SetText('POTWIERDŹ'); return
      end
      local ok,reason=boardSend('B3|'..e.key)
      p.confirmRemove=false; p.remove.caption:SetText('USUŃ')
      log(ok and 'Usunięto ogłoszenie z tablicy.' or reason)
    end)
    p.remove:SetPoint('RIGHT',share,'LEFT',-6,0)
    local header=CreateFrame('Frame',nil,p); header:SetPoint('TOPLEFT',13,-10); header:SetPoint('TOPRIGHT',-13,-10); header:SetHeight(88)
    header:SetFrameLevel(p:GetFrameLevel()); solid(header,.12,.13,.16,1)
    p.title=font(header,'',17,gold); p.title:SetPoint('TOPLEFT',13,-8); p.title:SetWidth(255)
    p.author=font(header,'',10,muted); p.author:SetPoint('TOPLEFT',14,-31); p.author:SetWidth(500)
    p.body=font(header,'',12,white); p.body:SetPoint('TOPLEFT',14,-52); p.body:SetWidth(513); p.body:SetHeight(32)
    p.itemButtons={}
    for i=1,3 do
      local b=button(p,'PRZEDMIOT',160,27,function(self) if self.data then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetPoint('TOPLEFT',16+(i-1)*175,-110)
      b:SetScript('OnEnter',function(self) if self.data then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end); p.itemButtons[i]=b
    end
    local label=font(p,'ODPOWIEDZI',11,gold); label:SetPoint('TOPLEFT',16,-148)
    p.comments=font(p,'',11,white); p.comments:SetPoint('TOPLEFT',16,-169); p.comments:SetWidth(530); p.comments:SetHeight(100)
    p.replyItems={}
    for i=1,3 do
      local b=button(p,'PRZEDMIOT',160,25,function(self) if self.data then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetPoint('TOPLEFT',16+(i-1)*175,-270)
      b:SetScript('OnEnter',function(self) if self.data then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end); p.replyItems[i]=b
    end
    p.count=font(p,'',10,muted); p.count:SetPoint('TOPLEFT',210,-309)
    p.replyPrev=button(p,'<',40,25,function() p.replyPage=math.max(1,p.replyPage-1); p.refresh() end); p.replyPrev:SetPoint('TOPLEFT',16,-303)
    p.replyNext=button(p,'>',40,25,function() p.replyPage=math.min(p.replyPages,p.replyPage+1); p.refresh() end); p.replyNext:SetPoint('TOPLEFT',65,-303)
    p.reply=edit(p,530,30,'','Napisz odpowiedź...'); p.reply:SetPoint('TOPLEFT',16,-337)
    if NS.BoardItems.registerEditBox then NS.BoardItems.registerEditBox(p.reply) end
    local pickReply=button(p,'+ PRZEDMIOT Z TOREB',210,27,function()
      local opened=NS.BoardItems.pick(p,function(data)
        local old=p.reply:GetText(); local value=old..(old=='' and '' or ' ')..'{'..data..'}'
        if #value>160 then log('Brak miejsca na przedmiot. Skróć komentarz.'); return end
        p.reply:SetText(value)
      end)
      if not opened then log('Brak dostępnych przedmiotów w noszonych torbach.') end
    end); pickReply:SetPoint('TOPLEFT',16,-374)
    local function sendReply(value)
      local e=p.entry; local storeNow=boardTable(); if not e or not storeNow then log('Ogłoszenie niedostępne.'); return end
      local answer=NS.BoardItems.encode(value); if answer=='' then log('Wpisz odpowiedź.'); return end
      local ok,why=boardSend(table.concat({'B2',e.sender,e.id,boardId(storeNow),answer},'|'))
      if ok then p.reply:SetText(''); p.replyPage=math.max(1,math.ceil(#e.replies/4)); p.refresh(); log('Próba wysłania odpowiedzi. Odbiór nie jest potwierdzony.') else log(why or 'Błąd') end
    end
    local send=button(p,'WYŚLIJ KOMENTARZ',180,30,function() sendReply(p.reply:GetText()) end,true); send:SetPoint('BOTTOMLEFT',16,18)
    p.buy=button(p,'ZAPYTAJ O ZAKUP',180,30,function() sendReply('Jestem zainteresowany zakupem. Napisz do mnie w grze.') end); p.buy:SetPoint('BOTTOMLEFT',210,18)
    p.notice=font(p,'Zakup i przekazanie przedmiotu ustalacie w grze.',10,muted); p.notice:SetPoint('BOTTOMLEFT',16,56); p.notice:SetWidth(520)
    p.refresh=function()
      local e=p.entry; if not e then return end
      local category,description=e.text:match('^(.-) — (.*)$')
      p.title:SetText(plain(category or 'Ogłoszenie'))
      p.author:SetText(plain(e.sender))
      p.body:SetText(plain(NS.BoardItems.label(description or e.text)))
      local links=NS.BoardItems.links(e.text)
      for i,b in ipairs(p.itemButtons) do local data=links[i]; b.data=data; b:SetShown(data~=nil); if data then b.caption:SetText(NS.BoardItems.label('{'..data..'}')) end end
      p.replyPages=math.max(1,math.ceil(#e.replies/4)); p.replyPage=math.min(p.replyPage,p.replyPages)
      local lines,replyLinks={},{}; for i=(p.replyPage-1)*4+1,math.min(p.replyPage*4,#e.replies) do local r=e.replies[i]; lines[#lines+1]=plain(r.sender)..': '..plain(NS.BoardItems.label(r.text)); for _,data in ipairs(NS.BoardItems.links(r.text)) do if #replyLinks<3 then replyLinks[#replyLinks+1]=data end end end
      p.comments:SetText(#lines>0 and table.concat(lines,'\n') or 'Brak odpowiedzi.'); p.count:SetText(p.replyPage..' / '..p.replyPages)
      p.count:SetShown(p.replyPages>1); p.replyPrev:SetShown(p.replyPage>1); p.replyNext:SetShown(p.replyPage<p.replyPages)
      for i,b in ipairs(p.replyItems) do local data=replyLinks[i]; b.data=data; b:SetShown(data~=nil); if data then b.caption:SetText(NS.BoardItems.label('{'..data..'}')) end end
      local selfMember=me(); p.remove:SetShown(canManageGuildEntry(selfMember,e.sender)==true); p.share:SetShown(feature('guildLinks')); p.buy:SetShown(e.text:match('^SPRZEDAM%s*—')~=nil and (not selfMember or selfMember.name~=e.sender))
    end
  end
  local p=ui.boardDetail; p.entry=entry; p.confirmRemove=false; p.remove.caption:SetText('USUŃ'); p.replyPage=1; p.reply:SetText(''); p.refresh(); p:Show(); recycle=oldRecycle
end
local function boardPage()
  section(nil,'Ogłoszenia gildii')
  local store=boardTable(); if not store then text('Dołącz do gildii.',12,muted); return end
  addAction('+ NOWE OGŁOSZENIE',function() composeBoard(store) end,230)
  if #store.items==0 then text('Brak odebranych ogłoszeń.',12,muted) end
  for _,entry in ipairs(store.items) do
    local e=entry
    local f=bar(preview(NS.BoardItems.label(e.text),68),plain(e.sender)..'  •  odpowiedzi: '..#e.replies,gold,function() showBoardDetail(e) end)
    local open=button(f,'OTWÓRZ',85,27,function() showBoardDetail(e) end); open:SetPoint('RIGHT',-8,0)
  end
end

local function itemId(textValue)
  if type(textValue)~='string' then return nil end
  local value=textValue:match('^%s*(%d+)%s*$') or textValue:match('item:(%d+)')
  local n=tonumber(value); if not n or n<1 or n>100000000 then return nil end
  return n
end
local function itemLabel(id)
  if C_Item and C_Item.GetItemInfo then
    local ok,name=pcall(C_Item.GetItemInfo,id)
    if ok and type(name)=='string' and not (issecretvalue and issecretvalue(name)) and name~='' then return plain(name)..'  /  ID '..id end
  end
  return 'Item ID  '..id
end
local function resourcesPage()
  local en=NS.Language and NS.Language.language()=='en'
  section(en and 'COMMUNITY  /  RESOURCES' or 'SPOŁECZNOŚĆ  /  ZASOBY',en and 'Find materials' or 'Znajdź materiały',en and 'Search bag snapshots shared by guild members. Ask before requesting an item.' or 'Przeszukaj migawki toreb udostępnione przez gildiowiczów. Przedmioty uzgadniaj z właścicielem.')
  local search=edit(ui.content,310,31,resourceQuery,en and 'Item name or ID...' or 'Nazwa lub ID przedmiotu...');search:SetPoint('TOPLEFT',4,ui.y)
  local function apply() resourceQuery=search:GetText();resourcePageNumber=1;search:ClearFocus();render() end
  search:SetScript('OnEnterPressed',apply)
  local find=button(ui.content,en and 'SEARCH' or 'SZUKAJ',90,31,apply);find:SetPoint('LEFT',search,'RIGHT',7,0)
  local filter=button(ui.content,resourceOnline and (en and 'ONLINE: YES' or 'ONLINE: TAK') or (en and 'ONLINE: ALL' or 'ONLINE: WSZYSCY'),165,31,function()resourceQuery=search:GetText();resourceOnline=not resourceOnline;resourcePageNumber=1;render()end);filter:SetPoint('LEFT',find,'RIGHT',7,0)
  ui.y=ui.y-43
  local query=resourceQuery:match('^%s*(.-)%s*$')
  if #query<2 and not query:match('^%d+$') then text(en and 'Enter at least two characters or an item ID.' or 'Wpisz co najmniej dwa znaki lub ID przedmiotu.',12,muted);return end
  local rows,truncated=NS.ResourceDirectory.search(roster(),NS.Profiles and NS.Profiles.get,query,itemLabel,resourceOnline,200)
  if #rows==0 then text(en and 'No matching shared resources. Item names may require loading by the game.' or 'Brak pasujących udostępnionych zasobów. Nazwy przedmiotów mogą wymagać wczytania przez grę.',12,muted) end
  local pages=math.max(1,math.ceil(#rows/10));resourcePageNumber=math.max(1,math.min(resourcePageNumber,pages))
  for index=(resourcePageNumber-1)*10+1,math.min(resourcePageNumber*10,#rows) do
    local result=rows[index];local person=result.member
    local stamp=en and 'date unknown' or 'data nieznana'
    if result.received and result.received>0 and date then local ok,value=pcall(date,'%Y-%m-%d %H:%M',result.received);if ok and type(value)=='string' then stamp=value end end
    local f=bar(preview(result.name,65),(en and 'Owner: ' or 'Właściciel: ')..plain(person.name)..'  •  '..(en and 'Quantity: ' or 'Ilość: ')..result.count..'  •  '..stamp,person.online and gold or muted)
    local whisper=button(f,en and 'WHISPER' or 'SZEPT',85,27,function()if ChatFrame_SendTell then ChatFrame_SendTell(person.name)else log('Otwórz szept ręcznie: '..plain(person.name))end end);whisper:SetPoint('RIGHT',-8,0)
  end
  if pages>1 then
    local previous=button(ui.content,en and 'PREVIOUS' or 'POPRZEDNIA',130,30,function()resourcePageNumber=math.max(1,resourcePageNumber-1);render()end);previous:SetPoint('TOPLEFT',4,ui.y)
    local label=font(ui.content,resourcePageNumber..' / '..pages,12,white,'CENTER');label:SetPoint('LEFT',previous,'RIGHT',8,0);label:SetWidth(60)
    local nextButton=button(ui.content,en and 'NEXT' or 'NASTĘPNA',130,30,function()resourcePageNumber=math.min(pages,resourcePageNumber+1);render()end);nextButton:SetPoint('LEFT',label,'RIGHT',8,0);ui.y=ui.y-40
  end
  if truncated then text(en and 'More than 200 matches; refine the search.' or 'Ponad 200 wyników — doprecyzuj wyszukiwanie.',11,muted) end
  text(en and 'Only shared carried bags are included; bank and mail are excluded. Quantities can be stale.' or 'Tylko udostępnione noszone torby; bez banku i poczty. Ilości mogą być nieaktualne.',11,muted)
end
-- Form controls are recycled after redraw. Do not apply a late picker choice
-- to a different page or to a field reused for a different purpose.
local function pickerCurrent(generation,originalPage)
  return ui and ui.root and ui.root:IsShown() and ui.pickerGeneration==generation and page==originalPage
end
local function chooseGuildMember(field,filter)
  if not NS.MemberPicker then log('Wybór gracza jest niedostępny.'); return end
  local members={}
  for _,m in ipairs(roster()) do if not filter or filter(m) then members[#members+1]=m end end
  local generation,originalPage=ui.pickerGeneration,page
  local opened=NS.MemberPicker.pick(ui.content,members,function(name)
    if pickerCurrent(generation,originalPage) then field:SetText(name)
    else log('Formularz się zmienił. Wybierz osobę ponownie.') end
  end)
  if not opened then log('Brak pasujących osób w rosterze. Sprawdź listę gildii.') end
end
local function chooseCarriedItem(field,selectedLabel)
  if not NS.BoardItems or not NS.BoardItems.pick then log('Wybór przedmiotu jest niedostępny.'); return end
  local generation,originalPage=ui.pickerGeneration,page
  -- Attach the existing picker to the root instead of the scrolling content.
  local opened=NS.BoardItems.pick(ui.root,function(data)
    if not pickerCurrent(generation,originalPage) then log('Formularz się zmienił. Wybierz przedmiot ponownie.'); return end
    local id=itemId(data); if not id then log('Nie udało się odczytać przedmiotu.'); return end
    field:SetText(tostring(id)); if selectedLabel then selectedLabel:SetText(preview(itemLabel(id),60)) end
  end)
  if not opened then log('Brak dostępnych przedmiotów w noszonych torbach.') end
end
guildKey=function()
  if NS.GuildAccess and not NS.GuildAccess.isMember() then return nil end
  if not GetGuildInfo then return nil end
  local name,_,_,realm=GetGuildInfo('player')
  if not name then return nil end
  realm=realm or (GetRealmName and GetRealmName()) or '?'
  return name..'@'..realm
end
member=function(name)
  if type(name)~='string' or name=='' then return nil end
  local found, count=nil,0
  for _,m in ipairs(roster()) do
    if m.name:lower()==name:lower() then return m end
    local query=name:lower():gsub('%-',' '):gsub('%s+',' ')
    local full=m.name:lower():gsub('%-',' '):gsub('%s+',' ')
    local exactParts=query==full
    local realm=GetRealmName and GetRealmName()
    local withSuffix=type(realm)=='string' and realm~='' and name:lower()==(m.name..'-'..realm):lower()
    local firstOnly=not query:find(' ',1,true) and full:match('^%S+')==query
    if exactParts or withSuffix or firstOnly then found=m; count=count+1 end
  end
  if count==1 then return found end
end
me=function()
  if NS.GuildAccess and not NS.GuildAccess.isMember() then return nil end
  local name,realm
  if UnitFullName then name,realm=UnitFullName('player') else name=UnitName('player') end
  if not name then return nil end
  local full=realm and realm~='' and (name..' '..realm) or name
  return member(full) or member(name)
end
local plannerSelection=1
local openEventPopup
local plannerWhenField,plannerTitleField
local plannerDraftWhen,plannerDraftTitle='',''
local plannerRefreshPending,plannerRefreshScheduled=false,false
-- Replies can arrive before their event. Keep a small, short-lived buffer;
-- sender identity is taken only from the game event, never from payload.
local pendingPlannerReplies={}
-- J1 is an ephemeral notice, never included in a replay/snapshot. Its marker is
-- meaningful only when the corresponding authenticated R2 state is present.
local pendingPlannerNotices={}
local function plannerClock()
  local t=GetTime and GetTime() or 0
  return type(t)=='number' and t==t and t or 0
end
local function noticeKey(scope,eventKey,source)
  return scope..'\000'..eventKey..'\000'..source
end
local function prunePlannerNotices()
  local now=plannerClock()
  for key,v in pairs(pendingPlannerNotices) do if now-v.time>30 or now<v.time then pendingPlannerNotices[key]=nil end end
end
local function deliverPlannerNotice(event,source,revision,role)
  if not event.signupRevisions or event.signupRevisions[source]~=revision or not event.signups or event.signups[source]~=role then return false end
  if type(NS.notifyEventSignup)~='function' then return false end
  event.joinNoticeRevisions=event.joinNoticeRevisions or {}
  local previous=event.joinNoticeRevisions[source]
  if previous and revision<=previous then return false end
  event.joinNoticeRevisions[source]=revision
  pcall(NS.notifyEventSignup,event,source,role)
  return true
end
local function prunePlannerReplies()
  local now=plannerClock()
  for key,v in pairs(pendingPlannerReplies) do if now-v.time>300 or now<v.time then pendingPlannerReplies[key]=nil end end
end
local function acceptPlannerReply(event,source,role,revision)
  event.signups=event.signups or {}; event.signupRevisions=event.signupRevisions or {}
  local previous=event.signupRevisions[source]
  if revision then
    if previous and revision<=previous then return false end
  elseif previous then return false end
  local count=0; for _ in pairs(event.signups) do count=count+1 end
  if not event.signups[source] and count>=100 then return false end
  event.signups[source]=role
  if revision then event.signupRevisions[source]=revision end
  return true
end
local function plannerTable()
  if not feature('planner') then return nil end
  local key=guildKey(); if not key then return nil end
  db.planners=db.planners or {}; db.planners[key]=db.planners[key] or {items={},counter=0}
  local plan=db.planners[key]
  plan.cancelled=plan.cancelled or {}
  return plan
end
-- Only a character's own events and own versioned responses may be re-emitted.
local function plannerOwnSnapshot()
  local selfMember=me(); local plan=plannerTable(); local rows={}
  if not selfMember or not plan then return rows end
  for key,entry in pairs(plan.cancelled) do
    if canManageGuildEntry(selfMember,entry.author) and
      (selfMember.name==entry.actor or selfMember.name==entry.author) then
      rows[#rows+1]={key='C:'..key,owner=selfMember.name,payload='X1|'..key}
    end
  end
  for _,event in pairs(plan.items or {}) do
    if type(event.author)=='string' and type(event.id)=='string' then
      if event.author:lower()==selfMember.name:lower() and type(event.raid)=='number' and type(event.when)=='string' and type(event.title)=='string' then
        rows[#rows+1]={key='E:'..event.author..':'..event.id,owner=selfMember.name,payload=table.concat({'E1',event.id,event.raid,event.when,event.title},'|')}
        if NS.EventSync and type(event.description)=='string' and event.description~='' then
          local description=NS.EventSync.encodeDescription(event.id,event.description)
          if description then rows[#rows+1]={key='E:'..event.author..':'..event.id..':D',owner=selfMember.name,payload=description} end
        end
      end
      local role=event.signups and event.signups[selfMember.name]
      local rev=event.signupRevisions and event.signupRevisions[selfMember.name]
      if role and type(rev)=='number' then
        rows[#rows+1]={key='R:'..event.author..':'..event.id,owner=selfMember.name,payload=table.concat({'R2',event.author,event.id,string.format('%.0f',rev),role},'|')}
      end
    end
  end
  return rows
end
local function sendPlanner(msg)
  if not feature('planner') then return false,'Planer jest wyłączony w ustawieniach.' end
  if #msg>230 or msg:find('[%z\001-\031\127]') then diag('blocked.planner.invalid_or_long',#msg); return false,'Wiadomość jest za długa.' end
  if not IsInGuild or not IsInGuild() then diag('blocked.planner.no_guild'); return false,'Musisz być w gildii.' end
  if not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then diag('blocked.planner.api_missing');return false,'API wiadomości jest niedostępne.' end
  local selfMember=me()
  if not selfMember then diag('blocked.planner.self_unresolved'); return false,'Odśwież roster i spróbuj ponownie.' end
  local ok,res=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildEvent',msg,'GUILD')
  if not ok or type(res)~='number' or res~=0 then return false,'Nie udało się wysłać.' end
  NS.receivePlanner(msg,selfMember.name)
  return true
end
local function sendPlannerSignup(event,role)
  local selfMember=me()
  local oldRole=selfMember and event.signups and event.signups[selfMember.name]
  local previous=tonumber(db.plannerRevision) or 0
  if previous~=previous or previous<0 or previous>=9000000000000000 then return false,'Nieprawidłowa rewizja zapisów.' end
  local t=GetServerTime and GetServerTime() or 0
  if type(t)~='number' or t~=t or t<0 or t>9000000000000 then t=0 end
  local seq=math.max(math.floor(previous)+1,math.floor(t)*1000)
  if seq<1 or seq>=9000000000000000 then return false,'Nieprawidłowy czas lub rewizja zapisów.' end
  db.plannerRevision=seq
  local ok,why=sendPlanner(table.concat({'R2',event.author,event.id,string.format('%.0f',seq),role},'|'))
  if ok and selfMember and type(event.author)=='string' and event.author:lower()~=selfMember.name:lower()
      and role~='NIE' and (not oldRole or oldRole=='NIE') then
    -- Best effort only; do not retry or replay a notification, and do not
    -- change the successful R2 result if the transient notice fails.
    pcall(sendPlanner,table.concat({'J1',event.author,event.id,string.format('%.0f',seq),role},'|'))
  end
  return ok,why
end
local function redrawPlanner()
  if not (ui and ui.root:IsShown() and page=='WYDARZENIA') then plannerRefreshPending=false; return end
  if GetCurrentKeyBoardFocus and GetCurrentKeyBoardFocus() then return end
  if plannerWhenField then plannerDraftWhen=plannerWhenField:GetText() end
  if plannerTitleField then plannerDraftTitle=plannerTitleField:GetText() end
  if privateTitleField then privateDraftTitle=privateTitleField:GetText() end
  if privateWhenField then privateDraftWhen=privateWhenField:GetText() end
  plannerRefreshPending=false
  render()
end
local function schedulePlannerRefresh()
  if plannerRefreshScheduled or not (C_Timer and C_Timer.After) then return end
  plannerRefreshScheduled=true
  C_Timer.After(.35,function()
    plannerRefreshScheduled=false
    if plannerRefreshPending then redrawPlanner(); if plannerRefreshPending then schedulePlannerRefresh() end end
  end)
end
local function refreshPlanner()
  if ui and ui.root:IsShown() and page=='WYDARZENIA' then
    plannerRefreshPending=true
    redrawPlanner()
    if plannerRefreshPending then schedulePlannerRefresh() end
  end
  if ui and ui.eventPopup and ui.eventPopup:IsShown() and openEventPopup then openEventPopup(ui.eventPopup.eventKey,true) end
end
function NS.receivePlanner(msg,sender)
  if NS.TestCleanup and NS.TestCleanup.block(guildKey(),'TSGuildEvent',msg,sender) then return end
  if type(msg)~='string' or #msg>230 or type(sender)~='string' then return end
  local source=member(sender); local plan=plannerTable(); if not source or not plan then diag('drop.planner.member_or_scope'); return end
  local cancelledAuthor,cancelledId=msg:match('^X1|([^|]+)|(%d+)$')
  if cancelledAuthor then
    if #cancelledId>22 or not canManageGuildEntry(source,cancelledAuthor) then return end
    local organizer=member(cancelledAuthor)
    local key=(organizer and organizer.name or cancelledAuthor)..'|'..cancelledId
    local current=plan.items[key]
    if plan.cancelled[key] or (not organizer and not current) then return end
    local count=0
    for _,record in pairs(plan.cancelled) do
      if record.author==(organizer and organizer.name or current.author) then count=count+1 end
    end
    if count>=128 and not current then return end
    plan.cancelled[key]={author=organizer and organizer.name or current.author,actor=source.name}
    plan.items[key]=nil
    local own=me()
    if own and own.name==plan.cancelled[key].author and NS.EventRetry then NS.EventRetry.cancel(guildKey(),cancelledId) end
    if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildEvent',msg,source.name) end
    refreshPlanner(); return
  end
  local descriptionId,description
  if NS.EventSync then descriptionId,description=NS.EventSync.parseDescription(msg) end
  if descriptionId then
    local key=source.name..'|'..descriptionId; local event=plan.items[key]
    if plan.cancelled[key] then return end
    if not event then NS.EventSync.holdDescription(source.name,msg); return end
    if event.description and event.description~=description then diag('drop.planner.description_conflict'); return end
    if not event.description then event.description=description; refreshPlanner() end
    return
  end
  local noticeAuthor,noticeId,noticeSequence,noticeRole=msg:match('^J1|([^|]+)|(%d+)|(%d+)|([A-Z]+)$')
  if noticeAuthor then
    if #noticeId>22 or #noticeSequence>16 or (noticeRole~='TANK' and noticeRole~='HEAL' and noticeRole~='DPS') then return end
    local noticeRevision=tonumber(noticeSequence)
    if not noticeRevision or noticeRevision<1 or noticeRevision>9000000000000000 or noticeRevision~=math.floor(noticeRevision) then return end
    local organizer=member(noticeAuthor); local selfMember=me(); local scope=guildKey()
    if not organizer or not selfMember or not scope or organizer.name:lower()~=selfMember.name:lower() or source.name:lower()==selfMember.name:lower() then return end
    local eventKey=organizer.name..'|'..noticeId; local event=plan.items[eventKey]
    if not event then return end
    if deliverPlannerNotice(event,source.name,noticeRevision,noticeRole) then return end
    local seen=event.joinNoticeRevisions and event.joinNoticeRevisions[source.name]
    local current=event.signupRevisions and event.signupRevisions[source.name]
    if (seen and noticeRevision<=seen) or (current and noticeRevision<=current) then return end
    prunePlannerNotices()
    local pendingKey=noticeKey(scope,eventKey,source.name); local previous=pendingPlannerNotices[pendingKey]
    if previous and noticeRevision<=previous.revision then return end
    local count=0; for _ in pairs(pendingPlannerNotices) do count=count+1 end
    if not previous and count>=100 then return end
    pendingPlannerNotices[pendingKey]={revision=noticeRevision,role=noticeRole,time=plannerClock()}
    return
  end
  local id,raidNum,when,title=msg:match('^E1|(%d+)|(%d+)|([^|]+)|([^|]+)$')
  if id then
    raidNum=tonumber(raidNum)
    if #id>22 or #when>70 or #title>70 or not raidNum or raidNum<1 or raidNum>8 or when:find('[%z\001-\031\127]') or title:find('[%z\001-\031\127]') then return end
    local key=source.name..'|'..id
    if plan.items[key] or plan.cancelled[key] then diag('drop.planner.duplicate'); return end
    local count=0; for _ in pairs(plan.items) do count=count+1 end
    if count>=100 then diag('drop.planner.limit'); return end
    diag('accept.planner.create'); plan.items[key]={author=source.name,id=id,raid=raidNum,when=when,title=raidNum<=3 and NS.Raids[raidNum].name or title,signups={}}
    if NS.EventSync then plan.items[key].description=NS.EventSync.takeDescription(source.name,id) end
    prunePlannerReplies()
    local scope=guildKey()
    for pendingKey,v in pairs(pendingPlannerReplies) do
      if v.scope==scope and v.eventKey==key then
        acceptPlannerReply(plan.items[key],v.source,v.role,v.revision)
        pendingPlannerReplies[pendingKey]=nil
      end
    end
    if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildEvent',msg,source.name) end
    refreshPlanner(); return
  end
  local author,signupId,seq,role=msg:match('^R2|([^|]+)|(%d+)|(%d+)|([A-Z]+)$')
  local revision
  if author then
    if #seq>16 then return end
    revision=tonumber(seq)
    if not revision or revision<1 or revision>9000000000000000 or revision~=math.floor(revision) then return end
  else author,signupId,role=msg:match('^R1|([^|]+)|(%d+)|([A-Z]+)$') end
  if not author or (role~='TANK' and role~='HEAL' and role~='DPS' and role~='NIE') then return end
  if #signupId>22 then return end
  local organizer=member(author); if not organizer then diag('drop.planner.organizer_unknown'); return end
  local eventKey=organizer.name..'|'..signupId
  if plan.cancelled[eventKey] then return end
  local e=plan.items[eventKey]
  if not e then
    if not revision then return end
    prunePlannerReplies()
    local scope=guildKey(); if not scope then return end
    local pendingKey=scope..'\000'..eventKey..'\000'..source.name
    local previous=pendingPlannerReplies[pendingKey]
    if previous and revision<=previous.revision then return end
    local count=0; for _ in pairs(pendingPlannerReplies) do count=count+1 end
    if not previous and count>=100 then return end
    pendingPlannerReplies[pendingKey]={scope=scope,eventKey=eventKey,source=source.name,role=role,revision=revision,time=plannerClock()}
    return
  end
  if not acceptPlannerReply(e,source.name,role,revision) then diag('drop.planner.stale_or_limit'); return end
  diag('accept.planner.reply')
  if revision then
    prunePlannerNotices()
    local selfMember=me(); local scope=guildKey()
    if selfMember and scope and organizer.name:lower()==selfMember.name:lower() and source.name:lower()~=selfMember.name:lower() then
      local pendingKey=noticeKey(scope,eventKey,source.name); local pending=pendingPlannerNotices[pendingKey]
      if pending and revision>=pending.revision then
        if revision==pending.revision and role==pending.role then deliverPlannerNotice(e,source.name,revision,role) end
        pendingPlannerNotices[pendingKey]=nil
      end
    end
  end
  if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildEvent',msg,source.name) end
  refreshPlanner()
end
openEventPopup=function(key,keepPage)
  local plan=plannerTable(); local event=plan and plan.items[key]
  if not ui or not event then if ui and ui.eventPopup then ui.eventPopup:Hide() end; return end
  if not ui.eventPopup then
    local oldRecycle=recycle; recycle=false
    local p=CreateFrame('Frame','TheSentencedEventDetail',UIParent,'BackdropTemplate')
    p:SetSize(580,650); p:SetPoint('CENTER',UIParent,'CENTER',0,0); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(20); p:SetClampedToScreen(true)
    p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1}); p:SetBackdropColor(.07,.08,.10,.98); p:SetBackdropBorderColor(.65,.36,.25,1)
    p:SetMovable(true); p:EnableMouse(true); p:RegisterForDrag('LeftButton')
    p:SetScript('OnDragStart',function(self) self:StartMoving() end); p:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end); p:SetScript('OnHide',function(self) self:StopMovingOrSizing() end)
    p.title=font(p,'',16,gold); p.title:SetPoint('TOPLEFT',18,-17); p.title:SetWidth(500)
    p.subtitle=font(p,'',11,muted); p.subtitle:SetPoint('TOPLEFT',18,-48); p.subtitle:SetWidth(530)
    p.summary=font(p,'',11,white); p.summary:SetPoint('TOPLEFT',18,-80); p.summary:SetWidth(530)
    p.note=font(p,'Tylko znane odpowiedzi. Odbiór zapisów przez innych nie jest potwierdzony.',10,muted); p.note:SetPoint('BOTTOMLEFT',18,16); p.note:SetWidth(530)
    p.description=font(p,'',11,white); p.description:SetPoint('TOPLEFT',18,-151); p.description:SetWidth(530); p.description:SetHeight(48)
    p.itemButtons={}; for i=1,6 do
      local b=button(p,'PRZEDMIOT',168,26,function(self) if self.data and NS.BoardItems then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetPoint('TOPLEFT',18+((i-1)%3)*176,-205-math.floor((i-1)/3)*30)
      b:SetScript('OnEnter',function(self) if self.data and NS.BoardItems then NS.BoardItems.tooltip(self,self.data) end end)
      b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
      p.itemButtons[i]=b
    end
    p.rows={}; for i=1,9 do local f=font(p,'',12,white); f:SetPoint('TOPLEFT',20,-279-(i-1)*29); f:SetWidth(520); p.rows[i]=f end
    p.roles={}; for i,role in ipairs({'TANK','HEAL','DPS','NIE'}) do
      local b=button(p,role,110,28,function()
        local current=plannerTable(); local e=current and current.items[p.eventKey]
        if not e then p:Hide(); log('Wydarzenie nie jest dostępne.'); return end
        local ok,why=sendPlannerSignup(e,role)
        log(ok and 'Próba zapisu — odbiór niepotwierdzony.' or (why or 'Błąd'))
      end,role~='NIE'); b:SetPoint('TOPLEFT',18+(i-1)*116,-112); p.roles[i]=b
    end
    p.prev=button(p,'<',36,26,function() p.listPage=math.max(1,p.listPage-1); openEventPopup(p.eventKey,true) end); p.prev:SetPoint('BOTTOMLEFT',18,48)
    p.pageText=font(p,'',11,muted,'CENTER'); p.pageText:SetPoint('BOTTOMLEFT',65,55); p.pageText:SetWidth(100)
    p.next=button(p,'>',36,26,function() p.listPage=math.min(p.pages,p.listPage+1); openEventPopup(p.eventKey,true) end); p.next:SetPoint('BOTTOMLEFT',176,48)
    p.share=button(p,'LINK DO /G',110,26,function()
      local plan=plannerTable(); local current=plan and plan.items[p.eventKey]
      if not current or not feature('guildLinks') or not NS.GuildLinks then return end
      local body=current.title..(current.description and (' — '..current.description) or '')
      local ok,reason=NS.GuildLinks.prepare('E',current.author,current.id,body,NS.GuildAccess.scopeId())
      if not ok then log(reason or 'Link do wydarzenia jest niedostępny.') end
    end); p.share:SetPoint('BOTTOMRIGHT',-18,48)
    p.calendar=button(p,'DO KALENDARZA',140,26,function()
      local plan=plannerTable(); local current=plan and plan.items[p.eventKey]; local selfMember=me()
      if not current or not selfMember or not feature('calendar') or not canManageGuildEntry(selfMember,current.author) or current.calendarState then return end
      local slot,reason=NS.GameCalendar.preview(current)
      if not slot then log(reason); return end
      local players={}
      for name,role in pairs(current.signups or {}) do
        if name~=selfMember.name and (role=='TANK' or role=='HEAL' or role=='DPS') and member(name) then players[#players+1]=name end
      end
      table.sort(players)
      local confirm=p.eventKey..'|'..table.concat(players,'|')
      if p.confirmCalendar~=confirm then
        p.confirmCalendar=confirm; p.calendar.caption:SetText('POTWIERDŹ WPIS')
        log(string.format('Kalendarz gry: %04d-%02d-%02d %02d:%02d. Zaproszenia: %d. Kliknij ponownie, aby zapisać.',slot.year,slot.month,slot.monthDay,slot.hour,slot.minute,#players))
        return
      end
      p.confirmCalendar=nil; p.calendar.caption:SetText('DO KALENDARZA')
      current.calendarState='pending'
      local accepted,reason=NS.GameCalendar.publish(current,players,function(saved)
        current.calendarState=saved and 'saved' or 'unknown'
        if ui and ui.eventPopup and ui.eventPopup:IsShown() then openEventPopup(ui.eventPopup.eventKey,true) end
        log(saved and 'Kalendarz gry potwierdził utworzenie wpisu. Zaproszenia oczekują na odpowiedź.' or 'Brak potwierdzenia z kalendarza. Sprawdź wpis przed ponowieniem.')
      end)
      if not accepted then current.calendarState=nil; log(reason) end
    end,true); p.calendar:SetPoint('BOTTOMRIGHT',-18,83)
    p.cancel=button(p,'ODWOŁAJ',105,26,function()
      local plan=plannerTable(); local current=plan and plan.items[p.eventKey]
      if not current or not canManageGuildEntry(me(),current.author) then return end
      if p.confirmCancel~=p.eventKey then
        p.confirmCancel=p.eventKey; p.cancel.caption:SetText('POTWIERDŹ'); return
      end
      local ok,why=sendPlanner('X1|'..p.eventKey)
      p.confirmCancel=nil; p.cancel.caption:SetText('ODWOŁAJ')
      log(ok and 'Odwołano. Zmiana została przekazana do gildii.' or (why or 'Nie udało się odwołać.'))
    end); p.cancel:SetPoint('RIGHT',p.share,'LEFT',-5,0)
    local close=button(p,'ZAMKNIJ',100,27,function() p:Hide() end); close:SetPoint('TOPRIGHT',-12,-12)
    tinsert(UISpecialFrames,'TheSentencedEventDetail'); ui.eventPopup=p; recycle=oldRecycle
  end
  local p=ui.eventPopup; p.eventKey=key; if not keepPage then p.listPage=1; p.confirmCancel=nil; p.confirmCalendar=nil end
  p.share:SetShown(feature('guildLinks'))
  p.cancel:SetShown(canManageGuildEntry(me(),event.author)==true)
  p.calendar:SetShown(feature('calendar') and canManageGuildEntry(me(),event.author)==true and NS.GameCalendar.polishEpoch(event.when)~=nil)
  if p.calendar.SetEnabled then p.calendar:SetEnabled(not event.calendarState) end
  p.calendar.caption:SetText(({saved='W KALENDARZU',pending='ZAPISYWANIE...',unknown='SPRAWDŹ KALENDARZ'})[event.calendarState]
    or (p.confirmCalendar and 'POTWIERDŹ WPIS' or 'DO KALENDARZA'))
  p.cancel.caption:SetText(p.confirmCancel==key and 'POTWIERDŹ' or 'ODWOŁAJ')
  p.title:SetText(plain(event.title)); p.subtitle:SetText(plain(event.when)..'  •  Organizator: '..plain(event.author))
  local description=event.description or ''
  p.description:SetText(description~='' and plain(NS.BoardItems.label(description)) or 'Brak opisu.')
  local links=NS.BoardItems and NS.BoardItems.links(description) or {}
  for i,b in ipairs(p.itemButtons) do local data=links[i]; b.data=data; b:SetShown(data~=nil); if data then b.caption:SetText(NS.BoardItems.label('{'..data..'}')) end end
  local signed,counts={},{TANK=0,HEAL=0,DPS=0,NIE=0}
  for name,role in pairs(event.signups) do if counts[role] then counts[role]=counts[role]+1; signed[#signed+1]={name=name,role=role} end end
  table.sort(signed,function(a,b) return a.name:lower()<b.name:lower() end)
  p.summary:SetText('TANK '..counts.TANK..'    HEAL '..counts.HEAL..'    DPS '..counts.DPS..'    NIE '..counts.NIE..(event.raid<=3 and ('    •    Limit '..NS.Raids[event.raid].size) or ''))
  p.pages=math.max(1,math.ceil(#signed/9)); p.listPage=math.max(1,math.min(p.listPage or 1,p.pages))
  for i,row in ipairs(p.rows) do local e=signed[(p.listPage-1)*9+i]; row:SetText(e and (plain(e.name)..'  /  '..e.role) or (i==1 and #signed==0 and 'Brak znanych odpowiedzi.' or '')) end
  p.pageText:SetText(p.listPage..' / '..p.pages); p:Show()
end
-- The composer is a persistent separate window: closing it keeps the draft.
showPlannerCompose=function()
  local plan=plannerTable(); if not ui or not plan then log('Dołącz do gildii.'); return end
  local types={NS.Raids[1].name,NS.Raids[2].name,NS.Raids[3].name,'Dungeon','Questy','PvP','Farmienie','Własne wydarzenie'}
  if not ui.eventCompose then
    local saved=recycle; recycle=false
    local p=CreateFrame('Frame','TheSentencedEventCompose',UIParent,'BackdropTemplate'); ui.eventCompose=p
    p:SetSize(650,560); p:SetPoint('CENTER',UIParent,'CENTER',0,0); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(20); p:SetClampedToScreen(true); p:EnableMouse(true)
    p:SetBackdrop({bgFile='Interface\\DialogFrame\\UI-DialogBox-Background',edgeFile='Interface\\DialogFrame\\UI-DialogBox-Gold-Border',tile=true,tileSize=32,edgeSize=24,insets={left=6,right=6,top=6,bottom=6}}); p:SetBackdropColor(.35,.30,.24,1); p:SetBackdropBorderColor(1,1,1,1)
    local bg=p:CreateTexture(nil,'BACKGROUND',nil,-7);bg:SetPoint('TOPLEFT',6,-6);bg:SetPoint('BOTTOMRIGHT',-6,6);bg:SetColorTexture(.065,.052,.039,.98)
    p:SetMovable(true); p:RegisterForDrag('LeftButton'); p:SetScript('OnDragStart',function(self) self:StartMoving() end); p:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end); p:SetScript('OnHide',function(self) self:StopMovingOrSizing(); if self.calendar then self.calendar:Hide() end end)
    local heading=font(p,'NOWE WYDARZENIE GILDII',18,gold); heading:SetPoint('TOPLEFT',22,-18)
    local desc=font(p,'Wybierz rodzaj wydarzenia i ustaw termin.',12,muted); desc:SetPoint('TOPLEFT',22,-47)
    local kind=font(p,'RODZAJ WYDARZENIA',11,gold); kind:SetPoint('TOPLEFT',22,-76)
    p.typeButtons={}; p.instanceSelected=false
    local function openInstance()
      local opened=NS.InstancePicker and NS.InstancePicker.pick(p,function(name,custom)
        p.instanceSelected=true; p.title:SetText(name or '')
        if custom then p.title:SetFocus() end
      end)
      if not opened then p.error:SetText('Lista instancji jest niedostępna.') end
    end
    local function refreshTypes(fromMenu)
      for i,b in ipairs(p.typeButtons) do b.caption:SetText((i==plannerSelection and '✓  ' or '○  ')..types[i]) end
      if not fromMenu and p.typeDropdown and p.typeDropdown.GenerateMenu then p.typeDropdown:GenerateMenu() end
      if p.chooseInstance then p.chooseInstance:SetShown(plannerSelection==4) end
      if p.title then p.title:SetWidth(plannerSelection==4 and 414 or 588) end
    end
    p.typeDropdown=nativeChoice(p,types,function()return plannerSelection end,function(index)
      plannerSelection=index;refreshTypes(true)
      if index==4 and p.chooseInstance and not p.instanceSelected then openInstance() end
    end,280) or false
    if p.typeDropdown then
      p.typeDropdown:SetPoint('TOPLEFT',22,-99)
      local guide=font(p,'Wybierz rodzaj wyprawy, następnie termin i opis.',11,muted);guide:SetPoint('TOPLEFT',22,-146)
    else for i,label in ipairs(types) do
      local index=i; local b=button(p,label,195,28,function()
        plannerSelection=index; refreshTypes()
        if index==4 and p.chooseInstance and not p.instanceSelected then openInstance() end
      end,true)
      b:SetPoint('TOPLEFT',22+((i-1)%3)*203,-99-math.floor((i-1)/3)*34); p.typeButtons[i]=b
    end end
    p.refreshTypes=refreshTypes
    local timeLabel=font(p,'DATA',11,gold); timeLabel:SetPoint('TOPLEFT',22,-210)
    p.when=edit(p,140,31,plannerDraftWhen,'RRRR-MM-DD'); p.when:SetPoint('TOPLEFT',22,-228)
    local clockLabel=font(p,'GODZINA',11,gold); clockLabel:SetPoint('TOPLEFT',270,-210)
    p.clock=edit(p,95,31,'','GG:MM'); p.clock:SetPoint('TOPLEFT',270,-228)
    local zoneHint=font(p,'Czas polski',12,muted); zoneHint:SetPoint('LEFT',p.clock,'RIGHT',12,0)
    local titleLabel=font(p,'NAZWA',11,gold); titleLabel:SetPoint('TOPLEFT',22,-276)
    p.title=edit(p,588,31,plannerDraftTitle,'Tytuł wydarzenia (opcjonalny)'); p.title:SetPoint('TOPLEFT',22,-294)
    p.chooseInstance=button(p,'WYBIERZ INSTANCJĘ',166,31,openInstance,true); p.chooseInstance:SetPoint('TOPRIGHT',-40,-294); p.chooseInstance:Hide()
    local descriptionLabel=font(p,'OPIS WYDARZENIA',11,gold); descriptionLabel:SetPoint('TOPLEFT',22,-337)
    p.description=edit(p,588,46,'','Napisz kilka słów o wydarzeniu...'); p.description:SetPoint('TOPLEFT',22,-355)
    p.description:SetMultiLine(true); p.description:SetMaxLetters(2000)
    if NS.BoardItems and NS.BoardItems.registerEditBox then NS.BoardItems.registerEditBox(p.description) end
    local addItem=button(p,'+ PRZEDMIOT',160,27,function()
      local opened=NS.BoardItems and NS.BoardItems.pick(p,function(data)
        p.description:Insert('{'..data..'}'); p.description:SetFocus()
      end)
      if not opened then p.error:SetText('Nie znaleziono przedmiotów w torbach albo API jest niedostępne.') end
    end,true); addItem:SetPoint('TOPLEFT',22,-409)
    p.descriptionPreview=font(p,'',11,muted); p.descriptionPreview:SetPoint('TOPLEFT',196,-411); p.descriptionPreview:SetWidth(414); p.descriptionPreview:SetHeight(28)
    local oldDescriptionChanged=p.description:GetScript('OnTextChanged')
    local function refreshDescription(self,...)
      if oldDescriptionChanged then oldDescriptionChanged(self,...) end
      local raw=self:GetText(); local display=raw
      if NS.BoardItems and NS.BoardItems.encode and NS.BoardItems.label then display=NS.BoardItems.label(NS.BoardItems.encode(raw)) end
      p.descriptionPreview:SetText(display~='' and ('Podgląd: '..preview(display,65)) or 'Podgląd opisu pojawi się tutaj.')
    end
    p.description:SetScript('OnTextChanged',refreshDescription); refreshDescription(p.description)
    plannerWhenField,plannerTitleField=p.when,p.title
    local function monthDays(y,m)
      if m==2 then return (y%4==0 and (y%100~=0 or y%400==0)) and 29 or 28 end
      return ({31,28,31,30,31,30,31,31,30,31,30,31})[m]
    end
    local function parsedDate(value)
      local y,m,d=value:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
      y,m,d=tonumber(y),tonumber(m),tonumber(d)
      if not y or y<1 or not m or m<1 or m>12 or not d or d<1 or d>monthDays(y,m) then return nil end
      return y,m,d
    end
    local calendar=CreateFrame('Frame',nil,p,'BackdropTemplate'); p.calendar=calendar
    calendar:SetSize(340,370); calendar:SetPoint('CENTER',p,'CENTER',0,0); calendar:SetFrameLevel(40); calendar:EnableMouse(true)
    calendar:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1}); calendar:SetBackdropColor(.065,.055,.055,1); calendar:SetBackdropBorderColor(.67,.39,.22,1)
    calendar.header=font(calendar,'',14,gold,'CENTER'); calendar.header:SetPoint('TOPLEFT',60,-17); calendar.header:SetWidth(220)
    local weekdays={'PN','WT','ŚR','CZ','PT','SO','ND'}
    for i,label in ipairs(weekdays) do local day=font(calendar,label,10,muted,'CENTER'); day:SetPoint('TOPLEFT',14+(i-1)*44,-52); day:SetWidth(40) end
    local function renderCalendar()
      local y,m=calendar.year,calendar.month
      calendar.header:SetText(string.format('%04d-%02d',y,m))
      local past=y-1
      local offset=(365*past+math.floor(past/4)-math.floor(past/100)+math.floor(past/400))%7
      for n=1,m-1 do offset=(offset+monthDays(y,n))%7 end
      local count=monthDays(y,m)
      for i,b in ipairs(calendar.days) do
        local d=i-offset
        if d>=1 and d<=count then
          b.day=d
          local selected=calendar.selectedYear==y and calendar.selectedMonth==m and calendar.selectedDay==d
          b.caption:SetText((selected and '* ' or '')..tostring(d)); b:Show()
        else b.day=nil; b:Hide() end
      end
      if calendar.selectedDay then
        calendar.selectedLabel:SetText(string.format('Wybrano: %04d-%02d-%02d',calendar.selectedYear,calendar.selectedMonth,calendar.selectedDay))
      else calendar.selectedLabel:SetText('Wybierz dzień wydarzenia.') end
    end
    calendar.days={}
    for i=1,42 do
      local b=button(calendar,'',40,25,function(self)
        if self.day then calendar.selectedYear,calendar.selectedMonth,calendar.selectedDay=calendar.year,calendar.month,self.day; calendar.error:SetText(''); renderCalendar() end
      end)
      b:SetPoint('TOPLEFT',14+((i-1)%7)*44,-72-math.floor((i-1)/7)*29); calendar.days[i]=b
    end
    calendar.prev=button(calendar,'<',36,26,function()
      if calendar.month==1 then if calendar.year<=1 then return end; calendar.year=calendar.year-1; calendar.month=12 else calendar.month=calendar.month-1 end
      renderCalendar()
    end); calendar.prev:SetPoint('TOPLEFT',12,-12)
    calendar.next=button(calendar,'>',36,26,function()
      if calendar.month==12 then if calendar.year>=9999 then return end; calendar.year=calendar.year+1; calendar.month=1 else calendar.month=calendar.month+1 end
      renderCalendar()
    end); calendar.next:SetPoint('TOPRIGHT',-12,-12)
    calendar.selectedLabel=font(calendar,'',11,muted); calendar.selectedLabel:SetPoint('TOPLEFT',14,-254); calendar.selectedLabel:SetWidth(200)
    local calendarClockLabel=font(calendar,'GODZINA',11,gold); calendarClockLabel:SetPoint('TOPLEFT',14,-278)
    calendar.clock=edit(calendar,90,27,'','GG:MM'); calendar.clock:SetPoint('TOPLEFT',91,-272)
    local calendarHint=font(calendar,'Czas polski',10,muted); calendarHint:SetPoint('TOPLEFT',186,-278); calendarHint:SetWidth(145)
    calendar.error=font(calendar,'',10,{1,.56,.38}); calendar.error:SetPoint('TOPLEFT',14,-308); calendar.error:SetWidth(310)
    local function applyCalendar()
      if not calendar.selectedDay then calendar.error:SetText('Wybierz dzień wydarzenia.'); return end
      local value=calendar.clock:GetText():match('^%s*(.-)%s*$')
      local h,m=value:match('^(%d%d):(%d%d)$'); h,m=tonumber(h),tonumber(m)
      if not h or h>23 or not m or m>59 then calendar.error:SetText('Podaj godzinę GG:MM.'); return end
      p.when:SetText(string.format('%04d-%02d-%02d',calendar.selectedYear,calendar.selectedMonth,calendar.selectedDay))
      p.clock:SetText(value); calendar:Hide(); p.title:SetFocus()
    end
    calendar.clock:SetScript('OnEnterPressed',applyCalendar)
    calendar.clock:SetScript('OnTabPressed',function(self) self:ClearFocus() end)
    local calendarClose=button(calendar,'ANULUJ',100,25,function() calendar:Hide() end); calendarClose:SetPoint('BOTTOMLEFT',14,12)
    calendar.apply=button(calendar,'USTAW TERMIN',140,25,applyCalendar,true); calendar.apply:SetPoint('BOTTOMRIGHT',-14,12)
    calendar:Hide()
    local calendarButton=button(p,'KALENDARZ',93,31,function()
      local y,m,d=parsedDate(p.when:GetText())
      calendar.selectedYear,calendar.selectedMonth,calendar.selectedDay=y,m,d
      calendar.clock:SetText(p.clock:GetText()); calendar.error:SetText('')
      if not y and date then
        local ok,t=pcall(date,'*t')
        if ok and type(t)=='table' and type(t.year)=='number' and type(t.month)=='number' and t.year>=1 and t.year<=9999 and t.month>=1 and t.month<=12 then y,m=t.year,t.month end
      end
      if not y then p.error:SetText('Wpisz poprawną datę, aby otworzyć kalendarz.'); return end
      calendar.year,calendar.month=y,m; renderCalendar(); calendar:Show()
    end,true); calendarButton:SetPoint('TOPLEFT',168,-228)
    local note=font(p,'Wysłanie jest próbą. Odbiór przez innych graczy nie jest potwierdzony.',11,muted); note:SetPoint('TOPLEFT',22,-455); note:SetWidth(590)
    p.error=font(p,'',11,{1,.56,.38}); p.error:SetPoint('TOPLEFT',22,-482); p.error:SetWidth(590)
    local function fail(message) p.error:SetText(message); log(message) end
    local function submit()
      p.error:SetText('')
      local current=plannerTable(); if not current then fail('Dołącz do gildii.'); return end
      local eventCount=0; for _ in pairs(current.items or {}) do eventCount=eventCount+1 end
      if eventCount>=100 then fail('Osiągnięto limit 100 wydarzeń.'); return end
      local day=p.when:GetText():match('^%s*(.-)%s*$')
      local clock=p.clock:GetText():match('^%s*(.-)%s*$')
      local t=p.title:GetText():match('^%s*(.-)%s*$')
      if not parsedDate(day) then fail('Podaj poprawną datę w formacie RRRR-MM-DD.'); return end
      local h,m=clock:match('^(%d%d):(%d%d)$'); h,m=tonumber(h),tonumber(m)
      if not h or h>23 or not m or m>59 then fail('Podaj godzinę w formacie GG:MM.'); return end
      if plannerSelection==4 and (not p.instanceSelected or t=='') then fail('Wybierz instancję lub wpisz nazwę innej instancji.'); return end
      local w=day..' '..clock..' PL'
      if plannerSelection<=3 then t=types[plannerSelection] elseif t=='' then t=types[plannerSelection] end
      if #t>70 or t:find('[|%z\001-\031\127]') then diag('blocked.planner.title',#t); fail('Nieprawidłowy tytuł.'); return end
      current.counter=current.counter+1
      local stamp=(GetServerTime and GetServerTime()) or (time and time()) or 0
      local id=tostring(stamp)..string.format('%04d',current.counter%10000)
      local descriptionPacket,description
      local rawDescription=p.description:GetText()
      if rawDescription:match('%S') then
        if not NS.EventSync then fail('Moduł opisu wydarzenia jest niedostępny.'); return end
        descriptionPacket,description=NS.EventSync.encodeDescription(id,rawDescription)
        if not descriptionPacket then fail(description or 'Nieprawidłowy opis.'); return end
      end
      local payload=table.concat({'E1',id,plannerSelection,w,t},'|')
      local ok,why=sendPlanner(payload)
      if ok and NS.EventRetry then NS.EventRetry.enqueue(payload,guildKey()) end
      if ok and descriptionPacket then
        local own=me(); local event=own and current.items[own.name..'|'..id]
        if not event then fail('Wysłano próbę wydarzenia, lecz nie udało się zapisać lokalnej kopii opisu. Szkic zachowano.'); return end
        event.description=description
        local sent=sendPlanner(descriptionPacket)
        local retry=NS.EventRetry and NS.EventRetry.enqueue(descriptionPacket,guildKey(),payload)
        if sent then log('Próba publikacji wydarzenia i opisu. Odbiór niepotwierdzony.')
        elseif retry then log('Wydarzenie przyjęto do wysyłki, ale opis nie został wysłany. Opis zachowano lokalnie i zaplanowano ponowienie; odbiór niepotwierdzony.')
        else log('Wydarzenie przyjęto do wysyłki, ale opis nie został wysłany. Opis zachowano lokalnie; nie udało się zaplanować ponowienia.') end
      elseif ok then log('Próba publikacji. Poproś innych o potwierdzenie odbioru.') else fail(why or 'Nie udało się wysłać wydarzenia.') end
      if ok then plannerDraftWhen,plannerDraftTitle='',''; p.instanceSelected=false; p.when:SetText(''); p.clock:SetText(''); p.title:SetText(''); p.description:SetText(''); calendar:Hide(); p:Hide(); if ui and ui.root:IsShown() then render() end end
    end
    p.when:SetScript('OnTabPressed',function() p.clock:SetFocus() end)
    p.clock:SetScript('OnTabPressed',function() p.title:SetFocus() end)
    p.title:SetScript('OnTabPressed',function() p.description:SetFocus() end)
    p.description:SetScript('OnTabPressed',function() p.when:SetFocus() end)
    p.when:SetScript('OnEnterPressed',function() p.clock:SetFocus() end)
    p.clock:SetScript('OnEnterPressed',function() p.title:SetFocus() end)
    p.title:SetScript('OnEnterPressed',submit)
    local close=button(p,'ANULUJ',145,32,function() p:Hide() end); close:SetPoint('BOTTOMLEFT',22,20)
    local publish=button(p,'OPUBLIKUJ WYDARZENIE',230,32,submit,true); publish:SetPoint('BOTTOMRIGHT',-22,20)
    tinsert(UISpecialFrames,'TheSentencedEventCompose'); recycle=saved
  end
  local p=ui.eventCompose; p.error:SetText(''); p.refreshTypes(); p:Show()
end
function NS.renderPlanner()
  text('WYDARZENIA GILDII',10,gold,8)
  text('Terminy podajemy w czasie polskim. Zapisy w grze są przesyłane między zalogowanymi gildiowiczami.',11,muted)
  local plan=plannerTable(); if not plan then text('Dołącz do gildii.',12,muted); return end
  local events={}; for _,e in pairs(plan.items) do events[#events+1]=e end
  table.sort(events,function(a,b) if a.id==b.id then return a.author<b.author end return a.id>b.id end)
  if #events==0 then text('Brak odebranych wydarzeń.',11,muted) end
  for _,e in ipairs(events) do
    local counts={TANK=0,HEAL=0,DPS=0,NIE=0}
    for _,r in pairs(e.signups) do if counts[r] then counts[r]=counts[r]+1 end end
    local info=plain(e.when)..'  •  '..plain(e.author)
    if e.raid<=3 then info=info..'  •  limit '..NS.Raids[e.raid].size end
    local eventKey=e.author..'|'..e.id
    local row=bar(plain(e.title),info,gold,function() openEventPopup(eventKey) end)
    local details=button(row,'SZCZEGÓŁY',112,27,function() openEventPopup(eventKey) end,true); details:SetPoint('RIGHT',-8,0)
    text('TANK '..counts.TANK..'   HEAL '..counts.HEAL..'   DPS '..counts.DPS..'   NIE '..counts.NIE..'   •   tylko znane odpowiedzi',11,muted,8)
    local x=4
    for _,role in ipairs({'TANK','HEAL','DPS','NIE'}) do
      local b=button(ui.content,role,100,27,function()
        local ok,why=sendPlannerSignup(e,role)
        log(ok and 'Wysłano odpowiedź — odbiór niepotwierdzony.' or (why or 'Błąd')); if ok then render() end
      end,role~='NIE'); b:SetPoint('TOPLEFT',x,ui.y); x=x+106
    end
    ui.y=ui.y-37
    local signed={}; for name,role in pairs(e.signups) do if role~='NIE' then signed[#signed+1]={name=name,role=role} end end
    table.sort(signed,function(a,b) return a.name:lower()<b.name:lower() end)
    for _,signup in ipairs(signed) do
      local row=bar(plain(signup.name)..'  /  '..signup.role,'Ręczne zaproszenie przez organizatora; gracz musi je zaakceptować.',red)
      local actor=me()
      if actor and actor.name==e.author then
        local invite=button(row,'ZAPROŚ',80,26,function()
          if InCombatLockdown and InCombatLockdown() then log('Zapraszanie wstrzymane podczas walki.'); return end
          if not C_PartyInfo or not C_PartyInfo.InviteUnit then log('API zapraszania niedostępne.'); return end
          if C_PartyInfo.CanInvite and not C_PartyInfo.CanInvite() then log('Nie masz obecnie uprawnień do zapraszania.'); return end
          local success=pcall(C_PartyInfo.InviteUnit,signup.name)
          log(success and ('Próba zaproszenia: '..plain(signup.name)..'. Gracz musi je zaakceptować.') or 'Zaproszenie zostało zablokowane.')
        end)
        invite:SetPoint('RIGHT',-8,0)
      end
    end
  end
  text('Organizator nie widzi odpowiedzi osób offline i może mieć niepełną listę. Nie polegaj na niej przed testem synchronizacji.',11,muted)
end
local function raidsPage()
  section('RAIDY  /  FOREVER','Przygotuj wyprawę','Dane wg zapowiedzi Blizzarda z 20.10.2026. Terminy i mechaniki mogą się zmienić.')
  if type(ToggleEncounterJournal)=='function' then
    addAction('DZIENNIK INSTANCJI WOW',function() ToggleEncounterJournal() end,245)
  end
  text('OTWARCIE PLANOWANE: 9 GRUDNIA 2026',11,gold,12)
  for _,r in ipairs(NS.Raids) do bar(r.name..'  /  '..r.size..' OSÓB',r.info,gold) end
end
local findKind=1
local findTypes={'MINERAŁ','ZIOŁO','SKRZYNIA','INNE','QUEST','SKARB'}
local function findsTable()
  local key=guildKey(); if not key then return nil end
  db.finds=db.finds or {}; db.finds[key]=db.finds[key] or {items={},counter=0}
  return db.finds[key]
end
local function shareFinds(msg)
  if msg:match('^M[12]|') and not feature('mapShare') then return false,'Punkt zapisano tylko lokalnie.' end
  if msg:match('^G1|') and not feature('guildLoot') then return false,'Zgłaszanie łupów jest wyłączone.' end
  if #msg>200 or not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then return false,'Wysyłanie niedostępne.' end
  local my=me(); if not my then diag('blocked.map.self_unresolved'); return false,'Odśwież roster gildii.' end
  local ok,res=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildFinds',msg,'GUILD')
  if not ok or type(res)~='number' or res~=0 then return false,'Wysłanie nie powiodło się.' end
  NS.receiveFinds(msg,my.name); return true
end
local function nextFindId(store)
  store.counter=store.counter+1
  return tostring((GetServerTime and GetServerTime()) or (time and time()) or 0)..string.format('%04d',store.counter%10000)
end
function NS.receiveFinds(msg,sender)
  if NS.TestCleanup and NS.TestCleanup.block(guildKey(),'TSGuildFinds',msg,sender) then return end
  if type(msg)~='string' or #msg>200 then return end
  local player=member(sender); local store=findsTable(); if not player or not store then diag('drop.finds.member_or_scope'); return end
  local tag,id,tail=msg:match('^(%u%d)|(%d+)|(.+)$'); if not id or #id>22 then return end
  local key=player.name..'|'..id
  if store.items[key] then return end
  local count=0; for _ in pairs(store.items) do count=count+1 end; if count>=500 then return end
  local value
  if tag=='G1' then
    if not feature('guildLoot') then return end
    local item=tonumber(tail)
    if not item or item~=math.floor(item) or item<1 or item>100000000 then return end
    value={type='LOOT',id=id,author=player.name,item=item}
  elseif tag=='M1' or tag=='M2' then
    local map,x,y,kind,label
    if tag=='M1' then map,x,y,kind=tail:match('^(%d+)|(%d+)|(%d+)|(%d+)$')
    else map,x,y,kind,label=tail:match('^(%d+)|(%d+)|(%d+)|(%d+)|([^|]+)$') end
    map,x,y,kind=tonumber(map),tonumber(x),tonumber(y),tonumber(kind)
    if not map or map<1 or map>1000000 or not x or x>10000 or not y or y>10000 or not kind or kind<1 or kind>6 or (label and (#label>50 or label:find('[%z\001-\031\127]'))) then return end
    value={type='MAP',id=id,author=player.name,map=map,x=x,y=y,kind=kind,label=label or findTypes[kind]}
  else return end
  store.items[key]=value; diag('accept.finds.'..value.type)
  if NS.Archive and feature('archive') then NS.Archive.recordDirect('TSGuildFinds',msg,player.name) end
  if ui and ui.root:IsShown() and (page=='ŁUPY' or page=='MAPA') and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render() end
end
local function getFinds(kind)
  local store=findsTable(); local rows={}
  if kind=='LOOT' and not feature('guildLoot') then return store,rows end
  if store then for _,e in pairs(store.items) do if e.type==kind then rows[#rows+1]=e end end end
  if kind=='MAP' and db then
    local currentGuild=guildKey()
    for _,nodes in ipairs({db.autoNodes or {},db.manualNodes or {}}) do for _,node in ipairs(nodes) do
      -- Unscoped historical nodes remain local and visible, without being
      -- attributed to this guild or eligible for catch-up transmission.
      if node.scope==nil or (currentGuild and node.scope==currentGuild) then
      local duplicate=false
      for _,e in ipairs(rows) do if e.map==node.map and e.kind==node.kind and math.abs(e.x-node.x)<=10 and math.abs(e.y-node.y)<=10 then duplicate=true; break end end
      if not duplicate then rows[#rows+1]=node end
      end
    end end
    local hidden=db.hiddenMapPins and db.hiddenMapPins[guildKey() or ''] or {}
    local visible={}
    for _,e in ipairs(rows) do
      local suppressed=false
      for _,h in ipairs(hidden) do
        if h.map==e.map and h.kind==e.kind and math.abs(h.x-e.x)<=10 and math.abs(h.y-e.y)<=10 then suppressed=true; break end
      end
      if not suppressed then visible[#visible+1]=e end
    end
    rows=visible
  end
  table.sort(rows,function(a,b) if a.id==b.id then return a.author<b.author end; return a.id>b.id end)
  return store,rows
end
function NS.getMapPins()
  local _,rows=getFinds('MAP'); return rows
end
-- Hiding is local and reversible. Shared records and other players' copies are untouched.
function NS.hideMapPin(entry)
  local key=db and guildKey()
  if not key or type(entry)~='table' or type(entry.map)~='number' or type(entry.kind)~='number' or type(entry.x)~='number' or type(entry.y)~='number' then return false end
  db.hiddenMapPins=db.hiddenMapPins or {}; local list=db.hiddenMapPins[key] or {}; db.hiddenMapPins[key]=list
  for _,h in ipairs(list) do if h.map==entry.map and h.kind==entry.kind and math.abs(h.x-entry.x)<=10 and math.abs(h.y-entry.y)<=10 then return true end end
  if #list>=500 then return false end
  list[#list+1]={map=entry.map,kind=entry.kind,x=entry.x,y=entry.y}
  return true
end
function NS.restoreHiddenMapPins()
  local key=db and guildKey(); if not key then return false end
  if db.hiddenMapPins then db.hiddenMapPins[key]=nil end
  return true
end
function NS.pinOptions() return db and db.mapPinsWorld,db and db.mapPinsMini,db and db.mapHideNearResources~=false end
function NS.recordAutomaticFind(map,x,y,kind)
  if not db or type(map)~='number' or type(x)~='number' or type(y)~='number' or (kind~=1 and kind~=2) or x<0 or x>10000 or y<0 or y>10000 then return false end
  db.autoNodes=db.autoNodes or {}
  local scope=guildKey()
  for _,n in ipairs(db.autoNodes) do if n.scope==scope and n.map==map and n.kind==kind and math.abs(n.x-x)<=10 and math.abs(n.y-y)<=10 then return false end end
  local store=findsTable()
  local id
  if store then
    -- Manual and automatic markers share one guild counter so they cannot
    -- independently choose the same ID in the same second.
    id=nextFindId(store)
  else
    local stamp=(GetServerTime and GetServerTime()) or 0
    db.autoCounter=(db.autoCounter or 0)+1
    id=tostring(stamp)..string.format('%04d',db.autoCounter%10000)
  end
  local who=me()
  local label=kind==1 and 'Minerał (zebrany)' or 'Zioło (zebrane)'
  db.autoNodes[#db.autoNodes+1]={type='MAP',id=id,author=who and who.name or (UnitName and UnitName('player')) or '?',scope=who and guildKey() or nil,map=map,x=x,y=y,kind=kind,label=label}
  while #db.autoNodes>500 do table.remove(db.autoNodes,1) end
  if not feature('mapShare') then NS.gatherStatus='Zapisano punkt lokalnie.'; return true end
  local ok=shareFinds(table.concat({'M2',id,map,x,y,kind,label},'|'))
  NS.gatherStatus=ok and 'Zapisano lokalnie; próba wysyłki do gildii bez potwierdzenia.' or 'Zapisano lokalnie; nie udało się wysłać do gildii.'
  return true
end
local function lootPage()
  section('ZDOBYCZE GILDII  /  TEST','Pochwal się łupem','Wybierz przedmiot z toreb. To deklaracje gracza, a nie automatyczny odczyt loot logu.')
  local store,rows=getFinds('LOOT'); if not store then text('Dołącz do gildii.',12,muted); return end
  local search=edit(ui.content,250,31,lootQuery,'Filtr gracza (nick)'); search:SetPoint('TOPLEFT',4,ui.y)
  local searchBtn=button(ui.content,'SZUKAJ',90,31,function() lootQuery=search:GetText(); render() end); searchBtn:SetPoint('LEFT',search,'RIGHT',6,0)
  local sorter=button(ui.content,lootByPlayer and 'SORT: GRACZ' or 'SORT: NOWE',150,31,function() lootByPlayer=not lootByPlayer; lootQuery=search:GetText(); render() end); sorter:SetPoint('LEFT',searchBtn,'RIGHT',6,0); ui.y=ui.y-40
  if lootByPlayer then table.sort(rows,function(a,b) if a.author==b.author then return a.id>b.id end return a.author:lower()<b.author:lower() end) end
  local item=edit(ui.content,250,31,'','Numer przedmiotu, np. 12345'); item:SetPoint('TOPLEFT',4,ui.y)
  local send=button(ui.content,'UDOSTĘPNIJ',150,31,function()
    local v=itemId(item:GetText()); if not v then log('Podaj ID lub link przedmiotu.'); return end
    local ok,why=shareFinds(table.concat({'G1',nextFindId(store),v},'|'))
    log(ok and 'Próba udostępnienia. Inni muszą potwierdzić odbiór.' or (why or 'Błąd')); if ok then render() end
  end,true); send:SetPoint('LEFT',item,'RIGHT',8,0)
  local chosen=font(ui.content,'',11,muted); chosen:SetPoint('TOPLEFT',4,ui.y-39); chosen:SetWidth(600)
  local pick=button(ui.content,'WYBIERZ ŁUP Z TOREB',190,31,function() chooseCarriedItem(item,chosen) end)
  pick:SetPoint('LEFT',send,'RIGHT',8,0); ui.y=ui.y-62
  local journal=NS.LootJournal
  if journal then
    addAction('ZAPISZ PRZEDMIOT NA LIŚCIE ŻYCZEŃ',function()
      local id=itemId(item:GetText())
      if not id then log('Wpisz ID lub wklej link przedmiotu.'); return end
      local added=journal.toggleWish(id)
      if added==nil then log('Lista życzeń mieści 30 przedmiotów.'); return end
      log(added and 'Dodano do prywatnej listy życzeń.' or 'Usunięto z listy życzeń.'); render()
    end,330)
    local wishes=journal.wishlist()
    if #wishes>0 then
      text('PRYWATNA LISTA ŻYCZEŃ',10,gold,6)
      local found={}
      for _,entry in ipairs(journal.entries()) do found[entry.item]=true end
      for _,id in ipairs(wishes) do
        local f=bar(itemLabel(id),found[id] and 'Zapisany w Twoim dzienniku łupów' or 'Poszukiwany',gold)
        local peek=button(f,'PODGLĄD',90,26,function(self) NS.BoardItems.tooltip(self,'item:'..id) end)
        peek:SetPoint('RIGHT',-90,0)
        peek:SetScript('OnEnter',function(self) NS.BoardItems.tooltip(self,'item:'..id) end)
        peek:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
        local remove=button(f,'USUŃ',75,26,function() journal.toggleWish(id); render() end); remove:SetPoint('RIGHT',-8,0)
      end
    end
  end
  if #rows==0 then text('Nie masz jeszcze odebranych zgłoszeń.',12,muted) end
  local shown=0
  for _,e in ipairs(rows) do if shown<100 and e.author:lower():find(lootQuery:lower(),1,true) then shown=shown+1; bar(itemLabel(e.item),plain(e.author)..'  •  zgłoszenie gracza',gold) end end
  if #rows>0 and shown==0 then text('Brak łupów dla wskazanego gracza.',11,muted) end
  text('Nie gwarantujemy prawdziwości zgłoszenia ani jakości przedmiotu. Tylko gracze z addonem online mogą odebrać zgłoszenie.',11,muted)
end
local function mapPage()
  section('ODKRYCIA  /  TEST','Mapa wspólnych znalezisk','Dodaj swoją aktualną pozycję. Możesz wskazać pojedynczy punkt na mapie Blizzarda.')
  addAction('OTWÓRZ MAPĘ ŚWIATA',function()
    if WorldMapFrame and WorldMapFrame.Show then WorldMapFrame:Show()
    elseif ToggleWorldMap then ToggleWorldMap()
    else log('Mapa świata jest niedostępna w tym kliencie.') end
  end,230)
  local store,rows=getFinds('MAP'); if not store then text('Dołącz do gildii.',12,muted); return end
  text('WYBIERZ RODZAJ ZNALEZISKA',10,gold,6)
  local findButtons={}
  local function refreshKinds() for i,b in ipairs(findButtons) do b.caption:SetText((i==findKind and '✓  ' or '○  ')..findTypes[i]) end end
  for i,kind in ipairs(findTypes) do
    local index=i
    local b=button(ui.content,kind,195,28,function() findKind=index; refreshKinds() end,true)
    b:SetPoint('TOPLEFT',4+((i-1)%3)*203,ui.y-math.floor((i-1)/3)*34); findButtons[i]=b
  end
  refreshKinds(); ui.y=ui.y-math.ceil(#findTypes/3)*34-4
  local label=edit(ui.content,290,31,'','Podpis miejsca (opcjonalny)'); label:SetPoint('TOPLEFT',4,ui.y)
  local publish=button(ui.content,'DODAJ MOJĄ POZYCJĘ',230,31,function()
    if not C_Map or not C_Map.GetBestMapForUnit or not C_Map.GetPlayerMapPosition then log('API mapy jest niedostępne.'); return end
    local validMap,map=pcall(C_Map.GetBestMapForUnit,'player')
    if not validMap or not map or (issecretvalue and issecretvalue(map)) then log('Nie można ustalić mapy.'); return end
    local validPoint,point=pcall(C_Map.GetPlayerMapPosition,map,'player')
    if not validPoint or not point or (issecretvalue and issecretvalue(point)) then log('Nie można ustalić pozycji.'); return end
    local validXY,x,y=pcall(function() return point:GetXY() end)
    if not validXY or not x or not y or (issecretvalue and (issecretvalue(x) or issecretvalue(y))) or x<0 or x>1 or y<0 or y>1 then log('Pozycja niedostępna.'); return end
    local labelText=label:GetText():match('^%s*(.-)%s*$'):gsub('[|%z\001-\031\127]',' ')
    if labelText=='' then labelText=findTypes[findKind] end
    if #labelText>50 then log('Podpis jest za długi (limit 50 bajtów).'); return end
    local id=nextFindId(store); local nx,ny=math.floor(x*10000+.5),math.floor(y*10000+.5)
    db.manualNodes=db.manualNodes or {}
    local my=me()
    db.manualNodes[#db.manualNodes+1]={type='MAP',id=id,author=my and my.name or (UnitName and UnitName('player')) or '?',scope=my and guildKey() or nil,map=map,x=nx,y=ny,kind=findKind,label=labelText}
    while #db.manualNodes>500 do table.remove(db.manualNodes,1) end
    local msg=table.concat({'M2',id,map,nx,ny,findKind,labelText},'|')
    local ok=shareFinds(msg)
    log(ok and 'Punkt zapisany lokalnie; wysyłka do gildii bez potwierdzenia odbioru.'
      or (feature('mapShare') and 'Punkt zapisany lokalnie. Wysyłka do gildii nie powiodła się.' or 'Punkt zapisany tylko lokalnie.'))
    render()
  end,true); publish:SetPoint('LEFT',label,'RIGHT',8,0); ui.y=ui.y-44
  addAction('PRZYWRÓĆ UKRYTE PUNKTY',function() NS.restoreHiddenMapPins(); log('Przywrócono lokalnie ukryte punkty.'); render() end,260)
  text(NS.gatherStatus or 'Minerały i zioła są zapisywane po rozpoznanym zebraniu. Stan eksperymentalny.',10,muted)
  text(NS.mapPinsStatus or 'Znaczniki: oczekiwanie na inicjalizację.',10,muted)
  if #rows==0 then text('Brak odebranych znalezisk.',12,muted) end
  for i=1,math.min(#rows,100) do
    local e=rows[i]
    local f=bar(plain(e.label or findTypes[e.kind])..'  /  '..findTypes[e.kind]..'  /  MAPA '..e.map, string.format('%.1f, %.1f  •  %s',e.x/100,e.y/100,plain(e.author)),gold)
    local b=button(f,'WSKAŻ',70,27,function()
      if not C_Map or not C_Map.SetUserWaypoint or not UiMapPoint or not UiMapPoint.CreateFromCoordinates then log('Waypoint jest niedostępny w tym kliencie.'); return end
      local ok,result=pcall(C_Map.SetUserWaypoint,UiMapPoint.CreateFromCoordinates(e.map,e.x/10000,e.y/10000))
      log(ok and result and 'Ustawiono punkt na mapie.' or 'Nie można ustawić punktu na tej mapie.')
    end); b:SetPoint('RIGHT',-8,0)
    local hide=button(f,'UKRYJ',70,27,function()
      if NS.hideMapPin(e) then log('Ukryto tylko u Ciebie. Możesz przywrócić punkty na mapie.') else log('Nie można ukryć punktu; limit 500.') end
      render()
    end); hide:SetPoint('RIGHT',b,'LEFT',-5,0)
  end
  text('Prawy przycisk na znaczniku lub UKRYJ: tylko lokalnie, bez kasowania u innych. Przywróć je przyciskiem powyżej. Znaczniki pokazują zapisane miejsca, nie bieżące spawny.',11,muted)
end
-- Extend the existing event catch-up queue with this character's own board and
-- map records. Guild-keyed stores establish origin; old unscoped local nodes do not.
local function ownCatchupSnapshot()
  local rows=plannerOwnSnapshot()
  local g=guildKey(); local selfMember=me()
  if not g or not selfMember then return rows end
  local name=selfMember.name
  local function sameName(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
  local function add(key,prefix,payload)
    if #payload<=200 and not payload:find('[%z\001-\031\127]') then rows[#rows+1]={key=key,owner=name,prefix=prefix,payload=payload} end
  end
  local board=feature('board') and db.boards and db.boards[g]
  for key,entry in pairs(board and board.cancelled or {}) do
    if canManageGuildEntry(selfMember,entry.author) and (name==entry.actor or name==entry.author) then
      add('C:B:'..key,'TSGuildHall','B3|'..key)
    end
  end
  for _,e in ipairs(board and board.items or {}) do
    if type(e.id)=='string' and e.id:match('^%d+$') and type(e.sender)=='string' and type(e.text)=='string' then
      if sameName(e.sender,name) then
        for _,kind in ipairs(boardTypes) do
          local start=kind..' — '
          if e.text:sub(1,#start)==start then add('SB:'..e.id,'TSGuildHall',table.concat({'B1',e.id,kind,e.text:sub(#start+1)},'|')); break end
        end
      end
      if member(e.sender) then for _,reply in ipairs(e.replies or {}) do
        if sameName(reply.sender,name) and type(reply.key)=='string' and type(reply.text)=='string' then
          local owner,id=reply.key:match('^([^|]+)|(%d+)$')
          if id and sameName(owner,name) then add('SC:'..e.sender..':'..e.id..':'..id,'TSGuildHall',table.concat({'B2',e.sender,e.id,id,reply.text},'|')) end
        end
      end end
    end
  end
  local seen={}
  local function node(e,scoped)
    if not feature('mapShare') then return end
    if type(e)~='table' or e.type~='MAP' or not sameName(e.author,name) or (not scoped and e.scope~=g)
      or type(e.id)~='string' or not e.id:match('^%d+$') or #e.id>22 or seen[e.id]
      or type(e.map)~='number' or e.map~=math.floor(e.map) or e.map<1 or e.map>1000000
      or type(e.x)~='number' or e.x~=math.floor(e.x) or e.x<0 or e.x>10000
      or type(e.y)~='number' or e.y~=math.floor(e.y) or e.y<0 or e.y>10000
      or type(e.kind)~='number' or e.kind~=math.floor(e.kind) or e.kind<1 or e.kind>6
      or type(e.label)~='string' or #e.label<1 or #e.label>50 or e.label:find('[|%z\001-\031\127]') then return end
    seen[e.id]=true
    add('SM:'..e.id,'TSGuildFinds',table.concat({'M2',e.id,e.map,e.x,e.y,e.kind,e.label},'|'))
  end
  local finds=db.finds and db.finds[g]
  for _,e in pairs(finds and finds.items or {}) do node(e,true) end
  for _,list in ipairs({db.autoNodes or {},db.manualNodes or {}}) do for _,e in ipairs(list) do node(e,false) end end
  return rows
end
local function profilePage()
  local en=NS.Language and NS.Language.language()=='en'
  section(en and 'COMMUNITY  /  MEMBER PROFILE' or 'SPOŁECZNOŚĆ  /  PROFIL GRACZA',en and 'Guild member profile' or 'Profil gildyjny',en and 'Select a character in GUILD. Extra information is voluntarily shared by its owner.' or 'Wybierz postać w GILDIA. Dodatkowe informacje pochodzą od gracza i są udostępniane dobrowolnie.')
  if not selectedPlayer then text(en and 'Open GUILD and click a member.' or 'Otwórz GILDIA i kliknij wybraną osobę.',12,muted); return end
  local person=member(selectedPlayer)
  if not person then text(en and 'This character is not in the current roster.' or 'Postaci nie ma w aktualnym rosterze.',12,muted); return end
  bar(plain(person.name)..'  •  '..plain(person.level)..(en and ' level' or ' poziom'),plain(person.className)..'  •  '..plain(person.rank)..'  •  '..(person.online and 'ONLINE' or 'OFFLINE'),gold)
  local tabs={{'OVERVIEW',en and 'OVERVIEW' or 'PRZEGLĄD'},{'STATS',en and 'STATS' or 'STATYSTYKI'},{'LOOT',en and 'LOOT' or 'ŁUPY'},{'GEAR',en and 'GEAR' or 'EKWIPUNEK'},{'BAGS',en and 'BAGS' or 'TORBY'},{'PROFS',en and 'TRADES' or 'PROFESJE'}}
  for i,v in ipairs(tabs) do
    local b=button(ui.content,v[2],98,28,function() profileView=v[1]; render() end,profileView==v[1]); b:SetPoint('TOPLEFT',4+(i-1)*103,ui.y)
  end
  ui.y=ui.y-39
  local record=NS.Profiles and NS.Profiles.get(person.name)
  local _,drops=getFinds('LOOT'); local count=0
  for _,e in ipairs(drops) do if e.author:lower()==person.name:lower() then count=count+1 end end
  local function empty()
    text(en and 'No shared data was received. This section may be private or the owner may be offline.' or 'Nie otrzymano udostępnionych danych. Sekcja może być prywatna albo gracz jest offline.',11,muted)
  end
  local function stamp(value)
    local ts=value and value.received
    local display=tostring(ts or '?')
    if ts and ts>0 and date then local ok,formatted=pcall(date,'%Y-%m-%d %H:%M',ts); if ok and type(formatted)=='string' then display=formatted end end
    return (en and 'Received: ' or 'Odebrano: ')..display
  end
  if profileView=='OVERVIEW' then
    bar(en and 'GUILD DATA' or 'DANE Z GILDII',plain(person.className)..'  •  '..plain(person.rank)..'  •  '..plain(person.zone),gold)
    if type(person.note)=='string' and person.note~='' then
      text(en and 'PUBLIC GUILD NOTE' or 'PUBLICZNA NOTATKA GILDYJNA',10,gold,7)
      text(plain(person.note),12,white)
    end
    if record and record.A then bar(en and 'DECLARED MAIN CHARACTER' or 'DEKLAROWANA GŁÓWNA POSTAĆ',plain(record.A.main)..'  •  '..stamp(record.A),gold) end
    bar((en and 'REPORTED LOOT  /  ' or 'ZGŁOSZONE ŁUPY  /  ')..count,en and 'Manual reports received by this character; history may be incomplete.' or 'Ręczne zgłoszenia odebrane przez tę postać; historia może być niepełna.',red)
    text(en and 'Gold, bags, gear, stats and professions are shown only if the player shared them. Data may be stale.' or 'Złoto, torby, wyposażenie, statystyki i profesje widać tylko po ich udostępnieniu przez gracza. Dane mogą być nieaktualne.',11,muted)
  elseif profileView=='STATS' then
    if record and record.S then
      local v=record.S.values
      bar(en and 'ATTRIBUTES' or 'ATRYBUTY',string.format('STR %d  •  AGI %d  •  STA %d  •  INT %d  •  SPI %d',v[1],v[2],v[3],v[4],v[5]),gold)
      bar(en and 'MAX HEALTH' or 'MAKSYMALNE ZDROWIE',tostring(v[6])..'  •  '..stamp(record.S),red)
    else empty() end
    if record and record.G then
      local copper=record.G.copper
      bar(en and 'GOLD' or 'ZŁOTO',string.format('%d g  %d s  %d c',math.floor(copper/10000),math.floor(copper/100)%100,copper%100)..'  •  '..stamp(record.G),gold)
    else text(en and 'Gold was not shared or received.' or 'Złoto nie zostało udostępnione lub odebrane.',11,muted) end
  elseif profileView=='LOOT' then
    if count==0 then empty() end
    for _,e in ipairs(drops) do if e.author:lower()==person.name:lower() then bar(itemLabel(e.item),en and 'Manual player report.' or 'Ręczne zgłoszenie gracza.',gold) end end
    text(en and 'This is not a complete or verified loot log.' or 'To nie jest pełny ani zweryfikowany dziennik lootu.',11,muted)
  elseif profileView=='GEAR' or profileView=='BAGS' then
    local category=profileView=='GEAR' and 'E' or 'B'
    local info=record and record[category]
    if not info then empty()
    elseif #info.items==0 then text(en and 'The shared list is empty.' or 'Udostępniona lista jest pusta.',11,muted)
    else
      text(stamp(info),10,muted,8)
      for _,it in ipairs(info.items) do
        local detail=category=='B' and ((en and 'Quantity: ' or 'Ilość: ')..it.count) or ((en and 'Equipment slot: ' or 'Slot wyposażenia: ')..it.slot)
        bar(itemLabel(it.id),detail,gold)
      end
      if category=='B' then text(en and 'Carried bags only. Bank and mailbox are not included.' or 'Tylko torby noszone przez postać. Bank i skrzynka pocztowa nie są uwzględniane.',11,muted) end
    end
  else
    addAction(en and 'BROWSE PROFESSIONS AND RECIPES' or 'PRZEGLĄDAJ PROFESJE I PRZEPISY',function()
      openProfilePopup(person.name,'PROFS')
    end,330)
    local info=record and record.P
    if not info or #info.professions==0 then empty()
    else for _,p in ipairs(info.professions) do bar(plain(p),stamp(info),gold) end end
  end
end
local function characterPage()
  local en=NS.Language and NS.Language.language()=='en'
  section('TWOJA POSTAĆ  /  PROFIL','W drodze do legendy','Podgląd tego, co klient gry udostępnia o Twojej postaci.')
  local name=UnitName and UnitName('player') or '?'; local level=UnitLevel and UnitLevel('player') or '?'; local class=UnitClass and UnitClass('player') or '?'
  bar(plain(name)..'  •  '..(en and 'LEVEL ' or 'POZIOM ')..plain(level),plain(class)..'  /  '..plain(GetGuildInfo and GetGuildInfo('player') or (en and 'No guild' or 'Bez gildii')),gold)
  text('PROFESJE GŁÓWNE',10,gold,8)
  local professions=getProfessions()
  if #professions==0 then text('Brak danych o profesjach lub postać jeszcze ich nie poznała.',12,muted) else for _,p in ipairs(professions) do bar(plain(p),'Dane własnej postaci',red) end end
  if NS.NativeProfessions then
    addAction(en and 'WRITE PROFESSIONS TO GUILD NOTE' or 'ZAPISZ PROFESJE W NOTATCE GILDII',function()
      local _,message=NS.NativeProfessions.editOwnNote(C_Club,en and 'en' or 'pl')
      if message then log(message) end
    end,330)
  end
  if NS.LootJournal then
    addAction(en and 'MY LOOT TIMELINE' or 'MOJA OŚ ŁUPÓW',function()
      local who=me()
      if who then openProfilePopup(who.name,'LOOT') else log('Odśwież roster gildii.') end
    end,230)
  end
  local P=NS.Profiles
  if not P then return end
  text(en and 'MY MAIN CHARACTER' or 'MOJA GŁÓWNA POSTAĆ',10,gold,8)
  text(en and 'Optional: enter your own main character from the guild roster. This is your declaration, not a verified account link.' or 'Opcjonalnie wpisz własną główną postać z rosteru gildii. To Twoja deklaracja, a nie zweryfikowane powiązanie kont.',11,muted)
  local mainInput=edit(ui.content,245,31,P.main(),en and 'Character name' or 'Nazwa postaci'); mainInput:SetPoint('TOPLEFT',4,ui.y)
  local mainError=font(ui.content,'',11,{1,.45,.36,1}); mainError:SetPoint('TOPLEFT',4,ui.y-36); mainError:SetWidth(600)
  local saveMain=button(ui.content,en and 'SAVE' or 'ZAPISZ',95,31,function()
    local ok,message=P.setMain(mainInput:GetText()); if ok then log(message); mainInput:ClearFocus(); render() else mainError:SetText(message) end
  end,true); saveMain:SetPoint('LEFT',mainInput,'RIGHT',8,0); ui.y=ui.y-59
  addAction(en and 'OPEN MY PROFILE' or 'OTWÓRZ MÓJ PROFIL',function()
    local who=me()
    if who then openProfilePopup(who.name) else log('Odśwież roster gildii.') end
  end,240)
end
openProfilePopup=function(name,preferredTab)
  local person=member(name); if not ui or not person then return end
  if not ui.profilePopup then
    local p=CreateFrame('Frame','TheSentencedProfileQuick',UIParent,'BackdropTemplate')
    p:SetSize(820,565); p:SetPoint('CENTER',UIParent,'CENTER',0,0); p:SetFrameStrata('FULLSCREEN_DIALOG'); p:SetFrameLevel(20); p:SetClampedToScreen(true)
    p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\DialogFrame\\UI-DialogBox-Border',tile=true,tileSize=32,edgeSize=32,insets={left=11,right=12,top=12,bottom=11}}); p:SetBackdropColor(.075,.08,.105,1); p:SetBackdropBorderColor(1,1,1,1)
    p:SetMovable(true); p:EnableMouse(true); p:RegisterForDrag('LeftButton')
    p:SetScript('OnDragStart',function(self) self:StartMoving() end); p:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end); p:SetScript('OnHide',function(self) self:StopMovingOrSizing() end)
    p.intro=p:CreateAnimationGroup(); local fade=p.intro:CreateAnimation('Alpha'); fade:SetFromAlpha(0); fade:SetToAlpha(1); fade:SetDuration(.2)
    local header=CreateFrame('Frame',nil,p); header:SetPoint('TOPLEFT',13,-13); header:SetPoint('TOPRIGHT',-13,-13); header:SetHeight(65)
    solid(header,.14,.15,.19,1)
    p.classIcon=header:CreateTexture(nil,'ARTWORK'); p.classIcon:SetSize(42,42); p.classIcon:SetPoint('LEFT',11,0)
    p.title=font(header,'',21,gold); p.title:SetPoint('TOPLEFT',65,-9); p.title:SetWidth(635)
    p.subtitle=font(header,'',11,white); p.subtitle:SetPoint('TOPLEFT',65,-40); p.subtitle:SetWidth(635)
    p.tabs={}; p.panels={}
    for i,tab in ipairs({'GEAR','STATS','PROFS','LOOT','BAGS'}) do
      if tab=='GEAR' or tab=='BAGS' then
        local panel=CreateFrame('Frame',nil,p); panel:SetPoint('TOPLEFT',14,-128); panel:SetPoint('BOTTOMRIGHT',-14,50); p.panels[tab]=panel
      end
      local b=button(p,'',152,29,function()
        p.selectedTab=tab; p.listPage=1; openProfilePopup(p.targetName)
      end); b:SetPoint('TOPLEFT',16+(i-1)*157,-88)
      b.indicator=b:CreateTexture(nil,'ARTWORK'); b.indicator:SetPoint('BOTTOMLEFT',4,1); b.indicator:SetPoint('BOTTOMRIGHT',-4,1); b.indicator:SetHeight(2); b.indicator:SetColorTexture(1,.72,.36,1)
      p.tabs[tab]=b
    end
    local gear,bags=p.panels.GEAR,p.panels.BAGS
    local portraitPanel=CreateFrame('Frame',nil,gear,'BackdropTemplate'); portraitPanel:SetPoint('TOPLEFT',61,-31); portraitPanel:SetSize(289,328)
    portraitPanel:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Tooltips\\UI-Tooltip-Border',edgeSize=12,insets={left=4,right=4,top=4,bottom=4}}); portraitPanel:SetBackdropColor(.025,.02,.015,.9); portraitPanel:SetBackdropBorderColor(.55,.42,.24,1)
    p.model=CreateFrame('PlayerModel',nil,gear); p.model:SetSize(260,290); p.model:SetPoint('TOPLEFT',76,-42)
    -- The note belongs above the portrait panel's backdrop; as a child of p it
    -- was rendered behind that backdrop and became almost unreadable.
    p.modelNote=font(portraitPanel,'',11,white,'CENTER'); p.modelNote:SetPoint('CENTER'); p.modelNote:SetWidth(200)
    p.gearNote=font(gear,'',11,muted); p.gearNote:SetPoint('TOPLEFT',14,-5); p.gearNote:SetWidth(440)
    p.overview=font(gear,'',13,white); p.overview:SetPoint('TOPLEFT',444,-35); p.overview:SetWidth(313); p.overview:SetSpacing(8)
    p.bagTitle=font(bags,'TORBY',16,gold); p.bagTitle:SetPoint('TOPLEFT',14,-10)
    p.bagNote=font(bags,'',11,muted); p.bagNote:SetPoint('TOPLEFT',14,-40); p.bagNote:SetWidth(640)
    p.slots={}; p.bags={}; p.bagPage=1
    -- Icons represent shared item totals, not actual bag positions.
    local function itemButton(parent)
      local b=CreateFrame('Button',nil,parent,'BackdropTemplate'); b:SetSize(38,38)
      b:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Tooltips\\UI-Tooltip-Border',edgeSize=10,insets={left=3,right=3,top=3,bottom=3}})
      b:SetBackdropColor(.06,.05,.04,1); b:SetBackdropBorderColor(.7,.57,.35,1)
      b.icon=b:CreateTexture(nil,'ARTWORK'); b.icon:SetPoint('TOPLEFT',4,-4); b.icon:SetPoint('BOTTOMRIGHT',-4,4)
      b.caption=font(b,'',10,white,'RIGHT'); b.caption:SetPoint('BOTTOMRIGHT',-3,3)
      b:SetScript('OnEnter',function(self) if GameTooltip then GameTooltip:SetOwner(self,'ANCHOR_RIGHT'); if self.itemId then GameTooltip:SetItemByID(self.itemId) elseif self.slotLabel then GameTooltip:SetText(self.slotLabel) end; GameTooltip:Show() end end)
      b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
      return b
    end
    local function setIcon(b,id,count)
      b.itemId=id
      local icon
      if id then
        if C_Item and C_Item.GetItemIconByID then local ok,value=pcall(C_Item.GetItemIconByID,id); if ok then icon=value end end
        if not icon and GetItemIcon then local ok,value=pcall(GetItemIcon,id); if ok then icon=value end end
      end
      b.icon:SetTexture(id and (icon or 'Interface\\Icons\\INV_Misc_QuestionMark') or nil)
      b.caption:SetText(count and count>1 and tostring(count) or '')
    end
    p.setIcon=setIcon
    local columns={{1,2,3,15,5,4,19,9},{10,6,7,8,11,12,13,14}}
    for side,slots in ipairs(columns) do for row,slot in ipairs(slots) do
      local b=itemButton(gear);b.slotNumber=slot;b:SetPoint('TOPLEFT',13+(side-1)*350,-30-(row-1)*40);p.slots[slot]=b
    end end
    for row,slot in ipairs({16,17,18}) do local b=itemButton(gear);b.slotNumber=slot;b:SetPoint('TOPLEFT',128+(row-1)*46,-355);p.slots[slot]=b end
    p.bagSearch=edit(bags,310,30,'','Szukaj w torbach po nazwie lub ID'); p.bagSearch:SetPoint('TOPLEFT',14,-66)
    p.bagSearch:SetScript('OnTextChanged',function()
      if p.refreshBags then p.bagPage=1; p.refreshBags() end
    end)
    for i=1,12 do local b=itemButton(bags); local n=i-1; b:SetSize(65,65); b:SetPoint('TOPLEFT',14+(n%6)*79,-113-math.floor(n/6)*78); p.bags[i]=b end
    p.pageText=font(bags,'',12,white,'CENTER'); p.pageText:SetPoint('TOPLEFT',88,-266); p.pageText:SetWidth(150)
    p.previous=button(bags,'<',35,26,function() if p.bagPage>1 then p.bagPage=p.bagPage-1; p.refreshBags() end end); p.previous:SetPoint('TOPLEFT',22,-273)
    p.next=button(bags,'>',35,26,function() if p.bagPage<p.bagPages then p.bagPage=p.bagPage+1; p.refreshBags() end end); p.next:SetPoint('TOPLEFT',260,-273)
    local detail=CreateFrame('Frame',nil,p); detail:SetPoint('TOPLEFT',14,-128); detail:SetPoint('BOTTOMRIGHT',-14,50); p.detail=detail
    p.detailTitle=font(detail,'',16,gold); p.detailTitle:SetPoint('TOPLEFT',14,-8)
    p.detailHint=font(detail,'',11,muted); p.detailHint:SetPoint('TOPLEFT',14,-39); p.detailHint:SetWidth(754)
    p:RegisterEvent('TRADE_SKILL_SHOW')
    p:SetScript('OnEvent',function()
      if not (p.recipeRequest and p:IsShown()) then return end
      if C_TradeSkillUI and C_TradeSkillUI.IsTradeSkillGuildMember and not C_TradeSkillUI.IsTradeSkillGuildMember() then return end
      p.recipeRequest=nil
      p:Hide(); ui.root:Hide()
    end)
    p:HookScript('OnHide',function() p.recipeRequest=nil end)
    p.detailRows={}
    for i=1,7 do
      local row=CreateFrame('Frame',nil,detail); row:SetSize(760,38); row:SetPoint('TOPLEFT',14,-67-(i-1)*44)
      solid(row,.115,.127,.16,1)
      row.label=font(row,'',13,white); row.label:SetPoint('LEFT',12,0); row.label:SetWidth(490)
      row.value=font(row,'',12,gold,'RIGHT'); row.value:SetPoint('RIGHT',-12,0); row.value:SetWidth(234)
      row.browse=button(row,'PRZEPISY',108,26,function()
        local en=NS.Language and NS.Language.language()=='en'
        local unavailable=en and 'The game did not return this recipe list.' or 'Gra nie zwróciła listy przepisów tej profesji.'
        local request={}
        p.recipeRequest=request
        if not (row.profession and NS.NativeProfessions and NS.NativeProfessions.browse(C_Club,p.targetName,row.profession)) then
          p.recipeRequest=nil; p.detailHint:SetText(unavailable); return
        end
        if p.recipeRequest~=request then return end
        p.detailHint:SetText(en and 'Requesting recipes from the game…' or 'Pobieranie przepisów z gry…')
        C_Timer.After(5,function()
          if p.recipeRequest~=request then return end
          p.recipeRequest=nil
          p.detailHint:SetText(unavailable)
        end)
      end)
      row.browse:SetPoint('RIGHT',-9,0)
      row:SetScript('OnEnter',function(self) if self.item then NS.BoardItems.tooltip(self,'item:'..self.item) end end)
      row:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
      row:EnableMouse(true); p.detailRows[i]=row
    end
    p.detailCount=font(detail,'',11,muted,'CENTER'); p.detailCount:SetPoint('BOTTOMLEFT',64,8); p.detailCount:SetWidth(95)
    p.detailPrev=button(detail,'‹',40,24,function() p.listPage=p.listPage-1; openProfilePopup(p.targetName) end); p.detailPrev:SetPoint('BOTTOMLEFT',14,3)
    p.detailNext=button(detail,'›',40,24,function() p.listPage=p.listPage+1; openProfilePopup(p.targetName) end); p.detailNext:SetPoint('BOTTOMLEFT',169,3)
    p.note=font(p,'',11,white); p.note:SetPoint('BOTTOMLEFT',17,17); p.note:SetWidth(460)
    local close=button(p,'×',30,30,function() p:Hide() end); close:SetPoint('TOPRIGHT',-9,-9)
    local open=button(p,'ZAMKNIJ PODGLĄD',210,29,function() p:Hide() end,true); open:SetPoint('BOTTOMRIGHT',-17,14)
    p.open=open
    tinsert(UISpecialFrames,'TheSentencedProfileQuick'); ui.profilePopup=p
  end
  local p=ui.profilePopup
  -- Keep the window usable on a small game viewport without enlarging it on large screens.
  if UIParent.GetWidth and UIParent.GetHeight and p.SetScale then
    local width,height=UIParent:GetWidth(),UIParent:GetHeight()
    if width and height and width>0 and height>0 then p:SetScale(math.min(1,math.max(.55,math.min((width-24)/820,(height-24)/565)))) end
  end
  local wasShown=p:IsShown()
  local sameTarget=p.targetName==person.name; p.targetName=person.name; local en=NS.Language and NS.Language.language()=='en'
  if not sameTarget then p.selectedTab='GEAR'; p.listPage=1; p.refreshBags=nil; p.bagSearch:SetText('') end
  if preferredTab then p.selectedTab=preferredTab; p.listPage=1 end
  if not sameTarget or p.selectedTab~='PROFS' then p.recipeRequest=nil end
  local record=NS.Profiles and NS.Profiles.get(person.name)
  local names=en and {GEAR='Equipment',STATS='Statistics',PROFS='Professions',LOOT='Loot timeline',BAGS='Bags'}
    or {GEAR='Ekwipunek',STATS='Statystyki',PROFS='Profesje',LOOT='Oś łupów',BAGS='Torby'}
  for key,b in pairs(p.tabs) do
    b.caption:SetText(names[key]); b.indicator:SetShown(p.selectedTab==key)
    if p.panels[key] then p.panels[key]:SetShown(p.selectedTab==key) end
  end
  local classAtlas=person.class and ('classicon-'..person.class:lower())
  if classAtlas then p.classIcon:SetAtlas(classAtlas) else p.classIcon:SetTexture('Interface\\Icons\\INV_Misc_QuestionMark') end
  p.title:SetText(plain(person.name)); p.subtitle:SetText(plain(person.className)..'  •  '..plain(person.level)..'  •  '..plain(person.rank)..'  •  '..(person.online and 'ONLINE' or 'OFFLINE'))
  local note=plain(person.note)
  p.overview:SetText(plain(person.zone)..(note~='' and ('\n\n'..note) or '')
    ..(record and record.A and ('\n\n'..(en and 'Main: ' or 'Główna postać: ')..plain(record.A.main)) or ''))
  local equipment=record and record.E; local bySlot={}
  if equipment then for _,v in ipairs(equipment.items) do bySlot[v.slot]=v.id end end
  p.gearNote:SetText(equipment and (en and 'Shared equipment' or 'Udostępnione wyposażenie') or (en and 'Equipment not shared or not received' or 'Wyposażenie nieudostępnione lub nieodebrane'))
  local slotNamesPL={'Głowa','Szyja','Ramiona','Koszula','Pierś','Pas','Nogi','Stopy','Nadgarstki','Dłonie','Pierścień 1','Pierścień 2','Błyskotka 1','Błyskotka 2','Plecy','Broń główna','Druga ręka','Broń dystansowa','Tabard'}
  local slotNamesEN={'Head','Neck','Shoulder','Shirt','Chest','Waist','Legs','Feet','Wrist','Hands','Finger 1','Finger 2','Trinket 1','Trinket 2','Back','Main hand','Off hand','Ranged','Tabard'}
  for i,b in ipairs(p.slots) do
    p.setIcon(b,bySlot[i]); b.slotLabel=(en and slotNamesEN[i] or slotNamesPL[i])..(equipment and (en and ': empty' or ': puste') or (en and ': no shared data' or ': brak udostępnionych danych'))
  end
  local who=me(); local unit
  if who and who.name:lower()==person.name:lower() then unit='player'
  elseif equipment and UnitExists and UnitExists('target') and UnitName then local target=member(UnitName('target')); if target and target.name:lower()==person.name:lower() then unit='target' end end
  p.model:Hide(); p.modelNote:Show()
  if unit then local ok=pcall(function() p.model:SetUnit(unit);if p.model.SetPortraitZoom then p.model:SetPortraitZoom(0) end;if p.model.SetCamDistanceScale then p.model:SetCamDistanceScale(.85) end end); if ok then p.model:Show(); p.modelNote:Hide() end end
  p.modelNote:SetText(not equipment and not unit and (en and 'Model unavailable: equipment has not been shared or received.' or 'Model niedostępny: wyposażenie nie zostało udostępnione lub odebrane.') or (en and 'Character model unavailable. Select this player as target nearby.' or 'Model niedostępny. Wybierz tę postać jako cel w pobliżu.'))
  local bags=record and record.B; local entries=bags and bags.items or {}
  p.bagTitle:SetText(en and 'BAGS' or 'TORBY')
  p.bagSearch:SetShown(bags~=nil and feature('bagSearch'))
  p.bagPages=math.max(1,math.ceil(#entries/12)); p.bagPage=sameTarget and math.min(p.bagPage,p.bagPages) or 1
  p.bagNote:SetText(not bags and (en and 'Not shared or not received' or 'Nieudostępnione lub nieodebrane') or (#entries==0 and (en and 'No items shared' or 'Brak udostępnionych przedmiotów') or (en and 'Combined totals; bag positions unavailable' or 'Łączne ilości; pozycje w torbach niedostępne')))
  p.refreshBags=function()
    local query=feature('bagSearch') and p.bagSearch:GetText():lower():match('^%s*(.-)%s*$') or ''
    local matches=entries
    if query~='' then
      matches={}
      for _,entry in ipairs(entries) do
        if tostring(entry.id):find(query,1,true) or itemLabel(entry.id):lower():find(query,1,true) then matches[#matches+1]=entry end
      end
    end
    p.bagPages=math.max(1,math.ceil(#matches/12)); p.bagPage=math.min(p.bagPage,p.bagPages)
    if bags then p.bagNote:SetText(#matches..' / '..#entries..(en and ' shared item types' or ' typów udostępnionych przedmiotów')) end
    for i,b in ipairs(p.bags) do local v=matches[(p.bagPage-1)*12+i]; p.setIcon(b,v and v.id or nil,v and v.count or nil); b:SetShown(v~=nil) end
    p.pageText:SetText((en and 'Page ' or 'Strona ')..p.bagPage..' / '..p.bagPages)
    if p.previous.SetEnabled then p.previous:SetEnabled(p.bagPage>1); p.next:SetEnabled(p.bagPage<p.bagPages) end
  end
  p.refreshBags()
  local page=p.selectedTab
  local visible=page=='STATS' or page=='PROFS' or page=='LOOT'
  p.detail:SetShown(visible)
  if visible then
    local rows={}
    local function add(label,value,item,profession,quality)
      rows[#rows+1]={label=label,value=value,item=item,profession=profession,quality=quality}
    end
    local function stamp(epoch)
      if type(epoch)=='number' and epoch>0 and date then
        local ok,value=pcall(date,'%d.%m.%Y %H:%M',epoch)
        if ok and type(value)=='string' then return value end
      end
      return en and 'Unknown date' or 'Data nieznana'
    end
    local sub=en and 'Shared character snapshot' or 'Udostępniona migawka postaci'
    if page=='STATS' then
      if record and record.S then
        local labels=en and {'Strength','Agility','Stamina','Intellect','Spirit','Max health'} or {'Siła','Zręczność','Wytrzymałość','Intelekt','Duch','Maks. zdrowie'}
        for i,label in ipairs(labels) do add(label,tostring(record.S.values[i])) end
        sub=stamp(record.S.received)
      end
      if record and record.G then
        local copper=record.G.copper
        add(en and 'Gold' or 'Złoto',string.format('%d g  %d s  %d c',math.floor(copper/10000),math.floor(copper/100)%100,copper%100))
      end
    elseif page=='PROFS' then
      local native=NS.NativeProfessions
      local selfProfile=who and who.name==person.name
      local available,guid
      if native then available,guid=native.member(C_Club,person.name) end
      if selfProfile and native then available=native.own() end
      if available and #available>0 then
        sub=en and 'Primary professions and skill levels.' or 'Profesje główne i poziomy umiejętności.'
        for _,entry in ipairs(available) do
          local level=entry.rank and tostring(entry.rank)..(entry.max and (' / '..entry.max) or '') or ''
          local browse=native.canBrowse(guid,entry.id) and entry.id or nil
          if browse then sub=en and 'Open Recipes to browse the game’s list.' or 'Kliknij Przepisy, aby przejrzeć listę w oknie gry.' end
          add(plain(entry.name),level,nil,browse)
        end
      elseif record and record.P and #record.P.professions>0 then
        sub=stamp(record.P.received)
        for _,value in ipairs(record.P.professions) do
          for label in value:gmatch('[^;]+') do
            local trimmed=label:match('^%s*(.-)%s*$')
            local name,level=trimmed:match('^(.-)%s+(%d+/%d+)$')
            add(plain(name or trimmed),level or '')
          end
        end
      elseif native then
        sub=en and 'From the public guild note' or 'Z publicznej notatki gildyjnej'
        for _,label in ipairs(native.noteProfessions(person.note)) do add(plain(label),'') end
      end
    else
      local own=me()
      local loot={}
      if own and own.name==person.name and NS.LootJournal then
        for _,entry in ipairs(NS.LootJournal.entries()) do
          loot[#loot+1]={item=entry.item,time=entry.time,count=entry.count,quality=entry.quality,localOnly=true}
        end
      end
      sub=own and own.name==person.name
        and (en and 'Your uncommon and better drops are saved locally.' or 'Twoje łupy od zielonej jakości zapisują się lokalnie.')
        or (en and 'Loot shared by this player.' or 'Łupy udostępnione przez gracza.')
      local _,drops=getFinds('LOOT')
      for _,entry in ipairs(drops) do
        if entry.author:lower()==person.name:lower() then
          local epoch=entry.id:match('^(%d%d%d%d%d%d%d%d%d%d)%d%d%d%d$')
          loot[#loot+1]={item=entry.item,time=tonumber(epoch) or 0,id=entry.id}
        end
      end
      table.sort(loot,function(a,b)
        if a.time~=b.time then return a.time>b.time end
        return tostring(a.id or a.item)>tostring(b.id or b.item)
      end)
      for _,entry in ipairs(loot) do
        local label=itemLabel(entry.item)
        if entry.count and entry.count>1 then label=label..' ×'..entry.count end
        local origin=entry.localOnly and (en and 'Private' or 'Prywatny') or (en and 'Reported' or 'Zgłoszony')
        add(label,stamp(entry.time)..'  •  '..origin,entry.item,nil,entry.quality)
      end
    end
    local total=math.max(1,math.ceil(#rows/7))
    p.listPage=math.min(total,math.max(1,p.listPage or 1))
    p.detailTitle:SetText(names[page])
    p.detailHint:SetText(#rows>0 and sub or (en and 'No records available.' or 'Brak dostępnych danych.'))
    for i,row in ipairs(p.detailRows) do
      local value=rows[(p.listPage-1)*7+i]
      row.item=value and value.item
      row.profession=value and value.profession
      row.browse:SetShown(row.profession~=nil)
      row.browse.caption:SetText(en and 'RECIPES' or 'PRZEPISY')
      row.value:ClearAllPoints()
      if row.profession then row.value:SetPoint('RIGHT',-125,0) else row.value:SetPoint('RIGHT',-12,0) end
      row:SetShown(value~=nil)
      if value then
        local color=value.quality and ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[value.quality]
        if color then row.label:SetTextColor(color.r,color.g,color.b) else row.label:SetTextColor(unpack(white)) end
        row.label:SetText(value.label); row.value:SetText(value.value)
      end
    end
    p.detailCount:SetText(p.listPage..' / '..total)
    p.detailPrev:SetShown(p.listPage>1); p.detailNext:SetShown(p.listPage<total); p.detailCount:SetShown(total>1)
  end
  p.note:SetText(en and 'Shared snapshots may be stale. Bank and mail excluded.' or 'Udostępnione dane mogą być nieaktualne. Bez banku i poczty.')
  p.open.caption:SetText(en and 'CLOSE PREVIEW' or 'ZAMKNIJ PODGLĄD')
  p:Show(); if not wasShown then p.intro:Play() end
end
local checkNames={'Naprawiony ekwipunek','Mikstury i materiały','Jedzenie / wzmocnienia','Wolne miejsca w torbach','Amunicja / komponenty klasy','Sprawdzona godzina i miejsce zbiórki'}
local function checklist()
  section('RAID READY  /  TWOJA LISTA','Przed wyprawą','Zaznacz, co już masz. Lista jest prywatna i zapisywana dla tej postaci.')
  for i,label in ipairs(checkNames) do
    local f=bar((db.checks[i] and '|cff70e3a5✓|r  ' or '|cff9aa4b1○|r  ')..label,'Kliknij, aby zmienić status.', db.checks[i] and {0.3,.75,.53} or {.33,.35,.4})
    local b=button(f,db.checks[i] and 'GOTOWE' or 'OZNACZ',84,26,function() db.checks[i]=not db.checks[i]; render() end)
    b:SetPoint('RIGHT',-8,0)
  end
  addAction('WYCZYŚĆ CHECKLISTĘ',function() db.checks={}; render() end)
  section('GOTOWOŚĆ  /  GILDIA','Zgłoś gotowość','Dobrowolnie zgłoś gotowość osobom online z dodatkiem. Zawartość Twojej listy pozostaje prywatna; status wygasa po 2 godzinach.')
  local announce=button(ui.content,'ZGŁOŚ GOTOWOŚĆ',190,30,function()
    for i=1,#checkNames do if not db.checks[i] then log('Najpierw zaznacz wszystkie punkty listy przygotowania.');return end end
    local ok,message=NS.Ready.set(true);log(message);if ok then render() end
  end,true);announce:SetPoint('TOPLEFT',4,ui.y)
  local clearReady=button(ui.content,'COFNIJ GOTOWOŚĆ',190,30,function()local ok,message=NS.Ready.set(false);log(message);if ok then render() end end);clearReady:SetPoint('LEFT',announce,'RIGHT',8,0);ui.y=ui.y-40
  text('Zmiana checklisty nie cofa wcześniejszego zgłoszenia. Użyj COFNIJ GOTOWOŚĆ.',11,muted)
  local players=NS.Ready.list()
  if #players==0 then text('Brak odebranych zgłoszeń gotowości.',11,muted) end
  for _,player in ipairs(players) do bar(plain(player.name),'Gotowość wygasa za '..math.max(1,math.ceil((player.expires-((GetServerTime and GetServerTime()) or 0))/60))..' min • doręczenie nie jest gwarantowane',gold) end
end
local function history()
  section('THE SENTENCED  /  OD 2005','Historia, którą piszemy dalej','Polska gildia z historią. W Forever tworzymy kolejny rozdział razem.')
  bar('2005  /  POCZĄTEK','Rok założenia według historycznego ogłoszenia rekrutacyjnego.',gold)
  bar('2011  /  ULTRAXION HEROIC','Polish First Kill odnotowany przez WoWCenter.',red)
  bar('2019  /  POWRÓT DO CLASSIC','Rekrutacja The Sentenced na Shazzrah.',gold)
  bar('FOREVER  /  NOWY ROZDZIAŁ','Horda • Europa • wspólne wyprawy i społeczność.',red)
  text('Ta oś to skrócona historia na podstawie publicznych źródeł. Masz wspomnienie lub poprawkę? Przekaż je kadrze gildii.',11,muted)
end
local function archivePage()
  section('SPOŁECZNOŚĆ  /  ARCHIWUM','Kopie od członków gildii','Eksperymentalna wymiana historii bez dodatkowego programu. Wpisz osobę online z tą samą wersją dodatku.')
  local A=NS.Archive
  if not A then text('Moduł archiwum jest niedostępny.',12,muted); return end
  local target=edit(ui.content,290,31,'','Nick osoby online z addonem'); target:SetPoint('TOPLEFT',4,ui.y)
  local get=button(ui.content,'POBIERZ KOPIĘ',150,31,function()
    local ok,why=A.request(target:GetText():match('^%s*(.-)%s*$'))
    log(ok and 'Wysłano prośbę o archiwum. Sprawdź status za kilka minut.' or (why or 'Nie udało się wysłać.'))
    if ok then render() end
  end,true); get:SetPoint('LEFT',target,'RIGHT',7,0)
  local cancel=button(ui.content,'WYCZYŚĆ PROŚBĘ',155,31,function() A.cancel(); render() end); cancel:SetPoint('LEFT',get,'RIGHT',7,0)
  ui.y=ui.y-44
  text('STATUS WYMIANY',10,gold,8)
  text(A.status(),11,white,12)
  addAction('ODŚWIEŻ PODGLĄD',function() render() end,200)
  text('Kopie mogą być niepełne i zmienione przez przekazującą osobę. Domniemany autor nie jest potwierdzony. Nie trafiają automatycznie do wydarzeń, mapy, zapisów ani innych widoków.',11,muted)
  local records=A.records()
  text('OSTATNIE 30 WIADOMOŚCI  /  ZACHOWANO '..#records..' Z 150',10,gold,8)
  if #records==0 then text('Brak zapisów od czasu instalacji tej wersji.',12,muted); return end
  local kind={B='TABLICA',E='WYDARZENIE / ZAPIS',F='MAPA / ŁUP'}
  for i=#records,math.max(1,#records-29),-1 do
    local r=records[i]
    local provenance=r.direct and 'ODEBRANE BEZPOŚREDNIO' or ('KOPIA OD '..plain(r.via)..' / AUTOR NIEPOTWIERDZONY')
    local content=plain(r.payload:gsub('|',' · '))
    bar(preview((kind[r.tag] or 'WIADOMOŚĆ')..'  /  '..plain(r.origin),85),preview(provenance..'  •  '..content,105),r.direct and gold or red)
  end
end
local showSetup
local function help()
  section('INFORMACJE  /  POMOC','Jak to działa?','Wersja 0.6.38-alfa • WoW Forever • interfejs 16001')
  addAction('DIAGNOSTYKA — KOPIUJ RAPORT',function() if NS.Diagnostics then NS.Diagnostics.show() end end,300)
  addAction('JĘZYK: POLSKI',function()
    NS.Language.set(NS.Language.language()=='pl' and 'en' or 'pl'); render()
  end,220)
  addAction('KREATOR PIERWSZEGO URUCHOMIENIA',function() db.setupDone=false; db.setupStep=1; showSetup() end,300)
  bar('/ts  lub  /sentenced','Otwiera i zamyka panel. Okno można przeciągnąć za górny pasek.',gold)
  bar('NAWIGACJA','Wybierz kategorię po lewej stronie, a następnie jedną z jej podstron.',red)
  bar('ROSTER','Dane pobierane z gry. W razie pustej listy użyj odświeżania.',red)
  bar('WYDARZENIA I CHECKLISTA','Prywatne plany i checklista pozostają na postaci. Wydarzenia gildii wysyłane są osobno.',gold)
  bar('SYNCHRONIZACJA','SIEĆ zawiera kopie odebrane od innych graczy; sprawdzaj ich aktualność.',red)
  bar('PROFESJE','Katalog pokazuje profesje dobrowolnie udostępnione przez graczy; receptury wymagają potwierdzenia.',red)
  bar('DISCORD I ROSTER','Synchronizator GM może przekazać roster po zapisaniu danych gry. Aktualizacja nie jest natychmiastowa.',gold)
  bar('WĄŻ HORDY','Wpisz /tssnake, aby zagrać. /tssnake auto włącza lub wyłącza automatyczne otwieranie podczas dłuższego lotu.',red)
  text('Zgodność z prawdziwym klientem WoW Forever i wszystkimi konfiguracjami wymaga testu w grze. W razie błędu włącz komunikaty Lua: /console scriptErrors 1',11,muted)
  addAction('ODŚWIEŻ ROSTER',function() requestRoster(); log('Prośba o odświeżenie rosteru została wysłana.') end)
end
-- Setup is an independent, resumable window. It never resets existing preferences.
showSetup=function()
  if not ui or not db then return end
  ui.root:Hide()
  if not ui.setup then
    local w=CreateFrame('Frame','TheSentencedSetup',UIParent,'BackdropTemplate')
    w:SetSize(700,470); w:SetPoint('CENTER',UIParent,'CENTER',0,0); w:SetFrameStrata('DIALOG'); w:SetClampedToScreen(true)
    w:EnableMouse(true); w:SetMovable(true); w:RegisterForDrag('LeftButton')
    w:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\DialogFrame\\UI-DialogBox-Border',tile=true,tileSize=32,edgeSize=32,insets={left=11,right=12,top=12,bottom=11}})
    w:SetBackdropColor(.075,.065,.05,1); w:SetBackdropBorderColor(1,1,1,1)
    w:SetScript('OnDragStart',function(self) self:StartMoving() end); w:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end)
    w:SetScript('OnHide',function(self) self:StopMovingOrSizing() end)
    local band=CreateFrame('Frame',nil,w); band:SetPoint('TOPLEFT',1,-1); band:SetPoint('TOPRIGHT',-1,-1); band:SetHeight(78); solid(band,.16,.07,.07,1)
    local badge=NS.Theme and NS.Theme.crest(band); if badge then badge:SetPoint('TOPLEFT',16,-10) end
    local crest=font(band,'THE SENTENCED',21,gold); crest:SetPoint('TOPLEFT',badge and 82 or 24,-14)
    local sub=font(band,'GUILD HALL  •  FOREVER',10,muted); sub:SetPoint('TOPLEFT',badge and 83 or 25,-45)
    w.progress=font(band,'',11,gold); w.progress:SetPoint('TOPRIGHT',-25,-30)
    w.title=font(w,'',20,white); w.title:SetPoint('TOPLEFT',26,-102); w.title:SetWidth(645)
    w.body=font(w,'',13,white); w.body:SetPoint('TOPLEFT',26,-140); w.body:SetWidth(645); w.body:SetHeight(63)
    w.detail=font(w,'',12,white); w.detail:SetPoint('TOPLEFT',26,-355); w.detail:SetWidth(645); w.detail:SetHeight(42)
    w.options={}
    for i=1,5 do local index=i; local b=button(w,'',300,34,function() local option=w.options[index]; if option and option.action then option.action() end end,true)
      b:SetPoint('TOPLEFT',26+((i-1)%2)*324,-213-math.floor((i-1)/2)*42); w.options[i]=b end
    w.back=button(w,'',130,32,function() db.setupStep=math.max(1,(tonumber(db.setupStep) or 1)-1); showSetup() end)
    w.back:SetPoint('BOTTOMLEFT',26,21)
    w.next=button(w,'',155,32,function()
      local step=tonumber(db.setupStep) or 1
      if step>=4 then db.setupDone=true; db.setupStep=nil; if NS.Profiles and NS.Profiles.finishSetup then NS.Profiles.finishSetup() end; page='START'; w:Hide(); requestRoster(); ui.root:Show(); render()
      else db.setupStep=step+1; showSetup() end
    end,true); w.next:SetPoint('BOTTOMRIGHT',-26,21)
    local close=button(w,'×',32,32,function() w:Hide() end); close:SetPoint('TOPRIGHT',-12,-10)
    tinsert(UISpecialFrames,'TheSentencedSetup'); ui.setup=w
  end
  local w=ui.setup; local en=NS.Language and NS.Language.language()=='en'
  local step=math.max(1,math.min(4,tonumber(db.setupStep) or 1)); db.setupStep=step
  w.progress:SetText((en and 'STEP ' or 'KROK ')..step..' / 4')
  local options={}; local title,body,detail
  if step==1 then
    title=en and 'Welcome to Guild Hall' or 'Witaj w Guild Hall'
    body=en and 'Plan guild trips, read announcements and discover who is online. Choose your language to begin.' or 'Planuj wspólne wyprawy, czytaj ogłoszenia i sprawdzaj, kto gra. Zacznij od wyboru języka.'
    detail=en and 'English translation is partial in this alpha.' or 'Wersja angielska jest częściowa w tej alfie.'
    options={{'POLSKI'..(not en and '  ✓' or ''),function() NS.Language.set('pl'); showSetup() end},{'ENGLISH'..(en and '  ✓' or ''),function() NS.Language.set('en'); showSetup() end}}
  elseif step==2 then
    title=en and 'Maps and markers' or 'Mapa i znaczniki'
    body=en and 'Choose where to show saved discoveries. Settings can be changed later in Map.' or 'Wybierz, gdzie pokazywać zapisane odkrycia. Ustawienia zmienisz później w Mapie.'
    detail=en and 'Markers show saved locations, not guaranteed current spawns.' or 'Znaczniki oznaczają zapisane miejsca, a nie gwarantowaną obecną pozycję surowca.'
    local on=en and 'ON' or 'WŁ.'; local off=en and 'OFF' or 'WYŁ.'
    options={{(en and 'WORLD MAP: ' or 'MAPA ŚWIATA: ')..(db.mapPinsWorld and on or off),function() db.mapPinsWorld=not db.mapPinsWorld; showSetup() end},
      {(en and 'MINIMAP: ' or 'MINIMAPA: ')..(db.mapPinsMini and on or off),function() db.mapPinsMini=not db.mapPinsMini; showSetup() end}}
  elseif step==3 then
    title=en and 'Your privacy' or 'Twoja prywatność'
    body=en and 'New installations share equipment, bags, gold, stats and professions with guild members by default after setup. Turn off any section below.' or 'Po zakończeniu konfiguracji zaznaczone dane będą udostępniane gildii. Kliknij kategorię, aby zmienić WŁ. na WYŁ. lub odwrotnie.'
    detail=en and 'Change these under Character. Offline copies cannot be remotely erased.' or 'Domyślnie wszystkie kategorie są włączone. Zmienisz je w zakładce Postać. Kopii offline nie można zdalnie usunąć.'
    local P=NS.Profiles; local on=en and 'ON' or 'WŁ.'; local off=en and 'OFF' or 'WYŁ.'
    for _,v in ipairs({{'E',en and 'EQUIPMENT' or 'WYPOSAŻENIE'},{'B',en and 'BAGS' or 'TORBY'},{'G',en and 'GOLD' or 'ZŁOTO'},{'S',en and 'STATS' or 'STATYSTYKI'},{'P',en and 'PROFESSIONS' or 'PROFESJE'}}) do
      local cat,label=v[1],v[2]; options[#options+1]={label..': '..(P and P.enabled(cat) and on or off),function() if P then P.toggle(cat); showSetup() end end}
    end
  else
    title=en and 'Ready to explore' or 'Wszystko gotowe'
    body=en and 'Use the minimap button to open Guild Hall. Find the board, events and map in the sidebar.' or 'Przycisk przy minimapie otwiera Guild Hall. Tablicę, wydarzenia i mapę znajdziesz w menu po lewej.'
    detail=en and 'Everyone needs this addon version. Guild updates require online players.' or 'Wszyscy potrzebują tej samej wersji addonu. Zmiany są przesyłane osobom online.'
  end
  w.title:SetText(title); w.body:SetText(body); w.detail:SetText(detail)
  for i,b in ipairs(w.options) do local opt=options[i]; b.action=opt and opt[2] or nil; b:SetShown(opt~=nil); if opt then b.caption:SetText(opt[1]) end end
  w.back:SetShown(step>1); w.back.caption:SetText(en and 'BACK' or 'WSTECZ')
  w.next.caption:SetText(step==4 and (en and 'FINISH' or 'GOTOWE') or (en and 'NEXT' or 'DALEJ'))
  w:Show()
end
function NS.settingsPage()
  local cats={'Gildia','Mapa','Wygoda','Prywatność'}
  local category=ui.settingsCategory or 1
  section(nil,'Ustawienia')
  for i,label in ipairs(cats) do
    local b=button(ui.content,(i==category and '✓  ' or '')..label,146,31,function()
      ui.settingsCategory=i; render()
    end,i==category)
    b:SetPoint('TOPLEFT',(i-1)*154,ui.y)
  end
  ui.y=ui.y-48
  local function row(label,detail,on,change)
    local f=bar(label,detail,on and {.35,.72,.55} or muted)
    local b=button(f,on and 'WŁ.' or 'WYŁ.',76,28,function()
      change(not on); render()
    end,on)
    b:SetPoint('RIGHT',-9,0)
  end
  local function option(key,label,detail)
    row(label,detail,feature(key),function(on)
      db.options=db.options or {}
      db.options[key]=on
      if key=='minimapButton' then
        if on and NS.createMinimapButton then NS.createMinimapButton()
        elseif _G.TheSentencedMinimapButton then _G.TheSentencedMinimapButton:Hide() end
      elseif key=='autoProfile' and on and NS.Profiles and NS.Profiles.resumeAuto then
        NS.Profiles.resumeAuto()
      end
    end)
  end
  if category==1 then
    option('rosterSearch','Wyszukiwanie w rosterze','Filtr nicku, klasy, poziomu i notatki.')
    option('lookup','Wyszukiwarki gildii','Katalog rzemieślników i materiałów.')
    option('board','Tablica ogłoszeń','Wpisy, odpowiedzi i usuwanie przez autora lub GM.')
    option('planner','Planer wypraw','Wydarzenia i zapisy na role.')
    option('calendar','Publikowanie w kalendarzu gry','Utwórz wpis z zaproszeniami dla zapisanych graczy.')
    option('guildLinks','Odnośniki w czacie gildii','Otwieraj wydarzenia i ogłoszenia z wiadomości w grze.')
    option('guildLoot','Łupy i lista życzeń','Zgłoszenia gildii i widok przedmiotów do zdobycia.')
    option('archive','Archiwum wiadomości dodatku','Zachowuje przekazane wpisy starszych sesji.')
    row('Dane z Discorda','Odczyt przez skonfigurowany synchronizator.',db.autoDiscord~=false,function(on) db.autoDiscord=on end)
  elseif category==2 then
    row('Znaczniki na mapie świata','Zapisane miejsca i surowce.',db.mapPinsWorld==true,function(on) db.mapPinsWorld=on end)
    row('Znaczniki na minimapie','Zapisane miejsca w pobliżu postaci.',db.mapPinsMini==true,function(on) db.mapPinsMini=on end)
    row('Ukrywanie bliskich surowców','Zostawia miejsce na kropkę wykrywania gry.',db.mapHideNearResources~=false,function(on) db.mapHideNearResources=on end)
    option('gatherRecord','Zapisywanie zebranych surowców','Zachowuje punkt po zebraniu rudy lub zioła.')
    option('mapShare','Udostępnianie punktów gildii','Wyłącz, by nowe punkty zostawały na tym komputerze.')
    local tracker=NS.GatherTracking
    if tracker then
      local opts=db.gatherTracking or {}
      row('Automatyczne tropienie','Przywraca lub przełącza wykrywanie surowców.',opts.enabled~=false,function(on) tracker.SetEnabled(on); tracker.Check() end)
      local labels={'Auto','Minerały','Zioła','Minerały + zioła'}
      local function selected()
        return opts.dual and 4 or opts.spell==2580 and 2 or opts.spell==2383 and 3 or 1
      end
      local function choose(index)
        if index==4 then tracker.SetDual(true) else tracker.Select(({[2]=2580,[3]=2383})[index]) end
        tracker.Check(); render()
      end
      for i,label in ipairs(labels) do
        local b=button(ui.content,(selected()==i and '✓  ' or '')..label,143,28,function() choose(i) end,i==selected())
        b:SetPoint('TOPLEFT',4+(i-1)*150,ui.y)
      end
      ui.y=ui.y-42
      text(tracker.status,11,muted)
    end
  elseif category==3 then
    option('minimapButton','Przycisk Guild Hall na minimapie','Panel zawsze otworzysz również poleceniem /ts.')
    option('bagSearch','Szukajka w torbach profilu','Wyszukuje udostępnione przedmioty po nazwie lub ID.')
    if NS.QuestItems then row('Podświetlanie przedmiotów zadaniowych','W standardowych torbach WoW.',NS.QuestItems.enabled(),NS.QuestItems.setEnabled) end
    if NS.LootJournal then row('Prywatny dziennik łupów','Zapisuje do 100 własnych łupów od zielonej jakości.',NS.LootJournal.enabled(),NS.LootJournal.setEnabled) end
    option('snake','Gra Wąż Hordy','Podręczna gra wywoływana poleceniem /tssnake.')
    row('Otwieranie Węża podczas lotu','Uruchamia grę po 45 sekundach lotu taksówką.',db.snakeAuto~=false,function(on) db.snakeAuto=on end)
    if NS.Language then
      row('Język polski','Przełącza interfejs między polskim i angielskim.',NS.Language.language()~='en',function(on) NS.Language.set(on and 'pl' or 'en') end)
    end
  else
    local P=NS.Profiles
    if P then
      option('autoProfile','Automatyczna synchronizacja profili','Automatycznie odświeża udostępnione sekcje.')
      for _,entry in ipairs({{'A','Główna postać'},{'S','Statystyki'},{'G','Złoto'},{'B','Zawartość toreb'},{'E','Wyposażenie'},{'P','Profesje'}}) do
        row(entry[2],'Udostępnij tę część profilu gildii.',P.enabled(entry[1]),function() P.toggle(entry[1]) end)
      end
      text(P.status(),11,muted)
    end
  end
end
local handlers={KADRA=staffPage,USTAWIENIA=NS.settingsPage,START=start,GILDIA=guildPage,['RZEMIOSŁO']=craftPage,ZASOBY=resourcesPage,DISCORD=discordPage,WYDARZENIA=eventsPage,TABLICA=boardPage,RAIDY=raidsPage,['ŁUPY']=lootPage,MAPA=mapPage,PROFIL=profilePage,['SIEĆ']=archivePage,['POSTAĆ']=characterPage,PRZYGOTOWANIE=checklist,HISTORIA=history,POMOC=help}
render=function()
  if not ui then return end
  if ui.heroLight then ui.heroLight:SetAlpha(1) end
  ui.heroLight=nil
  clear()
  local staffAllowed=isGuildOfficer()
  if page=='KADRA' and not staffAllowed then page='START' end
  local currentGroup=groupByPage[page] or 'HOME'
  local y=-40
  for _,g in ipairs(groups) do
    local parent=ui.groups[g.id]
    if g.id=='STAFF' and not staffAllowed then
      parent:Hide(); ui.tabs.KADRA:Hide()
    else
      parent:ClearAllPoints(); parent:SetPoint('TOPLEFT',0,y); parent:Show()
      parent.label:SetText(tr(g.label))
      parent.label:SetTextColor(unpack(g.id==currentGroup and gold or muted))
      parent.selected:SetShown(g.id==currentGroup)
      if g.id~='HOME' and g.id~='STAFF' then parent.chevron:SetText(g.id==currentGroup and '▾' or '▸') end
      parent.marker:SetShown(g.id==currentGroup)
      y=y-35
      if g.id~='HOME' and g.id~='STAFF' then
        for _,name in ipairs(g.pages) do
          local b=ui.tabs[name]
          b.label:SetText(tr(name=='USTAWIENIA' and 'PRZEŁĄCZNIKI' or name))
          if g.id==currentGroup then
            b:ClearAllPoints(); b:SetPoint('TOPLEFT',0,y); b:Show(); y=y-27
            b.label:SetTextColor(unpack(name==page and gold or muted)); b.marker:SetShown(name==page);b.selected:SetShown(name==page)
          else b:Hide() end
        end
      end
    end
  end
  if not db.setupDone then finish(); showSetup(); return end
  local modules={TABLICA='board',WYDARZENIA='planner',['RZEMIOSŁO']='lookup',ZASOBY='lookup',['ŁUPY']='guildLoot',['SIEĆ']='archive'}
  if modules[page] and not feature(modules[page]) then
    section(nil,'Funkcja wyłączona')
    addAction('OTWÓRZ USTAWIENIA',function() page='USTAWIENIA'; ui.settingsCategory=1; render() end,240)
  else handlers[page]() end
  finish()
end
local function createUI()
  local root=CreateFrame('Frame','TheSentencedMain',UIParent,'BackdropTemplate')
  root:SetSize(900,610); root:SetPoint('CENTER'); root:SetFrameStrata('DIALOG'); root:SetClampedToScreen(true)
  root:SetBackdrop({bgFile='Interface\\DialogFrame\\UI-DialogBox-Background',edgeFile='Interface\\DialogFrame\\UI-DialogBox-Gold-Border',tile=true,tileSize=32,edgeSize=32,insets={left=11,right=12,top=12,bottom=11}})
  root:SetBackdropColor(.35,.30,.24,1); root:SetBackdropBorderColor(1,1,1,1)
  -- Some client builds ship a transparent dialog texture; keep game-world
  -- names and effects from bleeding through the content and harming contrast.
  local opaque=root:CreateTexture(nil,'BACKGROUND',nil,-7);opaque:SetPoint('TOPLEFT',7,-7);opaque:SetPoint('BOTTOMRIGHT',-7,7);opaque:SetColorTexture(.066,.075,.096,.99)
  root:SetMovable(true); root:EnableMouse(true); root:RegisterForDrag('LeftButton')
  local intro=root:CreateAnimationGroup(); local fade=intro:CreateAnimation('Alpha')
  fade:SetFromAlpha(0); fade:SetToAlpha(1); fade:SetDuration(.18)
  root:SetScript('OnShow',function() intro:Play() end)
  local pulseTime=0
  root:SetScript('OnUpdate',function(_,elapsed)
    if page=='START' and ui and ui.heroLight then
      pulseTime=pulseTime+(elapsed or 0)
      ui.heroLight:SetAlpha(.55+.40*(.5+.5*math.sin(pulseTime*1.8)))
    end
  end)
  root:SetScript('OnDragStart',function(self) self:StartMoving() end); root:SetScript('OnDragStop',function(self) self:StopMovingOrSizing() end)
  root:SetScript('OnHide',function(self)
    self:StopMovingOrSizing()
    if ui then for _,key in ipairs({'profilePopup','eventPopup','eventCompose','privateEventPopup','boardCompose','boardDetail'}) do local popup=ui[key]; if popup then popup:Hide() end end end
  end)
  local header=CreateFrame('Frame',nil,root); header:SetPoint('TOPLEFT',7,-7); header:SetPoint('TOPRIGHT',-7,-7); header:SetHeight(58); solid(header,.15,.13,.16,1)
  local edge=header:CreateTexture(nil,'ARTWORK'); edge:SetPoint('BOTTOMLEFT'); edge:SetPoint('BOTTOMRIGHT'); edge:SetHeight(2); edge:SetColorTexture(.65,.45,.23,1)
  local badge=NS.Theme and NS.Theme.crest(header); if badge then badge:SetPoint('TOPLEFT',8,-3) end
  local logo=font(header,'THE SENTENCED',20,gold); logo:SetPoint('TOPLEFT',badge and 72 or 24,-12)
  if NS.Theme then NS.Theme.font(logo,20,'title') end
  local sub=font(header,'GUILD HALL     •     FOREVER',10,muted); sub:SetPoint('TOPLEFT',badge and 73 or 25,-39)
  local debug=button(header,'DIAGNOSTYKA',135,30,function() if NS.Diagnostics then NS.Diagnostics.show() end end); debug:SetPoint('RIGHT',-60,0)
  local close=button(header,'×',32,32,function() root:Hide() end); close:SetPoint('RIGHT',-15,0)
  local sidebar=CreateFrame('Frame',nil,root); sidebar:SetPoint('TOPLEFT',7,-65); sidebar:SetPoint('BOTTOMLEFT',7,8); sidebar:SetWidth(190); solid(sidebar,.092,.102,.127,1)
  local sideEdge=sidebar:CreateTexture(nil,'ARTWORK');sideEdge:SetPoint('TOPRIGHT');sideEdge:SetPoint('BOTTOMRIGHT');sideEdge:SetWidth(1);sideEdge:SetColorTexture(.49,.35,.20,.7)
  local sideTitle=font(sidebar,'CENTRUM GILDII',10,gold); sideTitle:SetPoint('TOPLEFT',18,-20)
  local tabs,groupButtons={},{}
  for _,g in ipairs(groups) do
    local parent=CreateFrame('Button',nil,sidebar); parent:SetSize(190,32)
    parent.selected=parent:CreateTexture(nil,'BACKGROUND');parent.selected:SetAllPoints();parent.selected:SetColorTexture(.30,.20,.11,.72)
    parent:SetHighlightTexture('Interface\\QuestFrame\\UI-QuestTitleHighlight')
    local icon=parent:CreateTexture(nil,'ARTWORK');icon:SetSize(18,18);icon:SetPoint('LEFT',13,0);icon:SetTexture('Interface\\Icons\\'..groupIcons[g.id])
    parent.label=font(parent,g.label,10,muted); parent.label:SetPoint('LEFT',38,0)
    if g.id~='HOME' and g.id~='STAFF' then parent.chevron=font(parent,'▸',13,gold); parent.chevron:SetPoint('RIGHT',-14,0) end
    parent.marker=parent:CreateTexture(nil,'ARTWORK'); parent.marker:SetSize(3,27); parent.marker:SetPoint('LEFT',0,0); parent.marker:SetColorTexture(unpack(red))
    parent:SetScript('OnClick',function() page=g.pages[1]; render() end); groupButtons[g.id]=parent
    if g.id=='HOME' or g.id=='STAFF' then tabs[g.pages[1]]=parent
    else
      for _,n in ipairs(g.pages) do
        local b=CreateFrame('Button',nil,sidebar); b:SetSize(190,26)
        b.selected=b:CreateTexture(nil,'BACKGROUND');b.selected:SetAllPoints();b.selected:SetColorTexture(.24,.17,.10,.75)
        b:SetHighlightTexture('Interface\\QuestFrame\\UI-QuestTitleHighlight')
        b.label=font(b,n,10,muted); b.label:SetPoint('LEFT',34,0)
        b.marker=b:CreateTexture(nil,'ARTWORK'); b.marker:SetSize(2,17); b.marker:SetPoint('LEFT',20,0); b.marker:SetColorTexture(unpack(gold))
        b:SetScript('OnClick',function() page=n; render() end); tabs[n]=b
      end
    end
  end
  local footer=font(sidebar,'EST. 2005\nH O R D E  •  E U',10,muted); footer:SetPoint('BOTTOMLEFT',18,22)
  local scroll=CreateFrame('ScrollFrame','TheSentencedScroll',root,'UIPanelScrollFrameTemplate'); scroll:SetPoint('TOPLEFT',sidebar,'TOPRIGHT',26,-23); scroll:SetPoint('BOTTOMRIGHT',root,'BOTTOMRIGHT',-33,22)
  local child=CreateFrame('Frame',nil,scroll); child:SetSize(630,480); scroll:SetScrollChild(child)
  ui={root=root,tabs=tabs,groups=groupButtons,scroll=scroll,scrollChild=child}
  tinsert(UISpecialFrames,'TheSentencedMain'); root:Hide()
end
local function toggle(command)
  if type(command)=='string' and command:lower():match('^%s*debug%s*$') and NS.Diagnostics then NS.Diagnostics.show(); return end
  if not ui then createUI() end
  if not db.setupDone then
    if ui.setup and ui.setup:IsShown() then ui.setup:Hide() else showSetup() end
  elseif ui.root:IsShown() then ui.root:Hide() else requestRoster(); ui.root:Show(); render() end
end
local setupAutoShown=false
local minimapButton
local function createMinimapButton()
  if not feature('minimapButton') then return end
  if not Minimap then return end
  if minimapButton then minimapButton:Show(); return end
  local b=CreateFrame('Button','TheSentencedMinimapButton',Minimap,'BackdropTemplate'); minimapButton=b
  b:SetSize(34,34); b:SetFrameStrata('HIGH'); b:SetFrameLevel((Minimap:GetFrameLevel() or 0)+12)
  b:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=2})
  b:SetBackdropColor(.30,.07,.06,1); b:SetBackdropBorderColor(.85,.63,.29,1)
  local emblem=b:CreateTexture(nil,'ARTWORK');emblem:SetPoint('TOPLEFT',2,-2);emblem:SetPoint('BOTTOMRIGHT',-2,2);emblem:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\GuildCrest.tga')
  b:SetHighlightTexture('Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight')
  local function position(angle)
    local width,height=Minimap:GetWidth(),Minimap:GetHeight()
    if type(width)~='number' or width<=0 then width=140 end
    if type(height)~='number' or height<=0 then height=140 end
    local radius=math.max(40,math.min(width,height)/2+3)
    b:ClearAllPoints(); b:SetPoint('CENTER',Minimap,'CENTER',math.cos(angle)*radius,math.sin(angle)*radius)
  end
  local angle=db and tonumber(db.minimapAngle)
  if not angle or angle~=angle or math.abs(angle)>100 then angle=-math.pi/4 end
  position(angle)
  b:RegisterForDrag('LeftButton')
  b:SetScript('OnDragStart',function(self) self.dragging=true end)
  b:SetScript('OnDragStop',function(self) self.dragging=false end)
  b:SetScript('OnUpdate',function(self)
    if not self.dragging or not GetCursorPosition or not Minimap.GetCenter then return end
    local cx,cy=Minimap:GetCenter(); if not cx or not cy then return end
    local scale=Minimap:GetEffectiveScale(); if not scale or scale<=0 then return end
    local x,y=GetCursorPosition(); if not x or not y then return end
    x=x/scale-cx; y=y/scale-cy
    local a
    if math.atan2 then a=math.atan2(y,x)
    elseif x>0 then a=math.atan(y/x)
    elseif x<0 then a=math.atan(y/x)+(y>=0 and math.pi or -math.pi)
    elseif y~=0 then a=y>0 and math.pi/2 or -math.pi/2 end
    if a then if db then db.minimapAngle=a end; position(a) end
  end)
  b:SetScript('OnClick',toggle)
  b:SetScript('OnEnter',function(self) if GameTooltip then GameTooltip:SetOwner(self,'ANCHOR_LEFT'); GameTooltip:SetText('The Sentenced'); GameTooltip:AddLine('Kliknij: otwórz panel'); GameTooltip:AddLine('Przeciągnij: przesuń ikonę'); GameTooltip:Show() end end)
  b:SetScript('OnLeave',function() if GameTooltip then GameTooltip:Hide() end end)
  b:Show()
end
NS.createMinimapButton=createMinimapButton
app:RegisterEvent('ADDON_LOADED'); app:RegisterEvent('PLAYER_ENTERING_WORLD'); app:RegisterEvent('PLAYER_GUILD_UPDATE'); app:RegisterEvent('GUILD_ROSTER_UPDATE'); app:RegisterEvent('CHAT_MSG_ADDON_LOGGED'); app:RegisterEvent('CHAT_MSG_ADDON'); app:RegisterEvent('PLAYER_TARGET_CHANGED'); app:RegisterEvent('CHAT_MSG_GUILD')
for _,event in ipairs({'BAG_UPDATE_DELAYED','PLAYER_EQUIPMENT_CHANGED','PLAYER_MONEY','UNIT_STATS','UNIT_MAXHEALTH','SKILL_LINES_CHANGED'}) do app:RegisterEvent(event) end
local function handleEvent(_,event,arg1,...)
  if event=='ADDON_LOADED' and arg1==addonName then
    local isNewInstallation=type(TheSentencedDB)~='table'
    if type(TheSentencedDB)~='table' then TheSentencedDB={} end
    db=TheSentencedDB
    if NS.TestCleanup then NS.TestCleanup.run(db) end
    if NS.Diagnostics then NS.Diagnostics.init(function()
      local function count(t) local n=0;for _ in pairs(type(t)=='table' and t or {}) do n=n+1 end;return n end
      local k=guildKey();local plan=k and db.planners and db.planners[k];local finds=k and db.finds and db.finds[k];local board=k and db.boards and db.boards[k]
      local state={['identity.resolved']=me()~=nil,['guild.scopeReady']=k~=nil,['ui.page']=page,['ui.created']=ui~=nil,['ui.setupDone']=db.setupDone==true,
        ['data.events']=count(plan and plan.items),['data.privateNotes']=count(db.events),['data.board']=count(board and board.items),
        ['data.finds']=count(finds and finds.items),['data.autoNodes']=count(db.autoNodes),['data.manualNodes']=count(db.manualNodes),
        ['map.worldEnabled']=db.mapPinsWorld==true,['map.miniEnabled']=db.mapPinsMini==true,
        ['map.hidden']=count(db.hiddenMapPins and db.hiddenMapPins[k or ''])}
      local records=k and db.profileRecords and db.profileRecords[k];state['profiles.peers']=count(records)
      for _,cat in ipairs({'E','B','G','S','P'}) do local n=0;for _,r in pairs(records or {}) do if r[cat] then n=n+1 end end;state['profiles.received.'..cat]=n end
      for _,cat in ipairs({'E','B','G','S','P'}) do state['profile.share.'..cat]=NS.Profiles and NS.Profiles.enabled(cat) or false end
      for key,value in pairs(NS.mapDebug or {}) do state['map.'..key]=value end
      return state
    end,function() local m=me();return m and m.name end) end
    SLASH_THESENTENCED1='/ts'; SLASH_THESENTENCED2='/sentenced'
    SlashCmdList.THESENTENCED=toggle
    if NS.LootJournal then
      NS.LootJournal.onChanged=function()
        local popup=ui and ui.profilePopup
        local own=me()
        if popup and popup:IsShown() and popup.selectedTab=='LOOT' and own and popup.targetName==own.name then
          openProfilePopup(own.name)
        end
      end
      NS.LootJournal.configure()
    end
    if NS.GuildLinks then NS.GuildLinks.install(NS.GuildAccess.scopeId,function(kind,author,id)
      if not feature('guildLinks') then return end
      if not ui then toggle('') end
      if not ui then return end
      ui.root:Show()
      if kind=='E' then
        local plan=plannerTable()
        if plan and plan.items[author..'|'..id] then openEventPopup(author..'|'..id); return end
      else
        local board=boardTable()
        for _,entry in ipairs(board and board.items or {}) do
          if entry.sender==author and entry.id==id then showBoardDetail(entry); return end
        end
      end
      if NS.EventSync then NS.EventSync.request() end
      log('Brak wpisu w tej kopii. Jeśli autor jest online, kliknij ponownie po synchronizacji.')
    end) end
    if NS.EventSync then NS.EventSync.init({scope=guildKey,selfName=function() local m=me(); return m and m.name end,
      snapshot=ownCatchupSnapshot,jitter=function() return math.random(0,20) end,
      send=function(payload,prefix)
        if not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then return false end
        prefix=prefix or 'TSGuildEvent'
        if prefix~='TSGuildEvent' and prefix~='TSGuildHall' and prefix~='TSGuildFinds' then return false end
        local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,prefix,payload,'GUILD')
        return ok and type(result)=='number' and result==0
      end}) end
    if NS.EventRetry then NS.EventRetry.init({scope=guildKey,send=function(payload)
      if C_ChatInfo and C_ChatInfo.SendAddonMessageLogged then (NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged)('TSGuildEvent',payload,'GUILD') end
    end}) end
    if db.mapPinsWorld==nil then db.mapPinsWorld=true end
    if db.mapPinsMini==nil then db.mapPinsMini=true end
    if type(db.events)~='table' then db.events={} end
    if type(db.checks)~='table' then db.checks={} end
    if type(db.board)~='table' then db.board={} end
    if type(TheSentencedGuildDB)~='table' then TheSentencedGuildDB={} end
    if NS.Profiles then
      NS.Profiles.init({db=function() return db end,scope=guildKey,newInstall=isNewInstallation,
        member=function(name) local m=member(name); return m and m.name end,
        me=function() local m=me(); return m and m.name end,
        changed=function(who,cat,revoked)
          local popup=ui and ui.profilePopup
          if popup and popup:IsShown() and type(who)=='string' and popup.targetName==who then
            if revoked then popup:Hide() elseif openProfilePopup then openProfilePopup(who) end
          end
          if ui and ui.root:IsShown() and (page=='PROFIL' or page=='POSTAĆ' or page=='RZEMIOSŁO' or page=='ZASOBY') and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render() end
        end})
    end
    if NS.Ready then NS.Ready.init({db=function()return db end,scope=guildKey,member=member,me=me}) end
    if NS.Archive then
      NS.Archive.init({
        scope=guildKey,
        selfName=function() local m=me(); return m and m.name end,
        member=function(name) local m=member(name); return m and m.name end,
        store=function()
          local k=guildKey(); if not k then return nil end
          db.archives=db.archives or {}; db.archives[k]=db.archives[k] or {records={}}
          return db.archives[k]
        end,
      })
    end
    if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then (NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix)('TSGuildHall'); (NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix)('TSGuildEvent'); (NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix)('TSGuildFinds') end
    createMinimapButton()
    log('Guild Hall gotowy. Wpisz /ts, aby otworzyć panel.')
  elseif event=='PLAYER_TARGET_CHANGED' then
    if ui and ui.profilePopup then ui.profilePopup:Hide() end
  elseif event=='PLAYER_ENTERING_WORLD' or event=='PLAYER_GUILD_UPDATE' then
    if ui and ui.profilePopup then ui.profilePopup:Hide() end
    createMinimapButton(); requestRoster()
    if event=='PLAYER_ENTERING_WORLD' and NS.EventSync then NS.EventSync.start() end
    if event=='PLAYER_ENTERING_WORLD' and NS.Profiles and NS.Profiles.startAuto then NS.Profiles.startAuto()
    elseif event=='PLAYER_GUILD_UPDATE' and NS.Profiles and NS.Profiles.guildChanged then NS.Profiles.guildChanged() end
    if db and not db.setupDone and not setupAutoShown then setupAutoShown=true; toggle() end
  elseif event=='BAG_UPDATE_DELAYED' or event=='PLAYER_EQUIPMENT_CHANGED' or event=='PLAYER_MONEY' or event=='UNIT_STATS' or event=='UNIT_MAXHEALTH' or event=='SKILL_LINES_CHANGED' then
    if NS.Profiles and NS.Profiles.changedLocal then NS.Profiles.changedLocal(event,arg1) end
  elseif event=='CHAT_MSG_GUILD' then
    if not NS.GuildLinks or not feature('guildLinks') or not NS.GuildAccess or not NS.GuildAccess.isMember() then return end
    local sender=select(1,...)
    if issecretvalue and (issecretvalue(arg1) or issecretvalue(sender)) then return end
    local who=type(sender)=='string' and member(sender)
    local selfMember=me()
    local payload=who and selfMember and NS.GuildLinks.echo(arg1,who.name,selfMember.name,NS.GuildAccess.scopeId())
    if payload and C_ChatInfo and C_ChatInfo.SendAddonMessageLogged then
      pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildHall',payload,'GUILD')
    end
  elseif event=='CHAT_MSG_ADDON_LOGGED' or event=='CHAT_MSG_ADDON' then
    if NS.GuildAccess and not NS.GuildAccess.isMember() then return end
    local prefix,message,channel,sender=arg1,select(1,...)
    if issecretvalue and (issecretvalue(prefix) or issecretvalue(message) or issecretvalue(channel) or issecretvalue(sender)) then diag('rx.protected');return end
    if type(prefix)~='string' or not prefix:match('^TSGuild') then return end
    if channel~='GUILD' then if NS.Diagnostics then pcall(NS.Diagnostics.rx,event,prefix,message,channel,sender,false) end;return end
    local resolved=type(sender)=='string' and member(sender) or nil
    local known=resolved~=nil;local canonicalSender=resolved and resolved.name or sender
    if event~='CHAT_MSG_ADDON_LOGGED' then if NS.Diagnostics then pcall(NS.Diagnostics.rx,event,prefix,message,channel,canonicalSender,known) end; return end
    if not known then return end
    if NS.Wire then message=NS.Wire.receive(guildKey(),prefix,canonicalSender,message); if not message then return end end
    if NS.Diagnostics then
      pcall(NS.Diagnostics.rx,event,prefix,message,channel,canonicalSender,known)
      if prefix=='TSGuildDiag' and channel=='GUILD' then pcall(NS.Diagnostics.receiveProbe,message,canonicalSender,known); return end
    end
    if event~='CHAT_MSG_ADDON_LOGGED' then return end
    if prefix=='TSGuildHall' and type(message)=='string' and message:sub(1,3)=='L1|' then
      if feature('guildLinks') and NS.GuildLinks and NS.GuildAccess then
        NS.GuildLinks.show(message:sub(4),canonicalSender,NS.GuildAccess.scopeId())
      end
      return
    end
    if channel=='GUILD' then
      if NS.Archive and feature('archive') then NS.Archive.event(prefix,message,channel,sender) end
      if prefix=='TSGuildEvent' and message=='Q1|1' and NS.EventSync then local m=member(sender); if m then NS.EventSync.receiveQuery(m.name) end
      elseif prefix=='TSGuildEvent' and NS.receivePlanner then NS.receivePlanner(message,sender) end
      if prefix=='TSGuildFinds' and NS.receiveFinds then NS.receiveFinds(message,sender) end
      if prefix=='TSGuildProf' and NS.Profiles then NS.Profiles.receive(message,sender) end
      if prefix=='TSGuildReady' and NS.Ready and NS.Ready.receive(message,canonicalSender) and ui and ui.root:IsShown() and page=='PRZYGOTOWANIE' and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render() end
    end
    if prefix=='TSGuildHall' and channel=='GUILD' and db then NS.receiveBoard(message,sender) end
  elseif event=='GUILD_ROSTER_UPDATE' then
    if NS.Profiles and NS.Profiles.guildChanged then NS.Profiles.guildChanged() end
    if ui and ui.root:IsShown() and (page=='GILDIA' or page=='START') and (not GetCurrentKeyBoardFocus or not GetCurrentKeyBoardFocus()) then render() end
  end
end
app:SetScript('OnEvent',function(...)
  if NS.Diagnostics then return NS.Diagnostics.run('event',handleEvent,...) end
  return handleEvent(...)
end)
