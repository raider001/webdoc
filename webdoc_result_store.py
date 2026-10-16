"""Shared xUnit storage. Use the same lock for page runs and scheduled publication."""
import contextlib, json, math, os, re, time, uuid
from pathlib import Path
from datetime import datetime, timezone
import xml.etree.ElementTree as ET

@contextlib.contextmanager
def result_lock(path):
    lock=Path(str(path)+'.run-lock'); lock.parent.mkdir(parents=True,exist_ok=True)
    with lock.open('a+b') as handle:
        if handle.tell()==0: handle.write(b'0');handle.flush()
        handle.seek(0); deadline=time.monotonic()+30
        if os.name=='nt':
            import msvcrt
            while True:
                try: msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1);break
                except OSError:
                    if time.monotonic()>deadline:raise TimeoutError('results lock busy')
                    time.sleep(.05)
        else:
            import fcntl
            fcntl.flock(handle,fcntl.LOCK_EX)
        try:yield
        finally:
            handle.seek(0)
            if os.name=='nt':msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(handle,fcntl.LOCK_UN)

ID = re.compile(r'T_[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\Z')
def read_cases(path):
    deadline=time.monotonic()+5
    while True:
        try:raw=Path(path).read_bytes();break
        except PermissionError:
            if time.monotonic()>deadline:raise
            time.sleep(.01)
    if len(raw)>16*1024*1024 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('unsafe xUnit')
    root=ET.fromstring(raw)
    from xml.parsers import expat
    parser=expat.ParserCreate(); spans=[];start=None
    def opening_end(pos):
        quote=None
        while pos<len(raw):
            char=raw[pos]
            if quote:
                if char==quote:quote=None
            elif char in (34,39):quote=char
            elif char==62:return pos+1
            pos+=1
        raise ValueError('invalid XML opening tag')
    def begin(name,attrs):
        nonlocal start
        if name=='testcase':
            if start is not None:raise ValueError('nested testcases refused')
            start=parser.CurrentByteIndex
    def end(name):
        nonlocal start
        if name=='testcase':
            pos=parser.CurrentByteIndex
            tag_end=opening_end(start)
            finish=tag_end if raw[tag_end-2:tag_end]==b'/>' else opening_end(pos)
            spans.append(raw[start:finish]);start=None
    parser.StartElementHandler=begin;parser.EndElementHandler=end;parser.Parse(raw,True)
    if len(spans)!=sum(1 for _ in root.iter('testcase')):raise ValueError('unsupported xUnit structure')
    cases={}
    for fragment in spans:
        node=ET.fromstring(fragment);tid=node.get('classname')
        if not tid or tid in cases:raise ValueError('missing or duplicate xUnit identity')
        cases[tid]=(fragment,node)
    return cases

def atomic_replace(temp,path):
    deadline=time.monotonic()+5
    while True:
        try:os.replace(temp,path);return
        except PermissionError:
            if time.monotonic()>deadline:raise
            time.sleep(.01)

def details(node):
    props={p.get('name'):p.get('value') for p in node.findall('./properties/property')}
    fail=node.find('failure'); error=node.find('error'); skipped=node.find('skipped')
    return dict(testName=node.get('name',''),result='error' if error is not None else 'failed' if fail is not None else 'skipped' if skipped is not None else 'passed',lastRun=props.get('webdoc.lastRun'),duration=node.get('time'),startedBy=props.get('webdoc.startedBy'),outputTail=props.get('webdoc.outputTail','')[-8192:],failure='\n'.join(n.get('message') or n.text or '' for n in (fail,error) if n is not None)[:8192])

def stamp(node,when,duration,by):
    node.set('time',str(duration)); props=node.find('properties')
    if props is None: props=ET.SubElement(node,'properties')
    for p in list(props):
        if p.get('name','').startswith('webdoc.'): props.remove(p)
    for k,v in (('lastRun',when),('startedBy',by)): ET.SubElement(props,'property',name='webdoc.'+k,value=v)
    return node

def _merge_unlocked(path,replacements,before_replace=None):
    path=Path(path); old=read_cases(path) if path.exists() else {}
    rows={tid:raw for tid,(raw,_) in old.items()}; rows.update({tid:ET.tostring(n,encoding='utf-8') for tid,n in replacements.items()})
    nodes=[ET.fromstring(raw) for raw in rows.values()]
    payload=('<?xml version="1.0" encoding="utf-8"?>\n<testsuites><testsuite name="WebDocs evidence" tests="%d" failures="%d" errors="%d">\n'%(len(nodes),sum(n.find('failure') is not None for n in nodes),sum(n.find('error') is not None for n in nodes))).encode()+b'\n'.join(rows.values())+b'\n</testsuite></testsuites>\n'
    path.parent.mkdir(parents=True,exist_ok=True); temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temp.open('xb') as f: f.write(payload); f.flush(); os.fsync(f.fileno())
    if before_replace: before_replace()
    atomic_replace(temp,path)

def merge_results(path,replacements,before_replace=None):
    with result_lock(path):_merge_unlocked(path,replacements,before_replace)

def publish_generated(target, generated):
    """A periodic refresh has no authority to invent a test execution timestamp.
    Newer page evidence wins over an older scheduled run, even if omitted by an
    older generator's snapshot. Historical suite timestamps are NOT run times.
    """
    target=Path(target)
    with result_lock(target):
        incoming=read_cases(generated);previous=read_cases(target) if target.exists() else {}
        selected={}
        for tid,(raw,node) in incoming.items():
            new=details(node);old=previous.get(tid)
            if old:
                prior=details(old[1]);old_time=prior.get('lastRun');new_time=new.get('lastRun')
                if old_time and (not new_time or datetime.fromisoformat(old_time)>datetime.fromisoformat(new_time)):
                    node=old[1]
            selected[tid]=node
        for tid,(_,node) in previous.items():
            if tid not in selected and details(node).get('startedBy')=='page':selected[tid]=node
        # Full generated feed plus newer page evidence; preserve unselected bytes.
        # _merge_unlocked keeps old non-page cases too; explicitly use a fresh
        # serialization here so disappeared scheduled evidence is not reintroduced.
        payload=ET.Element('testsuites');suite=ET.SubElement(payload,'testsuite',name='Programme evidence')
        for node in selected.values():suite.append(node)
        suite.set('tests',str(len(selected)));suite.set('failures',str(sum(n.find('failure') is not None for n in selected.values())));suite.set('errors',str(sum(n.find('error') is not None for n in selected.values())))
        temp=target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
        with temp.open('xb') as f:f.write(ET.tostring(payload,encoding='utf-8',xml_declaration=True));f.flush();os.fsync(f.fileno())
        atomic_replace(temp,target)

