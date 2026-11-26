#!/usr/bin/env python3
"""Read a bounded Guild Hall snapshot and send it over existing private SSH."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path('/Applications/World of Warcraft/_forever_/WTF/Account')
STATE = Path.home() / 'Library/Application Support/The Sentenced/roster-sync.json'
EVENT_STATE = Path.home() / 'Library/Application Support/The Sentenced/event-sync.json'
EVENT_DEST = Path('/Applications/World of Warcraft/_forever_/Interface/AddOns/TheSentenced/CompanionSnapshot.lua')
EVENT_MARKER = b'-- The Sentenced owner event projection v1\n'
PATTERN = re.compile(rb'\["rosterExportV1"\]\s*=\s*"(TSR[12]\|[A-Za-z0-9|:]*)"')
CLASSES = {'Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid'}

def parse_snapshot(data, now=None):
    if len(data) > 20*1024*1024: raise ValueError('FILE_TOO_LARGE')
    matches = PATTERN.findall(data)
    if len(matches) != 1: raise ValueError('SNAPSHOT_MISSING_OR_AMBIGUOUS')
    parts = matches[0].decode('ascii').split('|')
    if len(parts)<5 or parts[0] not in ('TSR1','TSR2'): raise ValueError('INVALID_FORMAT')
    try:
        timestamp=int(parts[1]);guild=bytes.fromhex(parts[2]).decode('utf8');count=int(parts[3])
    except (ValueError,UnicodeError): raise ValueError('INVALID_HEADER')
    current=int(time.time() if now is None else now)
    if guild.strip().casefold()!='the sentenced' or timestamp>current+300 or timestamp<current-7*86400: raise ValueError('WRONG_GUILD_OR_TIME')
    if count<1 or count>5000 or len(parts)-4!=count: raise ValueError('INVALID_COUNT')
    rows=[];seen=set()
    for item in parts[4:]:
        try:
            fields=item.split(':')
            if parts[0]=='TSR2':
                encoded,klass,level,rank=fields;level=int(level);rank=bytes.fromhex(rank).decode('utf8')
                if level<1 or level>1000 or len(rank)>120 or any(ord(c)<32 for c in rank):raise ValueError('INVALID_ROW')
            else: encoded,klass=fields;level=None;rank=None
            name=bytes.fromhex(encoded).decode('utf8')
        except (ValueError,UnicodeError): raise ValueError('INVALID_ROW')
        if not name.strip() or len(name)>60 or any(ord(c)<32 for c in name) or klass not in CLASSES: raise ValueError('INVALID_ROW')
        key=name.casefold()
        if key in seen: raise ValueError('DUPLICATE_CHARACTER')
        seen.add(key);rows.append({'name':name,'wowClass':klass,'level':level,'rank':rank})
    rows.sort(key=lambda x:x['name'].casefold())
    return {'schema':1,'guild':guild,'timestamp':timestamp,'rows':rows}

def choose_snapshot(root=ROOT, now=None):
    valid=[]
    for path in root.glob('*/SavedVariables/TheSentenced.lua'):
        try:
            if path.stat().st_size>20*1024*1024: continue
            snapshot=parse_snapshot(path.read_bytes(),now);valid.append(snapshot)
        except (OSError,ValueError): continue
    return max(valid,key=lambda s:s['timestamp']) if valid else None

def save_state(result,path=STATE):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,tmp=tempfile.mkstemp(prefix='.roster-',dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w',encoding='utf8') as stream:json.dump(result,stream);stream.flush();os.fsync(stream.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def sync(snapshot, sender=None, now=None):
    data=json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode('utf8')
    digest=hashlib.sha256(data).hexdigest()
    if sender is None:
        def sender(body):
            cmd=['/usr/bin/ssh','-4','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes',os.environ['TS_ROSTER_SSH_TARGET'],'/opt/node-v24.21.0/bin/node','/opt/sentencedbot/roster/receive.cjs']
            p=subprocess.run(cmd,input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35,check=False)
            if p.returncode!=0:raise RuntimeError('REMOTE_SYNC_FAILED')
            return json.loads(p.stdout.decode('utf8'))
    result=sender(data)
    if not result.get('ok'):raise RuntimeError('REMOTE_NOT_CONFIRMED')
    return {'status':'OK','snapshot_timestamp':snapshot['timestamp'],'synced_at':int(time.time() if now is None else now),'hash':digest,'characters':result.get('characters',0),'profiles':result.get('profiles',0),'duplicate':bool(result.get('duplicate'))}

def validate_events(value, now=None):
    current=int(time.time() if now is None else now)
    if not isinstance(value,dict) or value.get('schema')!=1: raise ValueError('INVALID_EVENT_SCHEMA')
    stamp=value.get('generatedAt')
    if isinstance(stamp,bool) or not isinstance(stamp,int) or stamp>current+300 or stamp<current-3600: raise ValueError('INVALID_EVENT_TIME')
    output={'schema':1,'generatedAt':stamp}
    for key in ('raids','expeditions'):
        items=value.get(key)
        if not isinstance(items,list) or len(items)>20: raise ValueError('INVALID_EVENT_LIST')
        clean=[]
        for item in items:
            if not isinstance(item,dict): raise ValueError('INVALID_EVENT')
            ident,title,when,capacity=(item.get(k) for k in ('id','title','when','capacity'))
            if any(isinstance(x,bool) or not isinstance(x,int) for x in (ident,when,capacity)): raise ValueError('INVALID_EVENT')
            if not 1<=ident<=100000000 or not current-300<=when<=current+5*366*86400 or not 0<=capacity<=1000: raise ValueError('INVALID_EVENT')
            if not isinstance(title,str) or not title.strip() or len(title)>120 or any(ord(c)<32 or ord(c)==127 for c in title): raise ValueError('INVALID_EVENT')
            clean.append({'id':ident,'title':title,'when':when,'capacity':capacity})
        output[key]=clean
    return output

def welcome_confirmations(root=ROOT):
    ids=set()
    pattern=re.compile(rb'\["welcomeConfirmedV1"\]\s*=\s*"TW1\|([0-9|]*)"')
    for path in root.glob('*/SavedVariables/TheSentenced.lua'):
        if path.stat().st_size>20*1024*1024: continue
        for value in pattern.findall(path.read_bytes()):
            ids.update(x.decode('ascii') for x in value.split(b'|') if re.fullmatch(rb'[0-9]{17,20}',x))
    return sorted(ids)[-100:]

def sync_welcomes(confirmed=None, sender=None, now=None):
    if sender is None:
        def sender(body):
            cmd=['/usr/bin/ssh','-4','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes',os.environ['TS_ROSTER_SSH_TARGET'],'/opt/node-v24.21.0/bin/node','/opt/sentencedbot/roster/welcome-queue.cjs']
            p=subprocess.run(cmd,input=json.dumps(body).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25,check=False)
            if p.returncode!=0 or len(p.stdout)>16384: raise RuntimeError('WELCOME_FETCH_FAILED')
            return json.loads(p.stdout.decode('utf8'))
    acks=confirmed or []
    value=None
    for start in range(0,max(1,len(acks)),20):
        value=sender({'confirmed':acks[start:start+20]})
    current=int(time.time() if now is None else now)
    if not isinstance(value,dict) or value.get('schema')!=1: raise ValueError('INVALID_WELCOME')
    stamp=value.get('generatedAt');rows=value.get('welcomes')
    if type(stamp)!=int or not current-3600<=stamp<=current+300 or not isinstance(rows,list) or len(rows)>20: raise ValueError('INVALID_WELCOME')
    clean=[]
    for row in rows:
        if not isinstance(row,dict): raise ValueError('INVALID_WELCOME')
        ident,text,created=(row.get(k) for k in ('id','text','createdAt'))
        if not isinstance(ident,str) or not re.fullmatch(r'[0-9]{17,20}',ident) or not isinstance(text,str) or not text or len(text.encode('utf8'))>240 or any(ord(c)<32 or ord(c)==127 or c=='|' for c in text) or type(created)!=int or not current-86400<=created<=current+300: raise ValueError('INVALID_WELCOME')
        clean.append({'id':ident,'text':text,'createdAt':created})
    return {'generatedAt':stamp,'welcomes':clean}

STAFF_OUTBOX = re.compile(rb'\["staffReviewOutboxV1"\]\s*=\s*"TSA1\|([0-9]{10})\|(TSB1\|Q\|[a-f0-9]{16}\|[a-f0-9]{6,260}\|(?:staff\.review\.decide\|[A-Za-z0-9:]{5,100}|staff\.post\|[a-z]{3,16}:[a-f0-9]{2,760}))"')
STAFF_WIRE = re.compile(r'TSB1\|[KEP]\|[0-9a-f]{16}\|[A-Za-z0-9:|.-]+\Z')

def pending_staff_decisions(root=ROOT, now=None):
    current=int(time.time() if now is None else now)
    decisions=[]
    for path in root.glob('*/*/*/SavedVariables/TheSentenced.lua'):
        if path.stat().st_size>8*1024*1024:
            continue
        for stamp,wire in STAFF_OUTBOX.findall(path.read_bytes()):
            created=int(stamp)
            operation=wire.decode('ascii').split('|')[4]
            earliest=current-(30*86400 if operation=='staff.review.decide' else 900)
            if earliest<=created<=current+60:
                decisions.append({'createdAt':created,'wire':wire.decode('ascii')})
    return sorted(decisions,key=lambda decision:decision['createdAt'],reverse=True)

def sync_staff(decisions=(), transport=None):
    if transport is None:
        def transport(payload):
            cmd=['/usr/bin/ssh','-4','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes',
                 os.environ['TS_ROSTER_SSH_TARGET'],'curl','-fsS','--max-time','12','--unix-socket',
                 '/opt/sentencedbot/data/staff-bridge/staff.sock','-H','Content-Type:application/json',
                 '--data-binary','@-','http://localhost/review']
            result=subprocess.run(cmd,input=json.dumps(payload).encode('ascii'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=18)
            if result.returncode or len(result.stdout)>50000:
                raise RuntimeError('STAFF_BRIDGE_FAILED')
            return json.loads(result.stdout.decode('utf8'))
    value=transport({})
    if not isinstance(value,dict) or value.get('status')!='ready':
        return None
    queue=value.get('queue')
    character=value.get('character')
    if not isinstance(character,str) or not character or len(character)>120:
        raise ValueError('INVALID_STAFF_CHARACTER')
    signature='|'+character.encode('utf8').hex()+'|'
    selected=next((x for x in decisions if signature in x['wire']),None)
    if selected:
        value=transport({'decision':selected})
        queue=value.get('queue')
    ack=value.get('acknowledgement')
    def wire(value):
        if not isinstance(value,str) or len(value)>16384 or not STAFF_WIRE.fullmatch(value):
            raise ValueError('INVALID_STAFF_REPLY')
        return value
    return {'queue':wire(queue),'ack':wire(ack) if ack else ''}

def lua_string(value):
    # Decimal byte escapes prevent Lua source injection and preserve UTF-8.
    return '"'+''.join('\\%03d'%b for b in value.encode('utf8'))+'"'

def events_lua(value):
    def entries(items):
        return '{'+','.join('{id=%d,title=%s,when=%d,capacity=%d}'%(x['id'],lua_string(x['title']),x['when'],x['capacity']) for x in items)+'}'
    welcomes='{'+','.join('{id=%s,text=%s,createdAt=%d}'%(lua_string(x['id']),lua_string(x['text']),x['createdAt']) for x in value.get('welcomes',[]))+'}'
    staff=value.get('staff')
    private_staff='nil' if not staff else '{queue=%s,ack=%s}'%(lua_string(staff['queue']),lua_string(staff['ack']))
    return (EVENT_MARKER.decode('ascii')+'local _,NS=...\nNS.CompanionSnapshot={schema=1,generatedAt=%d,raids=%s,expeditions=%s,welcomesGeneratedAt=%d,welcomes=%s,staff=%s}\n'%(value['generatedAt'],entries(value['raids']),entries(value['expeditions']),value.get('welcomesGeneratedAt',0),welcomes,private_staff)).encode('ascii')

def write_events(value, dest=EVENT_DEST):
    if not dest.is_file(): raise ValueError('EVENT_PROJECTION_NOT_INSTALLED')
    with dest.open('rb') as current:
        if current.read(len(EVENT_MARKER))!=EVENT_MARKER: raise ValueError('EVENT_PROJECTION_NOT_INSTALLED')
    fd,tmp=tempfile.mkstemp(prefix='.events-',dir=dest.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'wb') as stream:stream.write(events_lua(value));stream.flush();os.fsync(stream.fileno())
        os.replace(tmp,dest)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def sync_events(fetcher=None, dest=EVENT_DEST, now=None, welcomes=None, staff=None):
    if fetcher is None:
        def fetcher():
            cmd=['/usr/bin/ssh','-4','-o','BatchMode=yes','-o','ConnectTimeout=8','-o','StrictHostKeyChecking=yes',os.environ['TS_ROSTER_SSH_TARGET'],'/opt/node-v24.21.0/bin/node','/opt/sentencedbot/roster/export-events.cjs']
            p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25,check=False)
            if p.returncode!=0 or len(p.stdout)>65536: raise RuntimeError('EVENT_FETCH_FAILED')
            return json.loads(p.stdout.decode('utf8'))
    value=validate_events(fetcher(),now)
    if welcomes is not None: value.update(welcomesGeneratedAt=welcomes['generatedAt'],welcomes=welcomes['welcomes'])
    if staff is not None: value['staff']=staff
    write_events(value,dest)
    return {'status':'OK','snapshot_timestamp':value['generatedAt'],'synced_at':int(time.time() if now is None else now),'raids':len(value['raids']),'expeditions':len(value['expeditions'])}

def main():
    try:
        welcomes=sync_welcomes(welcome_confirmations())
    except (RuntimeError,OSError,subprocess.SubprocessError,ValueError,UnicodeError):welcomes=None
    try:
        staff=sync_staff(pending_staff_decisions())
    except (RuntimeError,OSError,subprocess.SubprocessError,ValueError,UnicodeError):
        staff=None
    try:save_state(sync_events(welcomes=welcomes,staff=staff),EVENT_STATE)
    except (RuntimeError,OSError,subprocess.SubprocessError,ValueError,UnicodeError):save_state({'status':'RETRY','checked_at':int(time.time())},EVENT_STATE)
    snapshot=choose_snapshot()
    if not snapshot:
        save_state({'status':'WAITING_FOR_GAME_SAVE','checked_at':int(time.time())});return
    try:save_state(sync(snapshot))
    except (RuntimeError,OSError,subprocess.SubprocessError,ValueError):save_state({'status':'RETRY','checked_at':int(time.time())})

if __name__=='__main__':main()
