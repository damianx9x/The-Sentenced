local ns={};assert(loadfile('TheSentenced/Snake.lua'))('TheSentenced',ns);local s=ns.Snake
local x=s.new(7,7,function()return 1 end);assert(x.status=='PLAYING');assert(not s.turn(x,'LEFT'));assert(s.turn(x,'UP'));assert(s.step(x)=='PLAYING');assert(x.body[1].y==4)
x.food={x=x.body[1].x,y=x.body[1].y+1};local n=#x.body;assert(s.step(x)=='PLAYING');assert(#x.body==n+1 and x.score==1)
local w=s.new(5,5,function()return 1 end);w.food={x=1,y=1};while w.status=='PLAYING' do s.step(w) end;assert(w.status=='LOST')
local y=s.new(5,5,function()return 1 end);y.body={{x=2,y=2},{x=2,y=1},{x=1,y=1},{x=1,y=2}};y.direction='UP';y.nextDirection='LEFT';y.food={x=5,y=5};assert(s.step(y)=='PLAYING','entering vacated tail is legal')
print('SNAKE_RULES_OK')
