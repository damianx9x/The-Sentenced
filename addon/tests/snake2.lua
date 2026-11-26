local ns={};assert(loadfile('TheSentenced/Snake.lua'))('TheSentenced',ns);local S=ns.Snake
local first=function()return 1 end
local wrap=S.new(7,7,first,{mode=4});wrap.body={{x=7,y=4},{x=6,y=4},{x=5,y=4}};wrap.direction='RIGHT';wrap.nextDirection='RIGHT';wrap.food={x=3,y=1}
assert(S.step(wrap,first)=='PLAYING' and wrap.body[1].x==1,'edge wrapping')
local maze=S.new(15,11,first,{mode=2});assert(maze.walls['3:3'] and not maze.walls['3:5'],'maze and opening')
maze.body={{x=2,y=3},{x=2,y=2},{x=1,y=2}};maze.food={x=10,y=8};maze.direction='RIGHT';maze.nextDirection='RIGHT'
maze.shield=1;assert(S.step(maze,first)=='PLAYING' and maze.shield==0 and maze.body[1].x==2,'shield absorbs collision without clipping')
assert(S.step(maze,first)=='LOST','second collision loses')
local s=S.new(15,11,first,{mode=4});s.foods=4;s.food={x=s.body[1].x+1,y=s.body[1].y}
local length=#s.body
assert(S.step(s,first)=='PLAYING' and s.bonus and s.bonus.kind=='SHIELD','bonus appears after five foods')
assert(#s.body==length+1,'each food adds a body segment')
assert(not (s.bonus.x==s.food.x and s.bonus.y==s.food.y) and not s.walls[s.bonus.x..':'..s.bonus.y],'bonus has a free cell')
for _,kind in ipairs({'SHIELD','SLOW','DOUBLE'}) do
 local a=S.new(15,11,first,{mode=4});local h=a.body[1];a.food={x=1,y=1};a.bonus={x=h.x+1,y=h.y,ttl=9,kind=kind}
 assert(S.step(a,first)=='PLAYING' and not a.bonus and a.score==5,'bonus collection '..kind)
 if kind=='SHIELD' then assert(a.shield==1) elseif kind=='SLOW' then assert(a.slow==30) else
  assert(a.double==30);local p=a.body[1];a.food={x=p.x+1,y=p.y};S.step(a,first);assert(a.score==7,'double points')
 end
end
local expiry=S.new(15,11,first,{mode=4});expiry.food={x=1,y=1};expiry.bonus={x=2,y=1,ttl=3,kind='SLOW'}
for _=1,3 do assert(S.step(expiry,first)=='PLAYING') end
assert(not expiry.bonus,'bonus expires when missed')
print('SNAKE2_OK: mazes, wrap, shield, timed bonuses and double scoring')
