local ns={};assert(loadfile('TheSentenced/TransferSync.lua'))('TheSentenced',ns)
TheSentencedDB={};function UnitFullName()return 'Icex Jenkins','Realm'end;function GetServerTime()return 1800000000 end
local T=ns.TransferSync
local function hex(s)return(s:gsub('.',function(c)return string.format('%02x',c:byte())end))end
local q=T.request('snapshot');local id=q:match('^TSB1|Q|([^|]+)|')
local reply='TSB1|S|'..id..'|1800000000|'..hex('Icex Jenkins-Realm')..'|'..hex('Icex')..'|snapshot|1:1800000900:40:ACTIVE:'..string.rep('a',64)..':YES:'..hex('Molten Core')
assert(not T.accept(reply:gsub(hex('Icex Jenkins-Realm'),hex('Other-Realm'))),'different character')
assert(not T.accept(reply:gsub('1800000900','1e999')),'invalid infinite date')
assert(T.accept((reply:gsub('|','||'))));assert(T.snapshot().raids[1].ownStatus=='YES')
assert(not T.accept(reply),'duplicate unsolicited response')
assert(T.request('pair','123456789abcdef012'))
assert(not T.request('pair','oops'))
assert(T.request('raid.signup','1:NO:'..string.rep('a',64)))
id=T.code():match('^TSB1|Q|([^|]+)|');assert(not T.accept('TSB1|E|'..id..'|'..hex('Brak dostępu')))
assert(T.snapshot().raids[1].ownStatus=='YES','error cannot change confirmed state')
print('MEMBER_TRANSFER_OK')

-- Loading the public package outside the intended guild cannot reveal a cached Discord snapshot.
GetServerTime=function() return 1795000000 end
assert(loadfile('TheSentenced/GuildAccess.lua'))('TheSentenced',ns)
ns.CompanionSnapshot={schema=1,generatedAt=1795000000,raids={{title='TEST PRIVATE'}}}
C_Club={GetGuildClubId=function() return 1234567 end}
assert(not ns.GuildAccess.snapshot() and not ns.TransferSync.snapshot())
assert(not ns.TransferSync.request('snapshot'))
C_Club.GetGuildClubId=function() return 215750322 end
assert(ns.GuildAccess.snapshot())
TheSentencedDB.autoDiscord=false
assert(not ns.GuildAccess.snapshot())

local request=T.request('staff.review.list','1')
local staffID=request:match('^TSB1|Q|([^|]+)|')
assert(T.code(true)==request and T.code()~=request)
assert(TheSentencedDB.memberTransfer.pending.id~=staffID,'staff data is not persisted')
local replyHeader='TSB1|K|'..staffID..'|1795000000|'..hex('Icex Jenkins-Realm')..'|1|0|-|'
local staffReply=replyHeader..'123456789012345678:3:'..hex('Nick w grze')..':'..hex('Łotr')
assert(not T.accept(staffReply),'private wire cannot enter the ordinary pane')
assert(not T.accept(staffReply:gsub('Icex','Other'),false))
assert(T.accept(staffReply,true))
assert(T.staffSnapshot().applications[1].name=='Łotr')
assert(not T.accept(staffReply,true),'successful request is consumed')
GetServerTime=function() return 1795000601 end
assert(not T.staffSnapshot(),'staff data expires in memory')

GetServerTime=function() return 1795000000 end
TheSentencedDB.autoDiscord=true
ns.CompanionSnapshot.staff={queue=staffReply,ack=''}
assert(T.localStaff().applications[1].name=='Łotr')
assert(T.localStaffAvailable())
GetServerTime=function() return 1795000601 end
assert(not T.localStaff() and T.localStaffAvailable(), 'stale snapshot keeps automatic connection without exposing stale applications')
local storedQueue=ns.CompanionSnapshot.staff.queue
ns.CompanionSnapshot.staff.queue=storedQueue:gsub(hex('Icex Jenkins-Realm'),hex('Other-Realm'))
assert(not T.localStaffAvailable(), 'automatic indicator remains bound to the paired character')
ns.CompanionSnapshot.staff.queue=storedQueue
GetServerTime=function() return 1795000000 end

assert(T.queueLocalDecision('1:approve:123456789012345678:3'))
local decisionID=T.waitingForStaffBridge();assert(decisionID and #decisionID==16)
assert(not T.queueLocalDecision('1:reject:123456789012345678:3'))
ns.CompanionSnapshot.staff.ack='TSB1|K|'..decisionID..'|1795000000|'..hex('Icex Jenkins-Realm')..'|1|0|APPROVED'
local queue,receipt=T.localStaff()
assert(queue and receipt:find('potwierdził przyjęcie'))
assert(not T.waitingForStaffBridge() and not TheSentencedDB.staffReviewOutboxV1)
TheSentencedDB.autoDiscord=false
assert(not T.localStaff())

local staffPost=assert(T.staffPostPayload('general','Żółć i https://example.org'))
assert(staffPost:match('^general:'), 'staff composition encodes multi-byte text')
assert(not T.staffPostPayload('general', string.rep('a',381)), 'staff composition rejects oversize')
local post=assert(T.request('staff.post',staffPost))
local postId=post:match('^TSB1|Q|(%x+)|')
local publication=table.concat({'TSB1','P',postId,'1795000000',hex('Icex Jenkins-Realm'),'123456789012345678'},'|')
assert(T.accept(publication,true), 'paired character accepts confirmed post')
TheSentencedDB.autoDiscord=true
assert(T.queueLocalPost(staffPost))
ns.CompanionSnapshot.staff.ack=publication:gsub(postId,T.waitingForStaffBridge(),1)
local _,message=T.localStaff()
assert(message:find('opublikował') and not T.waitingForStaffBridge())

-- Expiry or corruption cannot silently replace an unconfirmed staff operation.
assert(T.queueLocalPost(staffPost))
local original=TheSentencedDB.staffReviewOutboxV1
GetServerTime=function() return 1795000901 end
assert(T.staffOutboxStatus()=='expired')
assert(not T.queueLocalPost(staffPost) and TheSentencedDB.staffReviewOutboxV1==original)
assert(T.discardStaffOutbox())
assert(T.queueLocalPost(staffPost))
assert(not T.discardStaffOutbox(), 'a live request cannot be discarded as expired')
TheSentencedDB.staffReviewOutboxV1='broken'
assert(T.staffOutboxStatus()=='invalid')
assert(not T.queueLocalPost(staffPost))
assert(T.discardStaffOutbox())

-- A delayed confirmation may clear an expired operation only after a verified decision.
GetServerTime=function() return 1795000000 end
assert(T.queueLocalDecision('1:approve:123456789012345678:3'))
local expiredId=T.waitingForStaffBridge()
GetServerTime=function() return 1795000901 end
local current='TSB1|K|1111111111111111|1795000901|'..hex('Icex Jenkins-Realm')..'|1|0|-'
ns.CompanionSnapshot.staff.queue=current
ns.CompanionSnapshot.staff.ack='TSB1|E|'..expiredId..'|'..hex('unknown')
assert(T.localStaff())
assert(T.staffOutboxStatus()=='expired', 'unconfirmed expired request must stay')
ns.CompanionSnapshot.staff.ack='TSB1|K|'..expiredId..'|1795000901|'..hex('Icex Jenkins-Realm')..'|1|0|APPROVED'
local _,recoveredMessage=T.localStaff()
assert(recoveredMessage:find('potwierdził przyjęcie') and not T.staffOutboxStatus())

-- A receipt must refer to the queued operation, including after an outage.
GetServerTime=function() return 1795000000 end
assert(T.queueLocalPost(staffPost))
local latePostId=T.waitingForStaffBridge()
GetServerTime=function() return 1795000901 end
ns.CompanionSnapshot.staff.ack='TSB1|K|'..latePostId..'|1795000901|'..hex('Icex Jenkins-Realm')..'|1|0|APPROVED'
assert(T.localStaff() and T.staffOutboxStatus()=='expired', 'decision cannot confirm a post')
ns.CompanionSnapshot.staff.ack=publication:gsub(postId,latePostId,1):gsub('|1795000000|','|1795000901|',1)
local _,latePostReceipt=T.localStaff()
assert(latePostReceipt:find('opublikował') and not T.staffOutboxStatus(), 'late confirmed post is recovered')
