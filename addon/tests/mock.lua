unpack=table.unpack or unpack
tinsert=table.insert
local all={}
local mt={}
mt.__index=function(o,k)
 if k=='CreateTexture' or k=='CreateFontString' or k=='CreateAnimationGroup' or k=='CreateAnimation' then return function(self) local f=setmetatable({shown=true,parent=self},mt); all[#all+1]=f; return f end end
 if k=='SetParent' then return function(self,p) self.parent=p end end
 if k=='SetPoint' then return function(self,...) self.point={...} end end
 if k=='SetScript' then return function(self,n,f) self.scripts[n]=f end end
 if k=='GetScript' then return function(self,n) return self.scripts[n] end end
 if k=='GetText' then return function(self) return self.text or '' end end
 if k=='SetText' then return function(self,x) self.text=x end end
 if k=='Insert' then return function(self,x) self.text=(self.text or '')..x end end
 if k=='SetFrameStrata' then return function(self,x) self.strata=x end end
 if k=='SetFrameLevel' then return function(self,x) self.level=x end end
 if k=='SetAlpha' then return function(self,x) self.alpha=x end end
 if k=='GetFont' then return function() return 'mockfont' end end
 if k=='GetStringHeight' then return function(self) return math.max(12,math.ceil(#(self.text or '')/80)*15) end end
 if k=='Show' then return function(self) self.shown=true end end
 if k=='Hide' then return function(self) self.shown=false end end
 if k=='IsShown' then return function(self) return self.shown end end
 if k=='SetShown' then return function(self,v) self.shown=v end end
 if k=='HasFocus' then return function() return false end end
 return function() end
end
function CreateFrame(type,name,parent,template)
 if template=='InputBoxTemplate' and os.getenv('TS_TEST_NO_NATIVE')=='1' then error('template unavailable') end
 local f=setmetatable({scripts={},shown=true,frameType=type,name=name,parent=parent,template=template},mt); all[#all+1]=f; return f
end
UIParent={}; Minimap=setmetatable({shown=true},mt); GameFontNormal=setmetatable({},mt); ChatFontNormal={}; UISpecialFrames={}; SlashCmdList={}
function Minimap:GetWidth() return 140 end
function Minimap:GetHeight() return 140 end
function Minimap:GetCenter() return 100,100 end
function Minimap:GetEffectiveScale() return 1 end
function GetCursorPosition() return 100,200 end
function IsInGuild() return true end
function GetGuildInfo() return 'The Sentenced' end
function GetNumGuildMembers() return 2,1 end
function IsInRaid() return true end
function GetNumGroupMembers() return 2 end
function GetRaidRosterInfo(i)
 if i==1 then return 'Damian-Realm',0,1,60,'Warrior','WARRIOR','',true end
 if i==5 then return 'Test-Realm',0,1,60,'Mage','MAGE','',true end
 return nil
end
function GetGuildRosterInfo(i)
 if i==1 then return 'Damian-Realm','Guild Master',0,40,'Paladin','Orgrimmar','','',true,0,'PALADIN' end
 if i==2 then return 'Test-Realm','Officer',1,30,'Mage','Durotar','','',false,0,'MAGE' end
end
C_GuildInfo={GuildRoster=function() end}
local calendarOpened=0;function ToggleCalendar()calendarOpened=calendarOpened+1 end
function UnitName() return 'Damian' end
function UnitLevel() return 40 end
function UnitClass() return 'Paladin' end
function GetProfessions() return nil, 2 end
function GetProfessionInfo(i) return 'Mining',nil,100,300 end
function ChatFrame_SendTell(name) assert(name=='Damian-Realm' or name=='Test-Realm') end
local ns={}
TheSentencedDB={setupDone=true,lang='pl',minimapAngle=0.5}
assert(loadfile('TheSentenced/Wire.lua'))('TheSentenced',ns);assert(loadfile('TheSentenced/Diagnostics.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/Localization.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/Raids.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/Archive.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/Profiles.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/EventRetry.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/EventSync.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/InstancePicker.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/MemberPicker.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/EventPicker.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/RosterSearch.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/LootJournal.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/NativeProfessions.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/TransferSync.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/CraftDirectory.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/ResourceDirectory.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/Ready.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/GameCalendar.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/CompanionSnapshot.lua'))('TheSentenced',ns)
C_Club=C_Club or {}
C_Club.GetGuildClubId=function() return 215750322 end
assert(loadfile('TheSentenced/GuildAccess.lua'))('TheSentenced',ns)
local loader=assert(loadfile('TheSentenced/Core.lua'))
loader('TheSentenced',ns)
assert(loadfile('TheSentenced/GuildWelcome.lua'))('TheSentenced',ns)
assert(loadfile('TheSentenced/MapPins.lua'))('TheSentenced',ns)
all[1].scripts.OnEvent(all[1],'ADDON_LOADED','TheSentenced')
assert(SlashCmdList.THESENTENCED)
local minimapButton; for _,f in ipairs(all) do if f.name=='TheSentencedMinimapButton' then minimapButton=f end end
assert(minimapButton and minimapButton.shown and minimapButton.scripts.OnClick,'missing minimap launcher')
assert(math.abs(minimapButton.point[4]-math.cos(.5)*73)<.001,'saved minimap position not restored')
minimapButton.scripts.OnDragStart(minimapButton); minimapButton.scripts.OnUpdate(minimapButton); minimapButton.scripts.OnDragStop(minimapButton)
assert(math.abs(TheSentencedDB.minimapAngle-math.pi/2)<.001,'drag should save angle')
minimapButton:Hide(); all[1].scripts.OnEvent(all[1],'PLAYER_ENTERING_WORLD'); assert(minimapButton.shown,'button should return after entering world')
SlashCmdList.THESENTENCED()
local function navigationButton(name)
 for _,f in ipairs(all) do if rawget(f,'label') and f.label.text==name then return f end end
 error('missing navigation button '..name)
end
for _,name in ipairs({'START','GILDIA I OGŁOSZENIA','WYPRAWY I ZAPISY','PRZEDMIOTY I ŁUPY','MAPA I ODKRYCIA','USTAWIENIA'}) do
 assert(navigationButton(name).shown,'category must be visible on start: '..name)
end
for _,name in ipairs({'GILDIA','RZEMIOSŁO','ZASOBY','TABLICA','PROFIL','SIEĆ','HISTORIA','WYDARZENIA','RAIDY','PRZYGOTOWANIE','ŁUPY','MAPA','POSTAĆ','POMOC'}) do
 assert(not navigationButton(name).shown,'subpage must start collapsed: '..name)
end
local function tab(name)
 local parent={}
 local categories={
   ['GILDIA I OGŁOSZENIA']={'GILDIA','RZEMIOSŁO','ZASOBY','TABLICA','PROFIL','SIEĆ','HISTORIA'},
   ['WYPRAWY I ZAPISY']={'WYDARZENIA','RAIDY','PRZYGOTOWANIE'},
   ['PRZEDMIOTY I ŁUPY']={'ŁUPY'},
   ['MAPA I ODKRYCIA']={'MAPA'},
   ['USTAWIENIA']={'USTAWIENIA','POSTAĆ','POMOC'},
 }
 for category,pages in pairs(categories) do
   for _,page in ipairs(pages) do parent[page]=category end
 end
 for _,f in ipairs(all) do if rawget(f,'label') and f.label.text==name then
   if not f.shown and parent[name] then
     for _,g in ipairs(all) do if rawget(g,'label') and g.label.text==parent[name] then g.scripts.OnClick(g); break end end
   end
   assert(f.shown,'selected page must be visible inside its group: '..name)
   f.scripts.OnClick(f); return
 end end
 error('missing tab '..name)
end
local function activeButton(label)
 for _,f in ipairs(all) do
  if rawget(f,'text')==label and rawget(f,'shown') and rawget(f,'parent') and f.parent.scripts and f.parent.scripts.OnClick and f.parent.shown then return f.parent end
 end
 error('missing active button '..label)
end
tab('USTAWIENIA')
assert(activeButton('✓  Gildia'),'settings open at guild options')
activeButton('Wygoda').scripts.OnClick()
local snakeTaxi
for _,f in ipairs(all) do
 if rawget(f,'text')=='Otwieranie Węża podczas lotu' and f.shown then snakeTaxi=f.parent end
end
assert(snakeTaxi,'flight game has a settings switch')
for _,f in ipairs(all) do
 if rawget(f,'parent')==snakeTaxi and f.frameType=='Button' and f.shown then f.scripts.OnClick(); break end
end
assert(TheSentencedDB.snakeAuto==false,'settings persist flight launch preference')
local n=0
for _,name in ipairs({'START','GILDIA','RZEMIOSŁO','ZASOBY','WYDARZENIA','TABLICA','RAIDY','ŁUPY','MAPA','PROFIL','SIEĆ','POSTAĆ','PRZYGOTOWANIE','HISTORIA','POMOC'}) do
 local found
 for _,f in ipairs(all) do if rawget(f,'label') and f.label.text==name then found=f; break end end
 assert(found,'Missing tab '..name); tab(name); n=n+1
end
local profileGet=ns.Profiles.get
ns.Profiles.get=function(name) if name=='Damian-Realm' then return {P={professions={'Alchemy 125/300'},received=17}} end end
tab('RZEMIOSŁO')
local craftFound=false
for _,f in ipairs(all) do if f.shown and rawget(f,'text')=='Damian-Realm  •  Alchemy 125/300' then craftFound=true end end
assert(craftFound,'shared profession should appear in the directory')
activeButton('SZEPT').scripts.OnClick()
activeButton('POPROŚ O WYTWORZENIE').scripts.OnClick()
local craftForm;for _,f in ipairs(all) do if f.name=='TheSentencedBoardCompose' then craftForm=f end end
assert(craftForm and craftForm.shown and craftForm.input:GetText()=='Szukam wytworzenia: ','craft request opens a prefilled draft without sending')
craftForm.input:SetText('Mój niedokończony szkic');craftForm:Hide();activeButton('POPROŚ O WYTWORZENIE').scripts.OnClick()
assert(craftForm.input:GetText()=='Mój niedokończony szkic','craft request preserves an existing draft')
craftForm.input:SetText('');craftForm.categories[1].scripts.OnClick();craftForm:Hide()
ns.Profiles.get=profileGet
ns.Profiles.get=function(name)if name=='Damian-Realm' then return {B={items={{id=101,count=3}},received=17}} end end
tab('ZASOBY')
local resourceSearch;for _,f in ipairs(all) do if f.shown and rawget(f,'text')=='Nazwa lub ID przedmiotu...' then resourceSearch=f.parent end end
assert(resourceSearch,'resource search field missing');resourceSearch:SetText('101');resourceSearch.scripts.OnEnterPressed(resourceSearch)
local resourceFound=false;for _,f in ipairs(all) do if f.shown and rawget(f,'text')=='Item ID  101' then resourceFound=true end end
assert(resourceFound,'shared resource should appear in results');activeButton('SZEPT').scripts.OnClick();ns.Profiles.get=profileGet
tab('START')
local main; for _,f in ipairs(all) do if f.name=='TheSentencedMain' then main=f end end
assert(main and main.scripts.OnUpdate,'dashboard animation driver missing')
main.scripts.OnUpdate(main,0.5)
local animated; for _,f in ipairs(all) do if type(rawget(f,'alpha'))=='number' and f.alpha<1 then animated=f end end
assert(animated,'dashboard accent should animate')
tab('GILDIA'); assert(animated.alpha==1,'recycled dashboard texture must reset alpha')
local nativeInput,fallbackInput=false,false;for _,f in ipairs(all) do if f.frameType=='EditBox' and f.template=='InputBoxTemplate' then nativeInput=true elseif f.frameType=='EditBox' and f.template=='BackdropTemplate' and f.tsNativeInput==false then fallbackInput=true end end
if os.getenv('TS_TEST_NO_NATIVE')=='1' then assert(fallbackInput,'forms must fall back when Blizzard input is unavailable') else assert(nativeInput,'forms should use the Blizzard input template') end
assert(navigationButton('SIEĆ').shown and not navigationButton('WYDARZENIA').shown,'only the active group should expand')
assert(#TheSentencedDB.events==0)
tab('WYDARZENIA')
local bridgeTime=GetServerTime
GetServerTime=function() return 1800000000 end
ns.CompanionSnapshot={schema=1,generatedAt=1800000000,raids={{id=1,title='Test Discord',when=1800003600,capacity=10}},expeditions={}}
tab('START');local bridgeHome=false;for _,f in ipairs(all) do if f.shown and rawget(f,'text')=='NAJBLIŻSZE Z DISCORDA' then bridgeHome=true end end
assert(bridgeHome,'upcoming Discord event should appear on the dashboard')
tab('WYDARZENIA');local bridgeVisible=false;for _,f in ipairs(all) do if f.shown and rawget(f,'text')=='RAID  •  Test Discord' then bridgeVisible=true end end
assert(bridgeVisible,'Discord event projection should appear in the planner');ns.CompanionSnapshot={schema=1,generatedAt=0,raids={},expeditions={}};GetServerTime=bridgeTime;tab('WYDARZENIA')
activeButton('OTWÓRZ KALENDARZ GRY').scripts.OnClick();assert(calendarOpened==1,'native calendar should open on request')
local edits={}
for _,f in ipairs(all) do if f.frameType=='EditBox' and f.shown then edits[#edits+1]=f end end
assert(#edits>=2,'expected event fields'); local function hintField(h) for _,f in ipairs(all) do if rawget(f,'text')==h and f.parent and f.parent.frameType=='EditBox' and f.parent.shown then return f.parent end end error('missing '..h) end
hintField('Nazwa, np. Raid / Dungeon'):SetText('Molten Core'); hintField('Termin, np. sobota 20:00'):SetText('Sobota 20:00')
activeButton('ZAPISZ NOTATKĘ').scripts.OnClick()
assert(#TheSentencedDB.events==1 and TheSentencedDB.events[1].title=='Molten Core')
activeButton('SZCZEGÓŁY').scripts.OnClick()
local privateEvent; for _,f in ipairs(all) do if f.name=='TheSentencedPrivateEvent' then privateEvent=f end end
assert(privateEvent and privateEvent.shown and privateEvent.strata=='FULLSCREEN_DIALOG' and privateEvent.title.text=='Molten Core','private details visible')
privateEvent:Hide()
activeButton('USUŃ').scripts.OnClick()
assert(#TheSentencedDB.events==0)
tab('PRZYGOTOWANIE'); activeButton('OZNACZ').scripts.OnClick()
assert(TheSentencedDB.checks[1]==true)
activeButton('WYCZYŚĆ CHECKLISTĘ').scripts.OnClick(); assert(not TheSentencedDB.checks[1])
local chatBeforeReady,timeBeforeReady=C_ChatInfo,GetServerTime;local readySends={}
GetServerTime=function()return 1800000000 end
C_ChatInfo={SendAddonMessageLogged=function(prefix,msg,channel)readySends[#readySends+1]={prefix,msg,channel};return 0 end}
activeButton('ZGŁOŚ GOTOWOŚĆ').scripts.OnClick();assert(#readySends==0,'incomplete checklist must not publish readiness')
for i=1,6 do TheSentencedDB.checks[i]=true end;tab('PRZYGOTOWANIE')
activeButton('ZGŁOŚ GOTOWOŚĆ').scripts.OnClick();assert(#readySends==1 and readySends[1][1]=='TSGuildReady','explicit ready publishes a bounded guild status')
activeButton('COFNIJ GOTOWOŚĆ').scripts.OnClick();assert(#readySends==2,'explicit revoke publishes a status')
TheSentencedDB.checks={};C_ChatInfo=chatBeforeReady;GetServerTime=timeBeforeReady
local before=#all
for i=1,30 do tab('START'); tab('GILDIA'); tab('POMOC') end
assert(#all==before,'repeated rendering should reuse UI objects: '..before..' -> '..#all)
print('MOCK_OK: loaded, opened, rendered '..n..' tabs; roster, profession fallback')

-- Operator workflow through the real buttons and edit fields.
local function visible(obj)
  while type(obj)=='table' and obj~=UIParent do
    if rawget(obj,'shown')==false then return false end
    obj=rawget(obj,'parent')
  end
  return true
end
local function editByHint(hint,number)
  local found={}
  for _,f in ipairs(all) do
    local parent=rawget(f,'parent')
    if rawget(f,'text')==hint and visible(f) and parent and parent.frameType=='EditBox' then found[#found+1]=parent end
  end
  assert(found[number or 1],'missing edit hint '..hint); return found[number or 1]
end
local lkey='The Sentenced@?'
assert(not ns.Transport and not ns.Domain and not ns.Auction,'DKP is not loaded')
ns.receiveBoard('B1|77|GRUPA|Szukam grupy {item:123}','Damian-Realm')
ns.receiveBoard('B1|77|GRUPA|Szukam grupy {item:123}','Damian-Realm')
ns.receiveBoard('B2|Damian-Realm|77|78|Jestem chetny','Test-Realm')
ns.receiveBoard('B2|Damian-Realm|77|78|Jestem chetny','Test-Realm')
local board=TheSentencedDB.boards[lkey]
assert(#board.items==1 and #board.items[1].replies==1 and board.items[1].replies[1].sender=='Test-Realm','board idempotence')
tab('START')
local boardPreview=false
for _,f in ipairs(all) do if visible(f) and type(rawget(f,'text'))=='string' and f.text:find('Szukam grupy %[Przedmiot 123%]') then boardPreview=true end end
assert(boardPreview,'home board preview must display the item label rather than its token')
ns.receivePlanner('E1|123|1|2026-12-09 20:00 PL|Barrow Deeps','Damian-Realm')
local plans=TheSentencedDB.planners[lkey]; assert(plans.items['Damian-Realm|123'])
ns.receivePlanner('R1|Damian-Realm|123|HEAL','Test-Realm')
assert(plans.items['Damian-Realm|123'].signups['Test-Realm']=='HEAL')
tab('WYDARZENIA')
activeButton('+ NOWE WYDARZENIE').scripts.OnClick()
local eventCompose;for _,f in ipairs(all) do if f.name=='TheSentencedEventCompose' then eventCompose=f end end
assert(eventCompose and eventCompose.shown and eventCompose.strata=='FULLSCREEN_DIALOG','new event opens dialog')
activeButton('○  Dungeon').scripts.OnClick()
local instancePicker; for _,f in ipairs(all) do if f.name=='TheSentencedInstancePicker' then instancePicker=f end end
assert(instancePicker and instancePicker.shown and #instancePicker.choices==24,'Dungeon opens list with explicit Forever source and beta status')
assert(instancePicker.choices[4].shown and not instancePicker.choices[10].shown,'new instance group starts visible')
instancePicker.otherTab.scripts.OnClick(); assert(not instancePicker.choices[4].shown and instancePicker.choices[10].shown,'other group is explicitly selectable')
instancePicker.newTab.scripts.OnClick()
instancePicker.choices[4].scripts.OnClick()
assert(eventCompose.title:GetText()=='City of Dalaran' and not instancePicker.shown,'choosing an instance sets the event title')
activeButton('WYBIERZ INSTANCJĘ').scripts.OnClick(); instancePicker.custom.scripts.OnClick()
assert(eventCompose.instanceSelected and eventCompose.title:GetText()=='','unlisted instances use explicit custom choice')
eventCompose.title:SetText(''); activeButton('○  '..ns.Raids[1].name).scripts.OnClick()
local eventWhen=editByHint('RRRR-MM-DD'); eventWhen:SetText('2028-02-29')
local eventClock=editByHint('GG:MM'); eventClock:SetText('20:00')
activeButton('KALENDARZ').scripts.OnClick()
assert(eventCompose.calendar.shown and eventCompose.calendar.header.text=='2028-02','calendar opens in selected month')
assert(eventCompose.calendar.clock:GetText()=='20:00' and eventCompose.calendar.selectedLabel.text:find('2028%-02%-29'),'calendar reads existing form date and time')
local leapDay; for _,b in ipairs(eventCompose.calendar.days) do if b.day==29 then leapDay=b end end
assert(leapDay,'leap year includes 29 February')
leapDay.scripts.OnClick(leapDay)
eventCompose.calendar.clock:SetText('25:00'); eventCompose.calendar.apply.scripts.OnClick()
assert(eventCompose.calendar.shown and eventCompose.calendar.error.text:find('godzinę') and eventClock:GetText()=='20:00','invalid popup time keeps the form unchanged')
eventCompose.calendar.clock:SetText('19:30'); eventCompose.calendar.apply.scripts.OnClick()
assert(eventWhen:GetText()=='2028-02-29' and eventClock:GetText()=='19:30' and not eventCompose.calendar.shown,'calendar confirmation fills date and time together')
eventClock:SetText('20:00'); activeButton('KALENDARZ').scripts.OnClick()
assert(eventCompose.calendar.clock:GetText()=='20:00','calendar reflects a later time edit in the form')
eventCompose.calendar.next.scripts.OnClick()
local marchDay; for _,b in ipairs(eventCompose.calendar.days) do if b.day==1 then marchDay=b end end
marchDay.scripts.OnClick(marchDay); eventCompose.calendar.clock:SetText('21:15'); activeButton('ANULUJ').scripts.OnClick()
assert(eventWhen:GetText()=='2028-02-29' and eventClock:GetText()=='20:00','cancelling the calendar keeps the original date and time')
activeButton('KALENDARZ').scripts.OnClick(); eventCompose.calendar.next.scripts.OnClick()
for _,b in ipairs(eventCompose.calendar.days) do if b.day==1 then marchDay=b end end
marchDay.scripts.OnClick(marchDay); eventCompose.calendar.clock:SetText('21:15'); eventCompose.calendar.apply.scripts.OnClick()
assert(eventWhen:GetText()=='2028-03-01' and eventClock:GetText()=='21:15','selected month and time are applied to the same event')
eventWhen:SetText('2028-02-29'); eventClock:SetText('20:00')
eventWhen:SetText('2027-02-29'); activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick()
assert(eventCompose.shown and eventCompose.error.text:find('poprawną datę'),'reject invalid date without discarding draft')
eventWhen:SetText('2028-02-29'); eventClock:SetText('25:00'); activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick()
assert(eventCompose.shown and eventCompose.error.text:find('godzinę'),'reject invalid time')
eventClock:SetText('20:00')
activeButton('○  Farmienie').scripts.OnClick()
assert(eventWhen:GetText()=='2028-02-29' and activeButton('✓  Farmienie'),'event type selection must preserve form')
local eventTitle=editByHint('Tytuł wydarzenia (opcjonalny)'); eventTitle:SetText('Szkic wyprawy')
editByHint('Nazwa, np. Raid / Dungeon'):SetText('Moja notatka')
local previousTimer=C_Timer; local previousFocus=GetCurrentKeyBoardFocus; local focus=eventWhen; local queued
C_Timer={After=function(_,callback) queued=callback end}; GetCurrentKeyBoardFocus=function() return focus end
ns.receivePlanner('R1|Damian-Realm|123|HEAL','Test-Realm')
assert(queued and visible(eventWhen) and eventWhen:GetText()=='2028-02-29','redraw waits while editing')
focus=nil; local callback=queued; queued=nil; callback()
local whenPreserved,titlePreserved=false,false
for _,f in ipairs(all) do if f.frameType=='EditBox' and visible(f) then
 if f:GetText()=='2028-02-29' then whenPreserved=true end
 if f:GetText()=='Szkic wyprawy' then titlePreserved=true end
end end
local privatePreserved=false; for _,f in ipairs(all) do if f.frameType=='EditBox' and visible(f) and f:GetText()=='Moja notatka' then privatePreserved=true end end
assert(privatePreserved,'deferred refresh preserves private note draft')
assert(whenPreserved and titlePreserved,'deferred redraw preserves both draft fields')
C_Timer=previousTimer; GetCurrentKeyBoardFocus=previousFocus
eventCompose:Hide(); activeButton('+ NOWE WYDARZENIE').scripts.OnClick()
assert(eventCompose.shown and eventCompose.when:GetText()=='2028-02-29' and eventCompose.clock:GetText()=='20:00' and not rawget(eventCompose,'zone') and eventCompose.title:GetText()=='Szkic wyprawy','closing and reopening keeps event draft')
local prevChat=C_ChatInfo; C_ChatInfo={SendAddonMessageLogged=function() return 11 end}
activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick()
assert(eventCompose.shown and eventCompose.when:GetText()=='2028-02-29','failed send must retain draft and dialog')
C_ChatInfo=prevChat; eventCompose:Hide()
activeButton('SZCZEGÓŁY').scripts.OnClick()
local eventWindow; for _,f in ipairs(all) do if f.name=='TheSentencedEventDetail' then eventWindow=f end end
assert(eventWindow and eventWindow.shown and eventWindow.strata=='FULLSCREEN_DIALOG' and eventWindow.rows[1].text:find('Test%-Realm'),'event details show signups')
ns.receivePlanner('D1|123|Spotkanie przy {item:123}','Damian-Realm')
assert(eventWindow.description.text:find('Spotkanie przy',1,true) and eventWindow.itemButtons[1].data=='item:123','detail displays description and item')
local tooltipData; local previousTooltip=ns.BoardItems.tooltip
ns.BoardItems.tooltip=function(_,data) tooltipData=data end
eventWindow.itemButtons[1].scripts.OnClick(eventWindow.itemButtons[1]); ns.BoardItems.tooltip=previousTooltip
assert(tooltipData=='item:123','item button opens tooltip')
eventWindow:Hide()
ns.receivePlanner('R1|Damian-Realm|123|DPS','Intruder-Realm')
assert(not plans.items['Damian-Realm|123'].signups['Intruder-Realm'])
ns.receiveFinds('M1|100|12|5000|2500|1','Test-Realm')
ns.receiveFinds('G1|101|12345','Test-Realm')
ns.receiveFinds('M2|103|12|5010|2510|5|Quest item','Test-Realm')
local finds=TheSentencedDB.finds[lkey]; assert(finds.items['Test-Realm|100'].x==5000 and finds.items['Test-Realm|101'].item==12345 and finds.items['Test-Realm|103'].label=='Quest item')
ns.receiveFinds('M1|102|12|12000|2500|1','Test-Realm'); assert(not finds.items['Test-Realm|102'])
local archive=TheSentencedDB.archives[lkey]
assert(archive and #archive.records==7,'direct valid board, event, signup and finds must be archived')
tab('WYDARZENIA'); activeButton('SZCZEGÓŁY').scripts.OnClick()
local oldChat=C_ChatInfo; local emitted={}
C_ChatInfo={SendAddonMessageLogged=function(prefix,msg,channel) msg=ns.Wire.receive('mock','prefix','sender',msg); emitted[#emitted+1]={prefix=prefix,msg=msg,channel=channel}; return 0 end}
TheSentencedDB.plannerRevision=100
eventWindow.roles[1].scripts.OnClick(eventWindow.roles[1])
eventWindow.roles[3].scripts.OnClick(eventWindow.roles[3])
assert(emitted[1].prefix=='TSGuildEvent' and emitted[1].channel=='GUILD' and emitted[1].msg=='R2|Damian-Realm|123|101|TANK','first UI signup uses persisted revision')
assert(emitted[2].msg=='R2|Damian-Realm|123|102|DPS' and TheSentencedDB.plannerRevision==102,'second UI signup advances stored revision')
assert(plans.items['Damian-Realm|123'].signupRevisions['Damian-Realm']==102,'local revision is recorded')
eventWindow:Hide(); activeButton('+ NOWE WYDARZENIE').scripts.OnClick()
activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick()
assert(not eventCompose.shown and eventCompose.when:GetText()=='' and eventCompose.title:GetText()=='','accepted submission closes and clears the draft')
assert(emitted[3] and emitted[3].prefix=='TSGuildEvent' and emitted[3].msg:match('^E1|%d+|7|2028%-02%-29 20:00 PL|Szkic wyprawy$'),'dialog publishes selected type and explicit date, time and zone')
-- Live J1 is generated only when this player joins someone else's event.
ns.receivePlanner('E1|777|4|Sobota|Wspolne','Test-Realm')
eventWindow.eventKey='Test-Realm|777'
local base=#emitted
eventWindow.roles[1].scripts.OnClick(eventWindow.roles[1])
assert(emitted[base+1].msg=='R2|Test-Realm|777|103|TANK' and emitted[base+2].msg=='J1|Test-Realm|777|103|TANK','new participant sends one transient notice after R2')
eventWindow.roles[3].scripts.OnClick(eventWindow.roles[3])
assert(#emitted==base+3 and emitted[base+3].msg=='R2|Test-Realm|777|104|DPS','role changes do not send a join notice')
eventWindow.roles[4].scripts.OnClick(eventWindow.roles[4])
eventWindow.roles[2].scripts.OnClick(eventWindow.roles[2])
assert(#emitted==base+6 and emitted[base+5].msg=='R2|Test-Realm|777|106|HEAL' and emitted[base+6].msg=='J1|Test-Realm|777|106|HEAL','returning from NIE sends exactly one new notice')
local testPlanner=plans.items['Test-Realm|777']
C_ChatInfo.SendAddonMessageLogged=function(prefix,msg,channel) msg=ns.Wire.receive('mock','prefix','sender',msg); emitted[#emitted+1]={prefix=prefix,msg=msg,channel=channel}; if msg:match('^J1|') then return 2 end; return 0 end
eventWindow.roles[4].scripts.OnClick(eventWindow.roles[4]); eventWindow.roles[1].scripts.OnClick(eventWindow.roles[1])
assert(testPlanner.signups['Damian-Realm']=='TANK' and testPlanner.signupRevisions['Damian-Realm']==108,'failed notice never reverses successful signup')
C_ChatInfo=oldChat
-- D1 can precede E1, but is always bound to the authenticated author's event.
ns.receivePlanner('D1|9001|Spotkanie {item:123}','Test-Realm')
ns.receivePlanner('E1|9001|4|2028-03-01 20:00 PL|Wyprawa','Damian-Realm')
assert(not plans.items['Damian-Realm|9001'].description,'other authors cannot attach a description')
ns.receivePlanner('E1|9001|4|2028-03-01 20:00 PL|Wyprawa','Test-Realm')
assert(plans.items['Test-Realm|9001'].description=='Spotkanie {item:123}','early description follows its authenticated author')
ns.receivePlanner('D1|9001|Podmieniony opis','Test-Realm')
assert(plans.items['Test-Realm|9001'].description=='Spotkanie {item:123}','unversioned descriptions cannot overwrite')
eventWindow:Hide(); activeButton('+ NOWE WYDARZENIE').scripts.OnClick()
eventCompose.when:SetText('2028-03-01'); eventCompose.clock:SetText('19:30'); eventCompose.title:SetText('Gildyjna')
eventCompose.description:SetText(string.rep('x',161))
local descriptionsSent={}; C_ChatInfo={SendAddonMessageLogged=function(prefix,msg)
 msg=ns.Wire.receive('mock','prefix','sender',msg); descriptionsSent[#descriptionsSent+1]=msg
 if msg:match('^D1|') then return 11 end
 return 0
end}
activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick()
assert(eventCompose.shown and #descriptionsSent==0 and eventCompose.description:GetText()==string.rep('x',161),'overlong description retains draft without sending E1')
eventCompose.description:SetText('Opis ')
local previousPick=ns.BoardItems.pick
ns.BoardItems.pick=function(_,callback) callback('item:123'); return true end
activeButton('+ PRZEDMIOT').scripts.OnClick()
ns.BoardItems.pick=previousPick
assert(eventCompose.description:GetText()=='Opis {item:123}','bag item is inserted into description')
eventCompose.description.scripts.OnTextChanged(eventCompose.description)
assert(eventCompose.descriptionPreview.text=='Podgląd: Opis [Przedmiot 123]','description preview displays item label')
local priorRetryTimer=C_Timer; local retryTimers={}
C_Timer={After=function(delay,fn) retryTimers[#retryTimers+1]={delay=delay,fn=fn} end}
local previousPrint=print; local notice=''; print=function(s) notice=notice..tostring(s) end
activeButton('OPUBLIKUJ WYDARZENIE').scripts.OnClick(); print=previousPrint
assert(not eventCompose.shown and #descriptionsSent==2 and descriptionsSent[2]:match('^D1|'),'description is sent separately after E1')
local newId=descriptionsSent[1]:match('^E1|(%d+)|')
assert(newId and plans.items['Damian-Realm|'..newId].description=='Opis {item:123}','rejected D1 remains locally available')
assert(notice:find('opis nie został wysłany',1,true) and notice:find('zaplanowano ponowienie',1,true),'partial send and scheduled retry are reported truthfully')
while #retryTimers>0 do local nextTimer=table.remove(retryTimers,1); nextTimer.fn() end
assert(#descriptionsSent==6 and descriptionsSent[5]:match('^D1|') and descriptionsSent[6]:match('^D1|'),'failed first description is retried twice after accepted event')
C_Timer=priorRetryTimer
-- Own snapshot emits creation before description and never re-emits another author.
local pending={}; local oldTimer=C_Timer; C_Timer={After=function(_,fn) pending[#pending+1]=fn end}
local snapshot={}; C_ChatInfo={SendAddonMessageLogged=function(_,msg) msg=ns.Wire.receive('mock','prefix','sender',msg); snapshot[#snapshot+1]=msg; return 0 end}
assert(ns.EventSync.receiveQuery('Test-Realm'))
while #pending>0 do local callback=table.remove(pending,1); callback() end
local eventIndex,descriptionIndex
for i,msg in ipairs(snapshot) do
 if msg:match('^E1|'..newId..'|') then eventIndex=i end
 if msg:match('^D1|'..newId..'|') then descriptionIndex=i end
 assert(not msg:match('^D1|9001|'),'another author description must not be replayed')
end
assert(eventIndex and descriptionIndex and eventIndex<descriptionIndex,'own description follows its event in snapshot')
C_Timer=oldTimer; C_ChatInfo=oldChat
tab('SIEĆ')
assert(activeButton('ODŚWIEŻ PODGLĄD'),'archive page must render stored records')
assert(#plans.items==0,'planner uses keyed items, not an array')
tab('GILDIA')
local playerRow
for _,f in ipairs(all) do
 local p=rawget(f,'parent'); local value=rawget(f,'text')
 if type(value)=='string' and value:find('Damian%-Realm') and p and p.frameType=='Button' and p.scripts and p.scripts.OnClick and visible(p) then playerRow=p; break end
end
assert(playerRow,'guild roster row must be clickable')
playerRow.scripts.OnClick(playerRow)
local popup; for _,f in ipairs(all) do if f.name=='TheSentencedProfileQuick' then popup=f end end
assert(popup and popup.shown and popup.strata=='FULLSCREEN_DIALOG' and popup.scripts.OnDragStart,'click should open a draggable profile popup')
assert(#popup.slots==19 and #popup.bags==12,'equipment and bag controls must be present')
assert(rawget(popup.slots[1],'itemId')==nil and not popup.bags[1].shown,'unshared data must not be invented')
assert(popup.panels.GEAR.shown and not popup.panels.BAGS.shown and not popup.detail.shown,'roster popup starts on equipment')
local getForTabs=ns.Profiles.get
ns.Profiles.get=function() return {P={professions={'Mining'},received=1796000000},S={values={20,21,22,23,24,500},received=1796000000}} end
popup.tabs.STATS.scripts.OnClick()
assert(popup.detail.shown and not popup.panels.GEAR.shown and popup.detailRows[1].label.text=='Siła' and popup.detailRows[1].value.text=='20')
popup.tabs.PROFS.scripts.OnClick()
assert(popup.detailRows[1].label.text=='Mining','professions have their own tab')
date=os.date
ns.receiveFinds('G1|17960000000007|134','Damian-Realm')
popup.tabs.LOOT.scripts.OnClick()
assert(popup.detailRows[1].item==134 and popup.detailRows[1].value.text~='Data nieznana','reported loot carries a timestamp and an item tooltip')
TheSentencedDB.lootJournal={{item=135,count=2,time=1796000100,quality=2}}
ns.LootJournal.onChanged()
assert(popup.detailRows[1].item==135 and popup.detailRows[1].label.text:find('×2',1,true),'an open timeline refreshes as personal loot arrives')
assert(popup.detailRows[1].value.text:find('Prywatny',1,true),'local pickups retain private origin')
popup.tabs.BAGS.scripts.OnClick(); assert(popup.panels.BAGS.shown and not popup.detail.shown,'bag tab hides detail rows')
popup.tabs.GEAR.scripts.OnClick()
ns.Profiles.get=getForTabs
local originalGet=ns.Profiles.get
local bagItems={}; for i=1,13 do bagItems[i]={id=1000+i,count=i} end
ns.Profiles.get=function() return {E={items={{slot=1,id=123}}}, B={items=bagItems}} end
playerRow.scripts.OnClick(playerRow)
assert(popup.slots[1].itemId==123 and rawget(popup.slots[2],'itemId')==nil,'equipment must use shared slot IDs')
assert(popup.bags[1].itemId==1001 and popup.bagPages==2,'bag contents must use shared totals')
popup.next.scripts.OnClick(popup.next)
assert(popup.bags[1].itemId==1013 and not popup.bags[2].shown,'bag paging must expose remaining items')
popup.bagSearch:SetText('1009');popup.bagSearch.scripts.OnTextChanged()
assert(popup.bags[1].itemId==1009 and popup.bagPages==1 and not popup.bags[2].shown,'bag search filters item IDs')
popup.bagSearch:SetText(''); popup.bagSearch.scripts.OnTextChanged()

ns.Profiles.get=originalGet; playerRow.scripts.OnClick(playerRow)
assert(rawget(popup.slots[1],'itemId')==nil and not popup.bags[1].shown,'old shared data must be cleared when unavailable')
all[1].scripts.OnEvent(all[1],'PLAYER_TARGET_CHANGED')
assert(not popup.shown,'changing target must close the old character preview')
playerRow.scripts.OnClick(playerRow)
ns.Profiles.receive('P1|E|100|1|1|1:123','Damian-Realm')
assert(popup.shown and popup.slots[1].itemId==123,'received profile refreshes the open popup')
ns.Profiles.receive('P0|E|99999999999999','Damian-Realm')
assert(not popup.shown,'profile revocation must close stale preview')
ns.receivePlanner('E1|92222|4|2028-03-01 20:00 PL|Odwołanie','Test-Realm')
ns.receivePlanner('X1|Test-Realm|92222','Intruder-Realm')
assert(plans.items['Test-Realm|92222'],'non-member cancellation must be ignored')
ns.receivePlanner('X1|Test-Realm|92222','Damian-Realm')
assert(not plans.items['Test-Realm|92222'],'guild master can cancel another author')
ns.receivePlanner('E1|92222|4|2028-03-01 20:00 PL|Próba replay','Test-Realm')
assert(not plans.items['Test-Realm|92222'],'catch-up must not resurrect cancelled events')
ns.receivePlanner('X1|Test-Realm|93333','Test-Realm')
ns.receivePlanner('E1|93333|4|2028-03-01 20:00 PL|Po odwołaniu','Test-Realm')
assert(not plans.items['Test-Realm|93333'],'author can cancel and replays arriving out of order must remain cancelled')
ns.receivePlanner('E1|94444|4|2028-03-01 20:00 PL|Uczestnik','Damian-Realm')
ns.receivePlanner('X1|Damian-Realm|94444','Test-Realm')
assert(plans.items['Damian-Realm|94444'],'an officer without the guild master rank cannot cancel a different author')
ns.receiveBoard('B1|6020|GRUPA|Wpis do usunięcia','Test-Realm')
ns.receiveBoard('B3|Test-Realm|6020','Intruder-Realm')
assert(board.items[1].id=='6020','non-member cannot delete post')
ns.receiveBoard('B3|Test-Realm|6020','Damian-Realm')
assert(board.items[1].id~='6020','GM can delete any guild post')
ns.receiveBoard('B1|6020|GRUPA|Wpis po replay','Test-Realm')
assert(board.items[1].id~='6020','replay cannot recreate a deleted post')
ns.receiveBoard('B1|6021|GRUPA|Własny wpis','Test-Realm')
ns.receiveBoard('B3|Test-Realm|6021','Test-Realm')
assert(board.items[1].id~='6021','author can delete own post')
ns.receiveBoard('B1|6022|GRUPA|Cudzy wpis','Damian-Realm')
ns.receiveBoard('B3|Damian-Realm|6022','Test-Realm')
assert(board.items[1].id=='6022','officer cannot delete another author post')
ns.receiveBoard('B3|Damian-Realm|6022','Damian-Realm')
print('PROFILE_UI_OK: clickable member, full profile and floating window')
function UnitFullName() return 'Ala','Kowalska' end
function GetNumGuildMembers() return 1,1 end
function GetGuildRosterInfo(i)
 if i==1 then return 'Ala Kowalska','Member',1,40,'Mage','Orgrimmar','','',true,0,'MAGE' end
end
C_ChatInfo={SendAddonMessageLogged=function() return 0 end}
tab('TABLICA')
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick()
editByHint('Dodatkowy opis — nagłówek powstaje automatycznie'):SetText('Test dwuczlonowego imienia')
activeButton('○  SPRZEDAM').scripts.OnClick()
assert(activeButton('✓  SPRZEDAM') and editByHint('Treść ogłoszenia...'):GetText()=='Test dwuczlonowego imienia','category selection must preserve draft')
local boardCompose; for _,f in ipairs(all) do if f.name=='TheSentencedBoardCompose' then boardCompose=f end end
boardCompose.input:SetText('Miecz'); activeButton('WSTAW SZABLON').scripts.OnClick()
assert(boardCompose.input:GetText()=='Sprzedam: — Miecz','sale template preserves the authored description')
boardCompose.categories[3].scripts.OnClick(); activeButton('WSTAW SZABLON').scripts.OnClick()
assert(boardCompose.input:GetText()=='Kupię: — Miecz','switching templates replaces only the generated prefix')
boardCompose.categories[2].scripts.OnClick(); activeButton('WSTAW SZABLON').scripts.OnClick()
boardCompose.input:SetText('Sprzedam:owe'); boardCompose.categories[3].scripts.OnClick()
local savedPrint=print; local templateWarning=''; print=function(s) templateWarning=templateWarning..tostring(s) end
activeButton('WSTAW SZABLON').scripts.OnClick(); print=savedPrint
assert(boardCompose.input:GetText()=='Sprzedam:owe' and templateWarning:find('Tekst zachowano',1,true),'a prefix extended without the exact separator is never removed')
boardCompose.categories[2].scripts.OnClick()
boardCompose.input:SetText('Zmodyfikowany nagłówek — Miecz'); boardCompose.categories[3].scripts.OnClick(); activeButton('WSTAW SZABLON').scripts.OnClick()
assert(boardCompose.input:GetText()=='Zmodyfikowany nagłówek — Miecz','edited prefix must not be guessed or overwritten')
boardCompose.input:SetText('Test dwuczlonowego imienia'); boardCompose.templatePrefix=''; boardCompose.templateType=0; boardCompose.categories[2].scripts.OnClick()
activeButton('OPUBLIKUJ').scripts.OnClick()
assert(TheSentencedDB.boards[lkey].items[1].sender=='Ala Kowalska','full two-part player name should resolve')
activeButton('OTWÓRZ').scripts.OnClick()
local detail; for _,f in ipairs(all) do if f.name=='TheSentencedBoardDetail' then detail=f end end
assert(detail and detail.shown and detail.strata=='DIALOG','board detail opens in the addon dialog layer'); detail:Hide()
-- Group announcements: reuse the event instance picker and preserve drafts.
local sentGroup={}; local priorBoardSender=C_ChatInfo.SendAddonMessageLogged
C_ChatInfo.SendAddonMessageLogged=function(prefix,msg,channel) msg=ns.Wire.receive('mock','prefix','sender',msg); sentGroup[#sentGroup+1]={prefix=prefix,msg=msg,channel=channel}; return 0 end
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick()
boardCompose.categories[1].scripts.OnClick(); assert(boardCompose.groupPanel.shown,'group category exposes choices')
assert(not boardCompose.template.shown and boardCompose.input.hint.text=='Dodatkowy opis — nagłówek powstaje automatycznie','group uses live preview and clear input hint without a redundant button')
boardCompose.input:SetText('Zbiórka przy wejściu.')
boardCompose.groupInstanceButton.scripts.OnClick(); assert(instancePicker.shown,'instance picker opens for group')
ns.InstancePicker.close(); assert(boardCompose.input:GetText()=='Zbiórka przy wejściu.' and boardCompose.groupInstance=='','cancelling choice preserves draft')
boardCompose.groupInstanceButton.scripts.OnClick(); instancePicker.choices[4].scripts.OnClick()
assert(boardCompose.groupInstance=='City of Dalaran','selected instance is stored in group form')
boardCompose.groupRoleButtons.HEAL.scripts.OnClick(); boardCompose.groupRoleButtons.DPS.scripts.OnClick(); boardCompose.groupClock:SetText('20:45'); boardCompose.groupClock.scripts.OnTextChanged(boardCompose.groupClock)
local firstDraft=boardCompose.input:GetText(); local firstPreview=boardCompose.groupPreview.text
assert(firstDraft=='Zbiórka przy wejściu.' and firstPreview:find('City of Dalaran',1,true) and firstPreview:find('20:45',1,true) and firstPreview:find('HEAL, DPS',1,true),'template previews the selected values without rewriting the description')
boardCompose.groupClock.scripts.OnTextChanged(boardCompose.groupClock); assert(boardCompose.input:GetText()==firstDraft and boardCompose.groupPreview.text==firstPreview,'repeated preview refresh must not change the draft')
boardCompose.groupRoleButtons.HEAL.scripts.OnClick(); boardCompose.groupInstanceButton.scripts.OnClick(); instancePicker.choices[1].scripts.OnClick()
local replaced=boardCompose.input:GetText(); local previewText=boardCompose.groupPreview.text
assert(replaced==firstDraft and previewText:find('Hall of Thanes',1,true) and not previewText:find('City of Dalaran',1,true) and previewText:find('potrzebne: DPS',1,true),'changing selection updates only the preview')
boardCompose.categories[2].scripts.OnClick(); boardCompose.categories[1].scripts.OnClick()
assert(boardCompose.input:GetText()==replaced and boardCompose.groupRoles.DPS,'switching categories preserves draft and choices')
boardCompose:Hide(); activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick()
assert(boardCompose.input:GetText()==replaced and boardCompose.groupClock:GetText()=='20:45','closing and reopening preserves group draft')
local countBeforeGroup=#TheSentencedDB.boards[lkey].items
local conflicting='Szukam grupy: inne miejsce — własny tekst'; boardCompose.input:SetText(conflicting); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(boardCompose.shown and #sentGroup==0 and boardCompose.input:GetText()==conflicting and boardCompose.groupPreview.text:find('dodatkowy opis'),'pasted contradictory header is not duplicated or silently discarded')
local edited='Spokojna wyprawa — Zbiórka przy wejściu.'; boardCompose.input:SetText(edited)
boardCompose.groupRoleButtons.HEAL.scripts.OnClick()
assert(boardCompose.input:GetText()==edited and boardCompose.groupPreview.text:find('HEAL, DPS',1,true),'changing roles never replaces user description')
boardCompose.groupRoleButtons.HEAL.scripts.OnClick()
boardCompose.groupClock:SetText('25:45'); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(boardCompose.shown and #sentGroup==0 and #TheSentencedDB.boards[lkey].items==countBeforeGroup and boardCompose.input:GetText()==edited,'invalid time prevents publish and preserves text')
boardCompose.groupClock:SetText('20:45'); activeButton('OPUBLIKUJ').scripts.OnClick()
local groupText=TheSentencedDB.boards[lkey].items[1].text
assert(#sentGroup==1 and sentGroup[1].prefix=='TSGuildHall' and groupText:find('Spokojna wyprawa',1,true) and groupText:find('Hall of Thanes',1,true) and groupText:find('20:45',1,true) and groupText:find('potrzebne: DPS',1,true) and groupText:find('Zbiórka przy wejściu.',1,true),'publish uses the selected instance, time, role and unchanged description')
assert(not groupText:find('Szukam grupy:.*Szukam grupy:'),'publish must not duplicate generated prefix')
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick(); boardCompose.categories[1].scripts.OnClick()
boardCompose.groupInstanceButton.scripts.OnClick(); instancePicker.choices[1].scripts.OnClick(); boardCompose.input:SetText(string.rep('ą',90))
local longDraft=boardCompose.input:GetText(); countBeforeGroup=#TheSentencedDB.boards[lkey].items
activeButton('OPUBLIKUJ').scripts.OnClick()
assert(boardCompose.shown and boardCompose.input:GetText()==longDraft and #sentGroup==1 and #TheSentencedDB.boards[lkey].items==countBeforeGroup,'overlong UTF-8 packet is not sent and draft remains')
-- Switching category before publishing must not send an old automatic header.
local attempted={}; C_ChatInfo.SendAddonMessageLogged=function(prefix,msg) msg=ns.Wire.receive('mock','prefix','sender',msg); attempted[#attempted+1]=msg; return 11 end
boardCompose.categories[2].scripts.OnClick(); boardCompose.input:SetText('Miecz'); activeButton('WSTAW SZABLON').scripts.OnClick()
local saleDraft=boardCompose.input:GetText(); assert(saleDraft=='Sprzedam: — Miecz')
boardCompose.categories[3].scripts.OnClick(); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#attempted==1 and attempted[1]:match('|KUPIĘ|Miecz$') and boardCompose.input:GetText()==saleDraft,'direct publish after category change drops only old automatic prefix and preserves draft on failure')
boardCompose.categories[1].scripts.OnClick(); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#attempted==2 and attempted[2]:find('|GRUPA|Szukam grupy: Hall of Thanes',1,true) and not attempted[2]:find('Sprzedam:',1,true) and attempted[2]:find('Miecz',1,true),'group publish does not retain a stale sale prefix')
boardCompose.input:SetText('Sprzedam:owe'); local publicationWarning=''; savedPrint=print; print=function(s) publicationWarning=publicationWarning..tostring(s) end
activeButton('OPUBLIKUJ').scripts.OnClick(); print=savedPrint
assert(#attempted==2 and boardCompose.input:GetText()=='Sprzedam:owe' and publicationWarning:find('Tekst zachowano',1,true),'direct publish never strips an extended prefix without the exact separator')
boardCompose.input:SetText('Sprzedaję: — Miecz'); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#attempted==2 and boardCompose.input:GetText()=='Sprzedaję: — Miecz','editing an automatic prefix blocks guessing and retains the draft')
-- Accepted board writes are retried with the identical ID and bounded timers.
local savedRetryClock=C_Timer; local retryBoardTimers={}; C_Timer={After=function(delay,fn) retryBoardTimers[#retryBoardTimers+1]={delay=delay,fn=fn} end}
local retrySent={}; C_ChatInfo.SendAddonMessageLogged=function(_,msg) retrySent[#retrySent+1]=ns.Wire.receive('mock','prefix','sender',msg); return 0 end
boardCompose.templatePrefix=''; boardCompose.templateType=0; boardCompose.input:SetText('Test ponawiania'); boardCompose.categories[3].scripts.OnClick(); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#retrySent==1 and #retryBoardTimers==1,'first accepted message schedules retry')
local firstRetry=table.remove(retryBoardTimers,1); firstRetry.fn()
assert(#retrySent==2 and retrySent[2]==retrySent[1] and #retryBoardTimers==1,'first retry preserves the message identity')
local secondRetry=table.remove(retryBoardTimers,1); secondRetry.fn()
assert(#retrySent==3 and retrySent[3]==retrySent[1] and #retryBoardTimers==0,'retry ends after two retransmissions')
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick(); boardCompose.templatePrefix=''; boardCompose.templateType=0
boardCompose.input:SetText('Rownolegly A'); activeButton('OPUBLIKUJ').scripts.OnClick()
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick(); boardCompose.templatePrefix=''; boardCompose.templateType=0
boardCompose.input:SetText('Rownolegly B'); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#retryBoardTimers==2 and retryBoardTimers[1].delay==3 and retryBoardTimers[2].delay==3,'each message gets its own timely retry')
while #retryBoardTimers>0 do table.remove(retryBoardTimers,1).fn() end
retrySent={}
activeButton('+ NOWE OGŁOSZENIE').scripts.OnClick(); boardCompose.templatePrefix=''; boardCompose.templateType=0
boardCompose.input:SetText('Granica gildii'); activeButton('OPUBLIKUJ').scripts.OnClick()
assert(#retrySent==1 and #retryBoardTimers==1,'second accepted message schedules retry')
local originalGuildInfo=GetGuildInfo; GetGuildInfo=function() return 'Inna gildia' end
local fenced=table.remove(retryBoardTimers,1); fenced.fn(); GetGuildInfo=originalGuildInfo
assert(#retrySent==1 and #retryBoardTimers==0,'queued board message must not cross guild boundary')
C_Timer=savedRetryClock
boardCompose:Hide(); C_ChatInfo.SendAddonMessageLogged=priorBoardSender
local beforeImpostor=#TheSentencedDB.boards[lkey].items
ns.receiveBoard('B1|999|GRUPA|test','Ala Kowalska-Impostor')
assert(#TheSentencedDB.boards[lkey].items==beforeImpostor,'unknown sender suffix must not grant membership')
assert(ns.recordAutomaticFind(12,2500,7500,1),'gather should save locally')
assert(not ns.recordAutomaticFind(12,2505,7504,1),'nearby duplicate should be suppressed')
assert(#TheSentencedDB.autoNodes==1 and #ns.getMapPins()>=1,'local gather must appear in map rows')
tab('MAPA'); local mapLabel=editByHint('Podpis miejsca (opcjonalny)'); mapLabel:SetText('Żelazo')
activeButton('○  SKARB').scripts.OnClick(); assert(activeButton('✓  SKARB') and mapLabel:GetText()=='Żelazo','map type selection must preserve form')
local beforePins=#ns.getMapPins(); local pin=ns.getMapPins()[1]; assert(ns.hideMapPin(pin) and #ns.getMapPins()<beforePins,'hide pin locally'); assert(ns.restoreHiddenMapPins() and #ns.getMapPins()==beforePins,'restore hidden pins')
local savedGuildInfo=GetGuildInfo
local savedRealm=GetNormalizedRealmName
local savedTime=GetServerTime
assert(not navigationButton('KADRA').shown,'staff page is hidden from ordinary members')
GetGuildInfo=function() return 'The Sentenced','Officer',1 end
GetNormalizedRealmName=function() return 'Realm' end
GetServerTime=function() return 1795000000 end
tab('START')
tab('KADRA')
activeButton('NAPISZ NA DISCORDZIE').scripts.OnClick()
activeButton('#ogólny  ▸').scripts.OnClick()
assert(activeButton('#kalendarz  ▸'),'staff can choose another allowed channel')
activeButton('SPRAWDŹ PRZED WYSŁANIEM').scripts.OnClick()
assert(ns.TransferSync.code(true)=='','invalid draft must not generate a request')
local staffInput=editByHint('Wpisz wiadomość')
staffInput:SetText('Próba ąćę')
staffInput.scripts.OnTextChanged(staffInput)
activeButton('SPRAWDŹ PRZED WYSŁANIEM').scripts.OnClick()
assert(ns.TransferSync.code(true)=='','preview must not send or generate a request')
activeButton('PRZEKAŻ BOTOWI').scripts.OnClick()
assert(ns.TransferSync.code(true):find('|staff.post|calendar:',1,true),'confirmed request targets the selected channel')
GetGuildInfo=savedGuildInfo
GetNormalizedRealmName=savedRealm
GetServerTime=savedTime
tab('START')
assert(not navigationButton('KADRA').shown,'staff menu hides again after the role is removed')
print('STAFF_COMPOSE_UI_OK: role gate, destination, validation, preview and explicit confirmation')

print('FOREVER_NAME_OK: first and surname, unknown suffix rejected')
TheSentencedDB.setupDone=false; TheSentencedDB.setupStep=1
all[1].scripts.OnEvent(all[1],'PLAYER_ENTERING_WORLD')
local setupWindow; for _,f in ipairs(all) do if f.name=='TheSentencedSetup' then setupWindow=f end end
assert(setupWindow and setupWindow.shown and not main.shown,'first world entry must show separate setup before main UI')
activeButton('ENGLISH').scripts.OnClick()
assert(TheSentencedDB.lang=='en','language selection should persist')
activeButton('NEXT').scripts.OnClick()
local mapBefore=TheSentencedDB.mapPinsMini
activeButton('MINIMAP: '..(mapBefore and 'ON' or 'OFF')).scripts.OnClick()
assert(TheSentencedDB.mapPinsMini~=mapBefore,'setup should change map setting')
activeButton('MINIMAP: '..(mapBefore and 'OFF' or 'ON')).scripts.OnClick()
assert(TheSentencedDB.mapPinsMini==mapBefore,'setup must preserve explicit map preference')
activeButton('NEXT').scripts.OnClick()
local wasShared=ns.Profiles.enabled('E')
for _,label in ipairs({'EQUIPMENT','BAGS','GOLD','STATS','PROFESSIONS'}) do
  local suffix=(label=='EQUIPMENT' and ns.Profiles.enabled('E') or label=='BAGS' and ns.Profiles.enabled('B') or label=='GOLD' and ns.Profiles.enabled('G') or label=='STATS' and ns.Profiles.enabled('S') or label=='PROFESSIONS' and ns.Profiles.enabled('P')) and 'ON' or 'OFF'
  assert(activeButton(label..': '..suffix),'all privacy toggles must be visible')
end
activeButton('EQUIPMENT: '..(wasShared and 'ON' or 'OFF')).scripts.OnClick()
assert(ns.Profiles.enabled('E')~=wasShared,'setup privacy toggle')
activeButton('NEXT').scripts.OnClick()
activeButton('FINISH').scripts.OnClick()
assert(TheSentencedDB.setupDone and navigationButton('HOME').shown and main.shown and not setupWindow.shown,'wizard must finish on English home')
all[1].scripts.OnEvent(all[1],'PLAYER_ENTERING_WORLD')
assert(not setupWindow.shown,'setup must not reopen after completion')
print('SETUP_OK: language choice, four steps, stored selection, English navigation')
print('WORKFLOW_OK: award, duplicate protection, two-step loot, GM authorization, replay, gap, conflict, event signup, map bounds')

SlashCmdList.THESENTENCED('debug')
local diagnosticsWindow;for _,f in ipairs(all) do if f.name=='TheSentencedDiagnostics' then diagnosticsWindow=f end end
assert(diagnosticsWindow and diagnosticsWindow.shown and diagnosticsWindow.box:GetText():find('TS_DIAG_BEGIN',1,true),'diagnostics accessible without normal navigation')
assert(diagnosticsWindow.box:GetText():find('TS_DIAG_END',1,true),'complete report visible for copy')
print('DIAGNOSTICS_UI_OK: slash command opens copyable report')
