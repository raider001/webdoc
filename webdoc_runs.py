"""Configuration-only serialized CPU test execution and atomic xUnit merge."""
import collections, ctypes, json, math, os, queue, re, signal, subprocess, threading, time, uuid
from pathlib import Path
from datetime import datetime, timezone
import xml.etree.ElementTree as ET
from webdoc_result_store import ID, read_cases, details, stamp, merge_results

class ProcessTree:
    """Suspend before assigning the Windows kill-on-close Job Object."""
    def __init__(self,command,cwd,env):
        self.job=None
        if os.name!='nt':
            self.process=subprocess.Popen(command,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True); return
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_=[('processTime',ctypes.c_int64),('jobTime',ctypes.c_int64),('flags',w.DWORD),('min',ctypes.c_size_t),('max',ctypes.c_size_t),('active',w.DWORD),('affinity',ctypes.c_size_t),('priority',w.DWORD),('scheduling',w.DWORD)]
        class IO(ctypes.Structure):
            _fields_=[(n,ctypes.c_uint64) for n in ('readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes')]
        class Extended(ctypes.Structure):
            _fields_=[('basic',Basic),('io',IO),('processMemory',ctypes.c_size_t),('jobMemory',ctypes.c_size_t),('peakProcess',ctypes.c_size_t),('peakJob',ctypes.c_size_t)]
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.CreateJobObjectW.restype=w.HANDLE
        self.kernel.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]; self.kernel.CloseHandle.argtypes=[w.HANDLE]
        self.job=self.kernel.CreateJobObjectW(None,None); info=Extended(); info.basic.flags=0x2000
        if not self.job or not self.kernel.SetInformationJobObject(self.job,9,ctypes.byref(info),ctypes.sizeof(info)):
            self.close(); raise ctypes.WinError(ctypes.get_last_error())
        try:
            self.process=subprocess.Popen(command,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=0x4|0x08000000)
            if not self.kernel.AssignProcessToJobObject(self.job,w.HANDLE(int(self.process._handle))):
                self.process.kill(); self.process.wait(); raise ctypes.WinError(ctypes.get_last_error())
            nt=ctypes.WinDLL('ntdll'); nt.NtResumeProcess.argtypes=[w.HANDLE]
            if nt.NtResumeProcess(w.HANDLE(int(self.process._handle)))!=0: raise RuntimeError('cannot resume owned process')
        except BaseException: self.close(); raise
    def close(self):
        if os.name=='nt':
            if self.job: self.kernel.CloseHandle(self.job); self.job=None
        elif hasattr(self,'process'):
            try: os.killpg(self.process.pid,signal.SIGKILL)
            except ProcessLookupError: pass

class Runs:
    def __init__(self,sources,host,authenticated):
        self.specs={}; self.feeds={}
        for src in sources:
            tr=src.get('testResults')
            if tr and not re.match(r'https?://',tr): self.feeds[src['name']]=Path(src['path'])/tr
            spec=src.get('runTests')
            if not spec: continue
            if host not in ('127.0.0.1','localhost','::1') and not authenticated: raise ValueError('non-local test running requires access control')
            cmd=spec.get('command'); ids=spec.get('cases'); timeout=spec.get('timeoutSec'); env=spec.get('env')
            if not isinstance(cmd,list) or not cmd or not all(isinstance(x,str) and x for x in cmd) or sum(x.count('{results}') for x in cmd)!=1: raise ValueError('runner needs argv list with one {results}')
            if not isinstance(ids,list) or not ids or any(not isinstance(x,str) or not ID.fullmatch(x) for x in ids) or len(set(ids))!=len(ids): raise ValueError('runner needs unique strict case ids')
            if type(timeout) not in (int,float) or not math.isfinite(timeout) or not 0<timeout<=3600: raise ValueError('invalid runner time limit')
            if not isinstance(env,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in env.items()): raise ValueError('invalid runner environment')
            cwd=Path(spec['cwd']); output=Path(spec['output']); feed=self.feeds.get(src['name'])
            if not cwd.is_absolute() or not cwd.is_dir() or not output.is_absolute() or feed is None or not feed.resolve().is_relative_to(Path(src['path']).resolve()): raise ValueError('absolute cwd/output and local results required')
            self.specs[src['name']]=dict(command=cmd[:],cases=set(ids),cwd=str(cwd),output=output,feed=feed,env=dict(env),timeout=timeout)
        self.lock=threading.RLock(); self.records=collections.OrderedDict(); self.pending=queue.Queue(64); self.worker=None
    def submit(self,source,ids,described,by='page'):
        if source not in self.specs: raise ValueError('test running is disabled for this source')
        if by not in ('page','scheduled'): raise ValueError('unknown initiator')
        if not isinstance(ids,list) or not ids or len(ids)>1000 or any(not isinstance(i,str) or not ID.fullmatch(i) for i in ids) or len(set(ids))!=len(ids): raise ValueError('expected unique strict test ids')
        for tid in ids:
            rec=described.get(tid)
            if not rec or not rec.get('name','').strip() or not rec.get('steps') or tid not in self.specs[source]['cases']: raise ValueError('test must be described, indexed and configured')
        with self.lock:
            if self.pending.full(): raise ValueError('run queue full')
            while len(self.records)>=256:
                key=next((k for k,r in self.records.items() if r['state']=='finished'),None)
                if key is None: raise ValueError('too many runs')
                del self.records[key]
            rid=uuid.uuid4().hex; self.records[rid]=dict(id=rid,source=source,ids=ids[:],state='waiting',duration=0,output='',cases={},startedBy=by)
            self.pending.put_nowait(rid)
            if self.worker is None: self.worker=threading.Thread(target=self._work,daemon=True); self.worker.start()
            return rid
    def status(self,rid):
        with self.lock:
            if rid not in self.records: raise KeyError('unknown run')
            snapshot=json.loads(json.dumps(self.records[rid])); began=snapshot.pop('_began',None)
            if snapshot['state']=='running' and began is not None:snapshot['duration']=round(time.monotonic()-began,6)
            return snapshot
    def catalog(self,source,described):
        spec=self.specs.get(source); feed=self.feeds.get(source); known=read_cases(feed) if feed and feed.exists() else {}
        return {tid:dict(automated=bool(spec and tid in spec['cases']) or tid in known,runnable=bool(spec and tid in spec['cases'] and described[tid].get('name','').strip() and described[tid].get('steps')),**(details(known[tid][1]) if tid in known else {})) for tid in described}
    def _work(self):
        while True:
            rid=self.pending.get()
            try: self._execute(rid)
            except Exception as exc:
                with self.lock: self.records[rid].update(state='finished',error=str(exc))
            finally: self.pending.task_done()
    def _execute(self,rid):
        rec=self.records[rid]; spec=self.specs[rec['source']]; output=spec['output'].with_name(spec['output'].stem+'.'+rid+'.xml')
        began=time.monotonic(); when=datetime.now(timezone.utc).isoformat()
        with self.lock: rec.update(state='running',lastRun=when,_began=began)
        tree=None; problem=None; nodes={}
        try:
            output.parent.mkdir(parents=True,exist_ok=True)
            cmd=[x.replace('{results}',str(output)) for x in spec['command']]+['--ids']+rec['ids']
            env=dict(os.environ,**spec['env']); env.update(CUDA_VISIBLE_DEVICES='-1',PYTHONDONTWRITEBYTECODE='1')
            tree=ProcessTree(cmd,spec['cwd'],env)
            def drain():
                while True:
                    chunk=tree.process.stdout.read1(1024)
                    if not chunk: break
                    with self.lock: rec['output']=(rec['output']+chunk.decode('utf-8','replace'))[-8192:]
            reader=threading.Thread(target=drain,daemon=True); reader.start()
            try: rc=tree.process.wait(timeout=spec['timeout'])
            except subprocess.TimeoutExpired: problem='Runner time limit exceeded'; tree.close(); tree.process.wait(timeout=10); rc=-1
            tree.close(); reader.join(timeout=5); tree.process.stdout.close()
            if problem is None:
                actual=read_cases(output)
                for tid in rec['ids']:
                    if tid not in actual: raise ValueError('runner omitted requested case: '+tid)
                    nodes[tid]=actual[tid][1]
                if rc not in (0,1): raise ValueError('runner exit code '+str(rc))
        except Exception as exc: problem=str(exc)
        finally:
            if tree: tree.close()
        elapsed=round(time.monotonic()-began,6)
        for tid in rec['ids']:
            node=nodes.get(tid)
            if problem or node is None:
                node=ET.Element('testcase',classname=tid,name=tid); ET.SubElement(node,'error',message=problem or 'No result').text=problem or 'No result'
            try:
                duration=float(node.get('time',elapsed))
                if not math.isfinite(duration) or duration<0: raise ValueError()
            except (ValueError,TypeError): duration=elapsed
            actual_when = details(node).get('lastRun')
            try:
                if not actual_when or not datetime.fromisoformat(when) <= datetime.fromisoformat(actual_when) <= datetime.now(timezone.utc):
                    actual_when = when
            except (ValueError, TypeError): actual_when = when
            nodes[tid]=stamp(node,actual_when,duration,rec['startedBy'])
            ET.SubElement(nodes[tid].find('properties'),'property',name='webdoc.outputTail',value=rec['output'][-8192:])
        try: merge_results(spec['feed'],nodes)
        except Exception as exc: problem='Result publication failed: '+str(exc)
        with self.lock:
            rec.update(state='finished',duration=elapsed,cases={tid:details(node) for tid,node in nodes.items()})
            if problem: rec['error']=problem
