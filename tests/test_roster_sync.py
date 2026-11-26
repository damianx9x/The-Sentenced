import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('roster_sync',Path(__file__).parents[1]/'mac/roster_sync.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def make(guild='The Sentenced',stamp=1800000000,entry='496365782D5265616C6D:Paladin',count=1):
 return ('TheSentencedGuildDB = { ["rosterExportV1"] = "TSR1|%d|%s|%d|%s" }'%(stamp,guild.encode().hex(),count,entry)).encode()
class RosterSyncTests(unittest.TestCase):
 def test_parse_and_confirm(self):
  s=mod.parse_snapshot(make(),1800000000);self.assertEqual(s['rows'][0]['name'],'Icex-Realm');result=mod.sync(s,lambda data:{'ok':True,'characters':1,'profiles':0},1800000000);self.assertEqual(result['status'],'OK')
 def test_duplicate_reports_snapshot_size_separately_from_processed_rows(self):
  snapshot=mod.parse_snapshot(make(),1800000000)
  result=mod.sync(snapshot,lambda data:{'ok':True,'duplicate':True,'characters':0,'profiles':0},1800000000)
  self.assertTrue(result['duplicate']);self.assertEqual(result['snapshot_characters'],1);self.assertEqual(result['characters'],0)
 def test_bad_data_rejected(self):
  for data in [make(guild='Other'),make(count=2),make(entry='GG:Mage'),make(stamp=1700000000),make(entry='41:Bad')]:
   with self.assertRaises(ValueError):mod.parse_snapshot(data,1800000000)
 def test_level_and_rank(self):
  data=b'TheSentencedGuildDB = { ["rosterExportV1"] = "TSR2|1800000000|5468652053656e74656e636564|1|49636578:Paladin:60:474d" }';row=mod.parse_snapshot(data,1800000000)['rows'][0];self.assertEqual((row['level'],row['rank']),(60,'GM'))
 def test_no_execution(self):
  self.assertRaises(ValueError,mod.parse_snapshot,b'os.execute("bad")',1800000000)
 def test_newest_valid(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)
   for name,stamp in [('a',1799999999),('b',1800000000)]:
    p=root/name/'SavedVariables';p.mkdir(parents=True);(p/'TheSentenced.lua').write_bytes(make(stamp=stamp))
   self.assertEqual(mod.choose_snapshot(root,1800000000)['timestamp'],1800000000)
 def test_event_projection_is_bounded_and_escapes_lua(self):
  item={'id':1,'title':'żmija ";os.execute("bad")--','when':1800000100,'capacity':10}
  value={'schema':1,'generatedAt':1800000000,'raids':[item],'expeditions':[]}
  with tempfile.TemporaryDirectory() as t:
   dest=Path(t)/'CompanionSnapshot.lua';dest.write_bytes(mod.EVENT_MARKER)
   result=mod.sync_events(lambda:value,dest,1800000000)
   self.assertEqual(result['raids'],1);data=dest.read_bytes();self.assertTrue(data.startswith(mod.EVENT_MARKER));self.assertNotIn(b'os.execute',data)
   self.assertEqual(dest.stat().st_mode&0o777,0o600)
   dest.write_text('user content');self.assertRaises(ValueError,mod.write_events,mod.validate_events(value,1800000000),dest);self.assertEqual(dest.read_text(),'user content')
 def test_event_projection_rejects_bad_or_stale_data(self):
  base={'schema':1,'generatedAt':1800000000,'raids':[],'expeditions':[]}
  for value in [dict(base,generatedAt=1799990000),dict(base,schema=2),dict(base,raids=[{'id':1,'title':'x\n','when':1800000001,'capacity':2}]),dict(base,raids=[{'id':True,'title':'x','when':1800000001,'capacity':2}])]:
   with self.assertRaises(ValueError):mod.validate_events(value,1800000000)
class WelcomeBridgeTests(unittest.TestCase):
 def test_confirmations_and_projection(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);p=root/'Account'/'SavedVariables';p.mkdir(parents=True);(p/'TheSentenced.lua').write_bytes(b'["welcomeConfirmedV1"] = "TW1|123456789012345678"')
   self.assertEqual(mod.welcome_confirmations(root),['123456789012345678'])
  value={'schema':1,'generatedAt':1800000000,'welcomes':[{'id':'123456789012345678','text':'Witaj!','createdAt':1800000000}]}
  clean=mod.sync_welcomes([],lambda body:value,1800000000)
  self.assertEqual(len(clean['welcomes']),1)
  batches=[]
  mod.sync_welcomes([str(123456789012345678+i) for i in range(40)],lambda body:(batches.append(body) or value),1800000000)
  self.assertEqual([len(x['confirmed']) for x in batches],[20,20])
  with self.assertRaises(ValueError):mod.sync_welcomes([],lambda body:dict(value,welcomes=[None]),1800000000)
  bad=dict(value,welcomes=[dict(value['welcomes'][0],text='bad|escape')])
  with self.assertRaises(ValueError):mod.sync_welcomes([],lambda body:bad,1800000000)
class StaffBridgeTests(unittest.TestCase):
    def test_staff_outbox_is_bounded_and_matches_paired_character(self):
        import tempfile
        from mac import roster_sync as sync
        character='Icex-Jenkins'
        identity=character.encode().hex()
        stamp=1795000000
        request=f'TSB1|Q|0123456789abcdef|{identity}|staff.review.decide|1:approve:123456789012345678:3'
        queue=f'TSB1|K|fedcba9876543210|{stamp}|{identity}|1|0|-'
        ack=queue.replace('fedcba9876543210','0123456789abcdef').replace('|-','|APPROVED')
        with tempfile.TemporaryDirectory() as work:
            folder=Path(work)/'Account'/'Forever'/'Icex'/'SavedVariables'
            folder.mkdir(parents=True)
            file=folder/'TheSentenced.lua'
            file.write_text(f'["staffReviewOutboxV1"] = "TSA1|{stamp}|{request}",')
            decisions=sync.pending_staff_decisions(Path(work),now=stamp)
            self.assertEqual(len(decisions),1)
            self.assertEqual(len(sync.pending_staff_decisions(Path(work),now=stamp+901)),1)
            self.assertEqual(sync.pending_staff_decisions(Path(work),now=stamp+30*86400+1),[])
            expired_post=request.replace('staff.review.decide|1:approve:123456789012345678:3','staff.post|general:74657374')
            file.write_text(f'["staffReviewOutboxV1"] = "TSA1|{stamp}|{expired_post}",')
            self.assertEqual(len(sync.pending_staff_decisions(Path(work),now=stamp+901)),1)
            with file.open('a') as stream:
                stream.write(f'["staffReviewOutboxV1"] = "TSA1|{stamp}|{request}",')
            self.assertEqual(sync.pending_staff_decisions(Path(work),now=stamp),[])
        calls=[]
        def sender(payload):
            calls.append(payload)
            return {'status':'ready','character':character,'queue':queue,'acknowledgement':ack if payload else None}
        result=sync.sync_staff(decisions,sender)
        self.assertEqual(calls,[{}, {'decision':decisions[0]}])
        self.assertEqual(result,{'queue':queue,'ack':ack})
        value={'generatedAt':stamp,'raids':[],'expeditions':[],'staff':result}
        self.assertNotIn(queue.encode(),sync.events_lua(value))
        self.assertIn(b'staff={queue=',sync.events_lua(value))

        def mismatched_receipt(payload):
            return {**sender(payload),'acknowledgement':queue if payload else None}
        with self.assertRaisesRegex(ValueError,'STAFF_RECEIPT_MISMATCH'):
            sync.sync_staff(decisions,mismatched_receipt)

        def pair_changed(payload):
            return {**sender(payload),'character':'Other-Realm'} if payload else sender(payload)
        with self.assertRaisesRegex(ValueError,'STAFF_PAIR_CHANGED'):
            sync.sync_staff(decisions,pair_changed)


if __name__=='__main__':unittest.main()
