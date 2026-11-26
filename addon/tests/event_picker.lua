unpack=table.unpack or unpack
tinsert=table.insert
local frames={}; local mt={}
mt.__index=function(_,name)
 if name=='SetScript' then return function(self,key,fn) self.scripts[key]=fn end end
 if name=='HookScript' then return function(self,key,fn) self.hooks[key]=self.hooks[key] or {}; table.insert(self.hooks[key],fn) end end
 if name=='CreateFontString' then return function(self) return CreateFrame('FontString',nil,self) end end
 if name=='SetText' then return function(self,value) self.text=value; if self.scripts.OnTextChanged then self.scripts.OnTextChanged(self) end end end
 if name=='GetText' then return function(self) return self.text or '' end end
 if name=='SetFocus' then return function(self) self.focused=true end end
 if name=='ClearFocus' then return function(self) self.focused=false; self.cleared=true end end
 if name=='Show' then return function(self) self.shown=true end end
 if name=='Hide' then return function(self) self.shown=false; if self.scripts.OnHide then self.scripts.OnHide(self) end; for _,fn in ipairs(self.hooks.OnHide or {}) do fn(self) end end end
 if name=='SetShown' then return function(self,value) self.shown=value end end
 if name=='IsShown' then return function(self) return self.shown end end
 return function() end
end
function CreateFrame(kind,name,parent,template)
 if template=='InputBoxTemplate' and os.getenv('TS_TEST_NO_NATIVE')=='1' then error('template unavailable') end
 local f=setmetatable({kind=kind,name=name,parent=parent,template=template,scripts={},hooks={},shown=true},mt); frames[#frames+1]=f; return f
end
UIParent={}; UISpecialFrames={}
local secret={}; function issecretvalue(value) return value==secret end
local focus={ClearFocus=function(self) self.cleared=true end}; function GetCurrentKeyBoardFocus() return focus end
local ns={}; assert(loadfile('TheSentenced/EventPicker.lua'))('TheSentenced',ns)
local parent=CreateFrame('Frame','parent',UIParent); local pickedAuthor,pickedId
local events={}
for i=1,8 do events[i]={author='Autor-'..i,id=tostring(i),title='Wyprawa '..i,when='2028-03-01 20:00 PL'} end
events[9]={author='Autor-1',id='1',title='Duplicate',when='sobota'}
events[10]={author='Nie|wolno',id='10',title='Nie',when='dziś'}
events[11]={author='Autor-11',id='not-numeric',title='Nie',when='dziś'}
events[12]={author='Autor-12',id='12',title=secret,when='dziś'}
assert(ns.EventPicker.pick(parent,events,function(author,id) pickedAuthor,pickedId=author,id end))
local picker; for _,f in ipairs(frames) do if f.name=='TheSentencedEventPicker' then picker=f end end
assert(focus.cleared and picker and picker.shown and picker.search.focused,'opening moves keyboard focus to the search field')
assert(picker.search.template==(os.getenv('TS_TEST_NO_NATIVE')=='1' and 'BackdropTemplate' or 'InputBoxTemplate'),'picker uses native input or safe fallback')
assert(picker.page.text=='1 / 2' and picker.rows[1].caption.text:find('Wyprawa 1',1,true),'only real, valid and unique events are listed')
assert(picker.rows[1].detail.text:find('Autor%-1') and picker.rows[1].detail.text:find('20:00',1,true),'row shows author and time')
picker.next.scripts.OnClick(); assert(picker.page.text=='2 / 2' and picker.rows[1].caption.text:find('Wyprawa 7',1,true),'paging exposes later events')
picker.search:SetText('Wyprawa 8'); assert(picker.page.text=='1 / 1' and picker.rows[1].shown and not picker.rows[2].shown,'search filters names and resets page')
picker.search.scripts.OnEnterPressed(); assert(pickedAuthor=='Autor-8' and pickedId=='8' and not picker.shown,'selection returns original stable author and id')
pickedAuthor=nil; pickedId=nil; assert(ns.EventPicker.pick(parent,events,function(a,id) pickedAuthor,pickedId=a,id end))
picker.search.scripts.OnArrowPressed(picker.search,'DOWN'); picker.search.scripts.OnEnterPressed()
assert(pickedAuthor=='Autor-2' and pickedId=='2','arrow and Enter select without a mouse')
assert(ns.EventPicker.pick(parent,{},function() error('no real events') end))
assert(picker.empty.text=='Brak dostępnych wydarzeń w addonzie.' and not picker.rows[1].shown,'empty data never creates fake choices')
picker.search.scripts.OnEnterPressed(); assert(picker.shown,'Enter on empty data is harmless')
picker.search.scripts.OnEscapePressed(); assert(not picker.shown,'escape closes picker')
assert(ns.EventPicker.pick(parent,events,function() end)); picker.search:SetText('BRAK')
assert(picker.empty.text=='Brak wyników wyszukiwania.','no matches are distinct from no events')
parent:Hide(); assert(not picker.shown,'closing the owning form closes the picker')
local nextParent=CreateFrame('Frame','next',UIParent)
assert(ns.EventPicker.pick(parent,events,function() end)); assert(ns.EventPicker.pick(nextParent,events,function() end)); parent:Hide()
assert(picker.shown,'former parent cannot close another picker session'); nextParent:Hide(); assert(not picker.shown)
function GetCurrentKeyBoardFocus() error('unavailable') end
assert(ns.EventPicker.pick(parent,events,function() end),'unavailable focus API does not block picker')
ns.EventPicker.close()
print('EVENT_PICKER_OK: stable identities, filtering, keyboard, paging, empty and owner lifecycle')
