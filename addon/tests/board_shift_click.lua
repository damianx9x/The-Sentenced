local focus,hooks=nil,0
GetCurrentKeyBoardFocus=function() return focus end
local function field()
  return {text='',visible=true,IsVisible=function(self) return self.visible end,
    HasFocus=function(self) return focus==self end,Insert=function(self,s) self.text=self.text..s end}
end
local chat,our,other=field(),field(),field()
ChatFrameUtil={InsertLink=function(link) if focus==chat then chat:Insert(link); return true end return false end}
hooksecurefunc=function(target,name,post)
  hooks=hooks+1
  if type(target)=='string' then post=name; name=target; target=_G end
  local original=target[name]
  target[name]=function(...) local result=original(...); post(...); return result end
end
local ns={};assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',ns)
local B=ns.BoardItems
assert(B.registerEditBox(our));assert(B.registerEditBox(our));assert(hooks==1,'install a single post-hook')
local link='|cffa335ee|Hitem:18832:0:0|h[Przedmiot]|h|r'
focus=our;assert(ChatFrameUtil.InsertLink(link)==false);assert(our.text=='{item:18832:0:0}','one insertion')
ChatFrameUtil.InsertLink('|Hspell:123|h[Czar]|h');assert(our.text=='{item:18832:0:0}','non-item ignored')
our.visible=false;ChatFrameUtil.InsertLink(link);assert(our.text=='{item:18832:0:0}','hidden field ignored');our.visible=true
focus=other;ChatFrameUtil.InsertLink(link);assert(other.text=='' and our.text=='{item:18832:0:0}','unregistered field ignored')
focus=chat;assert(ChatFrameUtil.InsertLink(link));assert(chat.text==link and our.text=='{item:18832:0:0}','normal chat unchanged')
ChatFrameUtil=nil; ChatEdit_InsertLink=function(link) if focus==chat then chat:Insert(link); return true end return false end
local old={};assert(loadfile('TheSentenced/BoardItems.lua'))('TheSentenced',old)
assert(old.BoardItems.registerEditBox(our) and hooks==2,'legacy hook fallback')
focus=our;ChatEdit_InsertLink(link);assert(our.text=='{item:18832:0:0}{item:18832:0:0}','legacy one insertion')
print('BOARD_SHIFT_CLICK_OK: focused registered field only, single hook, chat and legacy')
