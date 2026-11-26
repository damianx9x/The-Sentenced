local made={}
local function widget()
  local w={scripts={},shown=true,text=''}
  function w:SetSize() end; function w:SetPoint() end; function w:SetFrameStrata() end; function w:SetFrameLevel() end
  function w:EnableMouse() end; function w:SetBackdrop() end; function w:SetBackdropColor() end; function w:SetBackdropBorderColor() end
  function w:SetAutoFocus() end; function w:SetMaxLetters() end; function w:SetFont() return true end
  function w:SetScript(k,v) self.scripts[k]=v end
  function w:SetText(v) self.text=v; if self.scripts.OnTextChanged then self.scripts.OnTextChanged(self) end end
  function w:GetText() return self.text end
  function w:SetEnabled(v) self.enabled=v end; function w:SetShown(v) self.shown=v end
  function w:Show() self.shown=true end; function w:Hide() self.shown=false end; function w:ClearFocus() self.cleared=true end; function w:SetFocus() self.focus=true end
  function w:CreateFontString() return widget() end
  function w:GetFontString() if not self.label then self.label=widget() end; return self.label end
  return w
end
CreateFrame=function(_,_,parent,template) if template=='InputBoxTemplate' and os.getenv('TS_TEST_NO_NATIVE')=='1' then error('template unavailable') end; local o=widget();o.parent=parent;o.template=template; made[#made+1]=o; return o end
UIParent={}
issecretvalue=function(v) return v=='SECRET' end
local ns={}; assert(loadfile('TheSentenced/MemberPicker.lua'))('TheSentenced',ns)
local owner={hooks={}}; function owner:HookScript(name,callback) self.hooks[name]=callback end
assert(not ns.MemberPicker.pick(owner,{},function() end),'empty roster is a non-mutating fallback')
assert(not ns.MemberPicker.pick(owner,{{name='SECRET'}},function() end),'secret names must not be shown')
local roster={}
for i=1,10 do roster[#roster+1]={name='Player '..i..'-Full Realm'} end
roster[#roster+1]={name='player 1-full realm'}; roster[#roster+1]={name='Bad|Name'}
local chosen,original
assert(ns.MemberPicker.pick(owner,roster,function(name,entry) chosen=name;original=entry end))
local popup=made[1]; assert(#popup.entries==10,'deduplicate full names and reject control markup'); assert(popup.search.focus,'keyboard search focused')
assert(popup.search.template==(os.getenv('TS_TEST_NO_NATIVE')=='1' and 'BackdropTemplate' or 'InputBoxTemplate'),'picker uses native input or safe fallback')
assert(popup.parent==UIParent,'popup must not be clipped inside a scroll frame')
assert(popup.rows[1].text=='Player 1-Full Realm' and popup.pages==2 and popup.page==1)
assert(popup.pageText.text:match('1 / 2') and popup.rows[8].shown)
made[12].scripts.OnClick(); assert(popup.page==2 and popup.rows[1].text=='Player 9-Full Realm' and not popup.rows[3].shown,'next page')
made[11].scripts.OnClick(); assert(popup.page==1,'previous page')
popup.search:SetText('10-full'); assert(popup.pages==1 and popup.rows[1].text=='Player 10-Full Realm','search')
popup.search.scripts.OnEnterPressed(); assert(chosen=='Player 10-Full Realm' and original.name==chosen and not popup.shown,'keyboard choice preserves exact full name')
local count=#made
assert(ns.MemberPicker.pick(owner,roster,function(name) chosen=name end)); assert(#made==count,'reopen reuses the popup')
popup.rows[2].scripts.OnClick(popup.rows[2]); assert(chosen=='Player 2-Full Realm','mouse choice')
assert(ns.MemberPicker.pick(owner,roster,function(name) chosen=name end)); popup.search:SetText('no match')
assert(not popup.rows[1].shown and popup.empty.shown,'empty filtered list is explicit')
popup.search.scripts.OnEscapePressed(); assert(not popup.shown and chosen=='Player 2-Full Realm','cancel does not choose')
assert(ns.MemberPicker.pick(owner,roster,function(name) chosen=name end)); owner.hooks.OnHide()
assert(not popup.shown and popup.callback==nil and chosen=='Player 2-Full Realm','closing form cancels selection')
print('MEMBER_PICKER_OK: exact name, search, paging, keyboard, empty and reuse')
