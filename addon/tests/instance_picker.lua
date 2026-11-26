unpack=table.unpack or unpack
tinsert=table.insert
local frames={}
local mt={}
mt.__index=function(_,name)
 if name=='SetScript' then return function(self,key,fn) self.scripts[key]=fn end end
 if name=='HookScript' then return function(self,key,fn) self.hooks[key]=self.hooks[key] or {}; table.insert(self.hooks[key],fn) end end
 if name=='CreateFontString' then return function(self) return CreateFrame('FontString',nil,self) end end
 if name=='SetPoint' then return function(self,...) self.point={...} end end
 if name=='SetText' then return function(self,s) self.text=s end end
 if name=='Show' then return function(self) self.shown=true end end
 if name=='Hide' then return function(self)
  self.shown=false
  if self.scripts.OnHide then self.scripts.OnHide(self) end
  for _,fn in ipairs(self.hooks.OnHide or {}) do fn(self) end
 end end
 if name=='SetShown' then return function(self,value) self.shown=value end end
 if name=='IsShown' then return function(self) return self.shown end end
 return function() end
end
function CreateFrame(kind,name,parent)
 local f=setmetatable({kind=kind,name=name,parent=parent,scripts={},hooks={},shown=true},mt)
 frames[#frames+1]=f; return f
end
UIParent={}; UISpecialFrames={}
local ns={}; assert(loadfile('TheSentenced/InstancePicker.lua'))('TheSentenced',ns)
local p=CreateFrame('Frame','parent',UIParent); local picked,custom
local focus={cleared=false,ClearFocus=function(self) self.cleared=true end}
function GetCurrentKeyBoardFocus() return focus end
assert(ns.InstancePicker.pick(p,function(name,isCustom) picked,custom=name,isCustom end))
assert(focus.cleared,'opening the picker releases the underlying edit box focus')
local picker; for _,f in ipairs(frames) do if f.name=='TheSentencedInstancePicker' then picker=f end end
assert(picker and picker.shown and #picker.choices==24,'all sourced choices and the picker must load')
assert(ns.InstancePicker.catalog[13].name=='Maraudon','Maraudon has Forever hotfix evidence')
assert(picker.choices[11].caption.text:find('starsza',1,true) and not picker.choices[11].caption.text:find('wcześniejsza',1,true),'long legacy names use compact visible status')
assert(picker.choices[1].shown and not picker.choices[10].shown,'new group starts visible')
picker.scripts.OnKeyDown(picker,'DOWN'); picker.scripts.OnKeyDown(picker,'RIGHT')
assert(picker.choices[4].caption.text:find('^>'),'keyboard selection has a visible non-colour marker')
picker.scripts.OnKeyDown(picker,'ENTER')
assert(picked=='City of Dalaran' and custom==false and not picker.shown,'arrows and Enter choose the expected dungeon')
picked=nil; assert(ns.InstancePicker.pick(p,function(name,c) picked,custom=name,c end))
picker.scripts.OnKeyDown(picker,'TAB'); picker.scripts.OnKeyDown(picker,'4'); picker.scripts.OnKeyDown(picker,'ENTER')
assert(picked=='Maraudon','keyboard changes group and selects numbered item')
picked=nil; custom=false; assert(ns.InstancePicker.pick(p,function(name,c) picked,custom=name,c end))
picker.scripts.OnKeyDown(picker,'I'); assert(picked==nil and custom==true and not picker.shown,'custom choice is accessible with keyboard')
custom=false; assert(ns.InstancePicker.pick(p,function() custom=true end))
picker.scripts.OnKeyDown(picker,'ESCAPE'); assert(not picker.shown and not custom,'escape cancels without selecting')
assert(ns.InstancePicker.pick(p,function() custom=true end)); p:Hide()
assert(not picker.shown and not custom,'closing the owning parent closes the picker')
local other=CreateFrame('Frame','other',UIParent)
assert(ns.InstancePicker.pick(p,function() end)); assert(ns.InstancePicker.pick(other,function() end)); p:Hide()
assert(picker.shown,'a former parent cannot close a picker used by another parent')
other:Hide(); assert(not picker.shown,'the current parent closes its picker')
function GetCurrentKeyBoardFocus() error('unavailable') end
assert(ns.InstancePicker.pick(p,function() end),'a failing focus API must not prevent opening')
ns.InstancePicker.close()
assert(ns.InstancePicker.pick(p,function() end,{customLabel='INNY CEL / MIEJSCE'}))
assert(picker.custom.caption.text=='INNY CEL / MIEJSCE','caller may specify a context-appropriate custom label')
ns.InstancePicker.close(); assert(ns.InstancePicker.pick(p,function() end,{customLabel='NIE|WOLNO'}))
assert(picker.custom.caption.text=='INNA INSTANCJA','invalid custom label falls back to safe default')
ns.InstancePicker.close()
assert(picker.choices[24].point[3]==-345 and picker.custom.point[3]==-390,'last row has space before custom option')
print('INSTANCE_PICKER_OK: source metadata, keyboard, layout and parent lifetime')
