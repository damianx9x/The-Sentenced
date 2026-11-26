local ns={}
assert(loadfile('TheSentenced/Theme.lua'))('TheSentenced',ns)
local theme=ns.Theme
assert(theme.palette.red[1]==.47 and theme.palette.gold[1]==.84,'historical guild palette')
local calls={}
local text={SetFont=function(_,face,size) calls[#calls+1]={face,size};return not face:find('Cinzel',1,true) end}
assert(theme.font(text,20,'title') and #calls==2 and calls[2][1]==theme.bodyFont,'font fallback')
local methods={}
function methods:SetSize(w,h)self.width=w;self.height=h end
function methods:SetBackdrop()end
function methods:SetBackdropColor(...)self.color={...}end
function methods:SetBackdropBorderColor(...)self.border={...}end
function methods:EnableMouse(v)self.mouse=v end
function methods:SetPoint()end
function methods:SetFont()return true end
function methods:SetTextColor()end
function methods:SetText(v)self.value=v end
function methods:CreateFontString()return setmetatable({},{__index=methods})end
function methods:CreateTexture()return setmetatable({},{__index=methods})end
function methods:SetTexture(value)self.texture=value end
local count=0
CreateFrame=function()count=count+1;return setmetatable({},{__index=methods})end
local parent={};local crest=theme.crest(parent)
assert(crest and crest.width==52 and crest.mouse==false and crest.emblem.texture:find('GuildCrest.tga',1,true),'guild crest and mouse passthrough')
assert(theme.crest(parent)==crest and count==1,'crest is reused')
print('THEME_OK: historical palette, font fallback, non-interactive reusable crest')
