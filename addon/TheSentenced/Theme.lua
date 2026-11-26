-- Visual tokens adapted from The Sentenced 0.4.2 native UI; no gameplay state.
local addonName,NS=...
local T={}
NS.Theme=T
local root='Interface\\AddOns\\'..addonName..'\\Fonts\\'
T.bodyFont=root..'DejaVuSans.ttf'
T.titleFont=root..'Cinzel.ttf'
T.palette={
  bg={.125,.13,.12,1},
  raised={.18,.17,.14,1},
  edge={.38,.32,.23,1},
  gold={.84,.74,.59,1},
  text={.90,.86,.79,1},
  muted={.67,.63,.56,1},
  red={.47,.21,.18,1},
  green={.65,.75,.56,1},
}
-- Cinzel covers Polish letters, but not all UI symbols. Use it only for headings
-- that do not contain ✓/○/arrows; body and selectable controls use DejaVu.
function T.font(widget,size,role)
  if not widget or type(widget.SetFont)~='function' then return false end
  local face=role=='title' and T.titleFont or T.bodyFont
  local ok,result=pcall(widget.SetFont,widget,face,size or 13,'')
  if ok and result~=false then return true end
  if face~=T.bodyFont then
    ok,result=pcall(widget.SetFont,widget,T.bodyFont,size or 13,'')
    if ok and result~=false then return true end
  end
  -- Keep the widget's existing game font if neither file can be loaded.
  return false
end
-- The same guild crest used by the Discord server.
function T.crest(parent)
  if not parent or type(CreateFrame)~='function' then return nil end
  if parent.tsCrest then return parent.tsCrest end
  local ok,result=pcall(function()
    local crest=CreateFrame('Frame',nil,parent,'BackdropTemplate')
    crest:SetSize(52,58)
    crest:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
    crest:SetBackdropColor(.08,.04,.03,1)
    crest:SetBackdropBorderColor(.84,.74,.59,1)
    if crest.EnableMouse then crest:EnableMouse(false) end
    local emblem=crest:CreateTexture(nil,'ARTWORK')
    emblem:SetPoint('TOPLEFT',2,-2); emblem:SetPoint('BOTTOMRIGHT',-2,2)
    emblem:SetTexture('Interface\\AddOns\\'..addonName..'\\Textures\\GuildCrest.tga')
    crest.emblem=emblem
    parent.tsCrest=crest
    return crest
  end)
  if ok then return result end
  return nil
end
