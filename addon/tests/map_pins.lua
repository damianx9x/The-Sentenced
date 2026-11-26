local ns={pinOptions=function()return false,false end}
function CreateFrame() return {SetScript=function() end} end
assert(loadfile('TheSentenced/MapPins.lua'))('TheSentenced',ns)
local p=ns.ProjectMinimap
local x,y=p(.5,.5,.51,.5,1000,1000,100,nil)
assert(math.abs(x-.1)<1e-8 and math.abs(y)<1e-8)
x,y=p(.5,.5,.49,.5,1000,1000,100,math.pi/2)
assert(math.abs(x)<1e-8 and math.abs(y-.1)<1e-8)
assert(not p(.5,.5,.9,.5,1000,1000,100,nil))
assert(not p(.5,.5,.5,.5,1000,1000,0,nil))
print('PINS_OK: north-up, rotated map, out-of-range, invalid radius')

UIParent={GetEffectiveScale=function() return .8 end}
for _,zoom in ipairs({.08,.4,.8,2.4,8}) do
 local canvas={GetEffectiveScale=function() return zoom end}
 assert(math.abs(ns.WorldMapIconSize(canvas)*zoom-12)<1e-8,'world icon stays the same screen size')
end
