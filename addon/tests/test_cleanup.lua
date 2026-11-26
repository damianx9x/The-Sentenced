local ns={}; assert(loadfile('TheSentenced/TestCleanup.lua'))('TheSentenced',ns)
local c=ns.TestCleanup; local scope='The Sentenced@CAMWOW EU5 Realm 5 PvE'
local testReply={sender='Icex Jenkins',key='Icex Jenkins|17944044640012',text='test'}
local keepReply={sender='Icex Thebankier',key='Icex Thebankier|17944240210002',text='nie dzieki'}
local db={boards={[scope]={items={{sender='Icex Thebankier',id='17944050290001',replies={}},{sender='Icex Jenkins',id='777',replies={testReply,keepReply}}}}},
 planners={[scope]={items={bad={author='Icex Jenkins',id='17941335660001'},good={author='Else',id='17941335660001'}}}},
 finds={[scope]={items={bad={author='Icex Jenkins',id='17940670040005'}}}},
 manualNodes={{author='Icex Jenkins',id='17940670040005'}},archives={[scope]={records={
  {tag='B',origin='Icex Jenkins',payload='B2|Icex Jenkins|777|17944044640012|test'},
  {tag='B',origin='Icex Thebankier',payload='B2|Icex Jenkins|777|17944240210002|nie dzieki'},
  {tag='E',origin='Icex Jenkins',payload='E1|17941335660001|5|20:00|test'}}}}}
c.run(db); assert(#db.boards[scope].items==1 and #db.boards[scope].items[1].replies==1 and db.boards[scope].items[1].replies[1]==keepReply)
assert(not db.planners[scope].items.bad and db.planners[scope].items.good and not db.finds[scope].items.bad and #db.manualNodes==0)
assert(#db.archives[scope].records==1 and db.archives[scope].records[1].origin=='Icex Thebankier')
assert(c.block(scope,'TSGuildEvent','R2|Icex Jenkins|17941335660001|123|TANK','Icex Thebankier'))
assert(not c.block('Other@realm','TSGuildEvent','E1|17941335660001|5|x|test','Icex Jenkins'))
assert(not c.block(scope,'TSGuildEvent','E1|17941335660001|5|x|test','Else'))
c.run(db); assert(#db.boards[scope].items[1].replies==1 and #db.archives[scope].records==1)
print('TEST_CLEANUP_OK')
