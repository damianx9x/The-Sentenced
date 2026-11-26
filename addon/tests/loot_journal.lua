local ns={};assert(loadfile('TheSentenced/LootJournal.lua'))('TheSentenced',ns)
local J=ns.LootJournal
local function link(id) return '|cffffffff|Hitem:'..id..':0:0|h[Łup]|h|r' end
local item=link(123)
LOOT_ITEM_SELF='You receive loot: %s.'
LOOT_ITEM_SELF_MULTIPLE='You receive loot: %sx%d.'
local id,count=J.parse('You receive loot: '..item..'x3.',LOOT_ITEM_SELF,LOOT_ITEM_SELF_MULTIPLE)
assert(id==123 and count==3)
id,count=J.parse('You receive loot: '..item..'.',LOOT_ITEM_SELF,LOOT_ITEM_SELF_MULTIPLE)
assert(id==123 and count==1)
id,count=J.parse('3 × '..item..'.',nil,'%2$d × %1$s.')
assert(id==123 and count==3,'positional placeholders can reorder count and item by locale')
assert(not J.parse('Someone receives loot: '..item..'.',LOOT_ITEM_SELF,LOOT_ITEM_SELF_MULTIPLE))
local frame={registered={}}
CreateFrame=function()return frame end
function frame:SetScript(_,fn) self.receive=fn end
function frame:RegisterEvent(name) self.registered[name]=true end
function frame:UnregisterEvent(name) self.registered[name]=nil end
local now=1796000000
GetServerTime=function() return now end
local calls,updated=0,0
local qualifiers={[123]=2,[124]=1,[125]=3,[126]=0}
C_Item={
  GetItemQualityByID=function(itemID) return qualifiers[itemID] end,
  RequestLoadItemDataByID=function() calls=calls+1 end,
}
J.onChanged=function() updated=updated+1 end
TheSentencedDB={}
J.configure()
assert(frame.registered.CHAT_MSG_LOOT and frame.registered.ITEM_DATA_LOAD_RESULT,'enabled by default')
local function receive(itemID,quantity,line)
  frame.receive(nil,'CHAT_MSG_LOOT','You receive loot: '..link(itemID)..'x'..quantity..'.',nil,nil,nil,nil,nil,nil,nil,nil,nil,line)
end
receive(124,1)
receive(126,1)
assert(#J.entries()==0 and updated==0,'white and grey items are excluded')
receive(123,3,565)
receive(123,3,565)
assert(#J.entries()==1 and updated==1 and J.entries()[1].count==3 and J.entries()[1].quality==2,'green loot appears immediately and duplicate line ID is ignored')
receive(127,1)
receive(127,2)
assert(calls==1 and #J.entries()==1,'uncached item requests data once without losing two separate pickups')
now=now+1; receive(125,1)
qualifiers[127]=4
frame.receive(nil,'ITEM_DATA_LOAD_RESULT',127,true)
assert(#J.entries()==4 and J.entries()[1].item==125 and J.entries()[2].time==now-1,'asynchronous pickups retain their original time')
J.setEnabled(false)
receive(123,1)
assert(not frame.registered.CHAT_MSG_LOOT and not frame.registered.ITEM_DATA_LOAD_RESULT and #J.entries()==4)
J.setEnabled(true)
for i=1,103 do receive(123,3) end
assert(#J.entries()==100 and J.entries()[1].count==3 and J.entries()[1].time==now)
TheSentencedDB.lootJournal={{item=124,time=now,count=1},{item=125,time=now,count=1}}
assert(#J.entries()==1 and J.entries()[1].quality==3,'legacy rows use native quality; white ones are hidden')
print('LOOT_JOURNAL_OK: own loot, quality, delayed loading, positional formats, duplicates and opt-out')
assert(J.toggleWish(123)==true and #J.wishlist()==1)
assert(J.toggleWish(123)==false and #J.wishlist()==0)
assert(J.toggleWish('123')==nil and J.toggleWish(12.5)==nil)
for i=1,30 do assert(J.toggleWish(i)) end
assert(J.toggleWish(31)==nil and #J.wishlist()==30)
