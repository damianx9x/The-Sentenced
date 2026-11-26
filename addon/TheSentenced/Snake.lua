local _,NS=...
local S={};NS.Snake=S
local D={UP={0,1},DOWN={0,-1},LEFT={-1,0},RIGHT={1,0}}
local reverse={UP='DOWN',DOWN='UP',LEFT='RIGHT',RIGHT='LEFT'}
local function key(x,y)return x..':'..y end
local function pickIndex(choose,n)
 local value=choose and choose(n) or math.random(n)
 if type(value)~='number' or value~=value or value<1 or value>n then return 1 end
 return math.floor(value)
end
local function freeCells(state,avoidFood,avoidBonus)
 local used={};for _,p in ipairs(state.body) do used[key(p.x,p.y)]=true end
 for k in pairs(state.walls) do used[k]=true end
 if avoidFood and state.food then used[key(state.food.x,state.food.y)]=true end
 if avoidBonus and state.bonus then used[key(state.bonus.x,state.bonus.y)]=true end
 local free={};for y=1,state.height do for x=1,state.width do if not used[key(x,y)] then free[#free+1]={x=x,y=y} end end end
 return free
end
local function food(state,choose)
 local free=freeCells(state,false,true)
 if #free==0 and state.bonus then state.bonus=nil;free=freeCells(state,false,false) end
 if #free==0 then state.food=nil;state.status='WON';return end
 state.food=free[pickIndex(choose,#free)]
end
local function bonus(state,choose)
 local free=freeCells(state,true,false);if #free==0 then return end
 local p=free[pickIndex(choose,#free)];local kinds={'SHIELD','SLOW','DOUBLE'}
 state.bonus={x=p.x,y=p.y,kind=kinds[pickIndex(choose,#kinds)],ttl=35}
end
function S.new(width,height,choose,options)
 width=width or 15;height=height or 11;options=options or {}
 assert(type(width)=='number' and type(height)=='number' and width==math.floor(width) and height==math.floor(height) and width>=5 and height>=5 and width<=30 and height<=30,'INVALID_BOARD')
 local x,y=math.max(3,math.floor(width/2)),math.floor(height/2)
 local mode=options.mode or 1;if type(mode)~='number' or mode~=math.floor(mode) or mode<1 or mode>4 then mode=1 end
 local s={width=width,height=height,body={{x=x,y=y},{x=x-1,y=y},{x=x-2,y=y}},direction='RIGHT',nextDirection='RIGHT',score=0,status='PLAYING',mode=mode,walls={},foods=0,shield=0,slow=0,double=0}
 local occupied={};for _,p in ipairs(s.body) do occupied[key(p.x,p.y)]=true end
 local function wall(a,b)if not occupied[key(a,b)] then s.walls[key(a,b)]=true end end
 if mode==2 and width>=9 and height>=7 then
  for row=3,height-2 do if row~=y then wall(3,row);wall(width-2,row) end end
 elseif mode==3 and width>=9 and height>=7 then
  for col=3,width-2 do if col~=x and col~=x+1 then wall(col,3);wall(col,height-2) end end
 end
 food(s,choose);return s
end
function S.turn(state,direction)
 if state.status~='PLAYING' or not D[direction] or direction==reverse[state.direction] then return false end
 state.nextDirection=direction;return true
end
function S.step(state,choose)
 if state.status~='PLAYING' then return state.status end
 state.direction=state.nextDirection;local delta=D[state.direction];local head=state.body[1];local x,y=head.x+delta[1],head.y+delta[2]
 if state.mode==4 then x=(x-1)%state.width+1;y=(y-1)%state.height+1 end
 local grows=state.food and state.food.x==x and state.food.y==y
 local hit=x<1 or y<1 or x>state.width or y>state.height or state.walls[key(x,y)]
 if not hit then for i=1,#state.body-(grows and 0 or 1) do local p=state.body[i];if p.x==x and p.y==y then hit=true;break end end end
 if hit then
  if state.shield>0 then state.shield=state.shield-1;return state.status end
  state.status='LOST';return state.status
 end
 table.insert(state.body,1,{x=x,y=y});if not grows then table.remove(state.body) end
 if state.slow>0 then state.slow=state.slow-1 end
 if state.double>0 then state.double=state.double-1 end
 if state.bonus then
  state.bonus.ttl=state.bonus.ttl-1
  if state.bonus.x==x and state.bonus.y==y then
   local kind=state.bonus.kind;state.bonus=nil;state.score=state.score+5
   if kind=='SHIELD' then state.shield=1 elseif kind=='SLOW' then state.slow=30 elseif kind=='DOUBLE' then state.double=30 end
  elseif state.bonus.ttl<=0 then state.bonus=nil end
 end
 if grows then
  state.foods=state.foods+1;state.score=state.score+(state.double>0 and 2 or 1);food(state,choose)
  if state.status=='PLAYING' and state.foods%5==0 and not state.bonus then bonus(state,choose) end
 end
 return state.status
end
