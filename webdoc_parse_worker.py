"""Bounded, isolated document parser shared by HTTP writes and the watcher.

One daemon worker, one in-flight job, and a 350 ms deadline. Failure yields an
empty administrator-only index entry. No background parse can hold the server
GIL, and a timed-out worker is killed before it can accept another job.
"""
import atexit
import multiprocessing
import threading
import sys

BUDGET = .35
MAX_BYTES = 16 * 1024 * 1024
_lock = threading.Lock()
_process = None
_pipe = None

def _worker(pipe):
    from webdoc_index import parse_document
    pipe.send('ready')
    while True:
        try:
            job = pipe.recv()
            try:
                result = parse_document(*job)
            except Exception:
                result = None
            pipe.send(result)
        except (EOFError, OSError):
            return

def _stop():
    global _process, _pipe
    if _pipe:
        _pipe.close()
    if _process:
        if _process.is_alive():
            _process.terminate()
        _process.join(timeout=.1)
        _process.close()
    _process = _pipe = None

atexit.register(_stop)

def _closed(doc_id):
    from webdoc_access import malformed_access
    return dict(title=doc_id.rsplit('/', 1)[-1], description='', assumes=[], next=[],
                headings=[], links=[], requirements=[], tests=[], body='',
                access=malformed_access(), access_groups=[])

def bounded_parse(doc_id, component, text):
    global _process, _pipe
    # A marker count and nesting ceiling also bounds JSON and table extraction.
    if len(text) > MAX_BYTES or text.count('<!--') > 4096:
        return _closed(doc_id)
    if not _lock.acquire(timeout=BUDGET):
        return _closed(doc_id)
    try:
        if _process is None or not _process.is_alive():
            _stop()
            context = multiprocessing.get_context('spawn')
            # Bypass the Windows venv redirector for this stdlib-only worker so
            # terminate()/join() refer to the interpreter, not a launcher.
            context.set_executable(sys._base_executable)
            _pipe, child = context.Pipe()
            _process = context.Process(target=_worker, args=(child,), daemon=True)
            _process.start()
            child.close()
            # Startup is separate from parsing and cannot hold the server GIL.
            # Do not permanently mark an ordinary file unparseable just because
            # a cold Windows interpreter took longer than the parse deadline.
            if not _pipe.poll(3) or _pipe.recv() != 'ready':
                _stop()
                return _closed(doc_id)
        # The deadline covers IPC as well as parsing: poll() alone can become
        # readable before a large response has finished arriving. Keep both
        # blocking pipe operations off the caller and terminate on expiry.
        pipe = _pipe
        completed = threading.Event()
        answer = []
        def exchange():
            try:
                pipe.send((doc_id, component, text))
                answer.append(pipe.recv())
            except (OSError, EOFError, ValueError):
                pass
            finally:
                completed.set()
        io = threading.Thread(target=exchange, daemon=True)
        io.start()
        if completed.wait(BUDGET):
            return (answer[0] if answer else None) or _closed(doc_id)
        _stop()
        io.join(timeout=.1)
        return _closed(doc_id)
    except (OSError, EOFError, ValueError):
        _stop()
        return _closed(doc_id)
    finally:
        _lock.release()
