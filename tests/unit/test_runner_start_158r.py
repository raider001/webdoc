"""A page runner must not outlive a server that stops while the runner is starting.

webdoc_runs.ProcessTree creates a runner suspended and only then moves it into
its run's kill-on-close job. A server stopped in that gap (Stop-Process, or a
test fixture's terminate(): no Python clean-up runs) left the runner suspended
for good; KALYNX-158-REMERGE found one after this suite's own fixture servers.

The helper below stands in for the server. It holds the gap open, then either
terminates itself the way Stop-Process does, or has its start-up fail in-process
while it stays alive. The test watches the runner through a handle it opened
while the helper was still alive, so it can only ever end that exact process.
"""
import ctypes
import os
import subprocess
import sys
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

HELPER = r'''
import ctypes, subprocess, sys
sys.path.insert(0, sys.argv[1])
import webdoc_runs
real = subprocess.Popen
class FailsNext:
    # The real runner, but the start-up step after it (joining the run's job) fails.
    def __init__(self, child): self.child = child
    @property
    def _handle(self): raise KeyboardInterrupt('start-up interrupted')
    def __getattr__(self, name): return getattr(self.child, name)
def popen(*args, **kwargs):
    child = real(*args, **kwargs)              # created suspended, not yet in its run's job
    print(child.pid, flush=True)
    sys.stdin.readline()                       # the test holds the gap open here
    if sys.argv[2] == 'stop':
        k = ctypes.WinDLL('kernel32')
        k.GetCurrentProcess.restype = ctypes.c_void_p
        k.TerminateProcess.argtypes = (ctypes.c_void_p, ctypes.c_uint)
        k.TerminateProcess(k.GetCurrentProcess(), 9)    # the server is stopped right here
    return FailsNext(child)                    # or its start-up fails in-process
webdoc_runs.subprocess.Popen = popen
try:
    webdoc_runs.ProcessTree([sys.executable, '-c', 'import time; time.sleep(120)'], sys.argv[1], None)
except KeyboardInterrupt:
    print('interrupted', flush=True)
    sys.stdin.readline()                       # stay alive: only ProcessTree may end the runner
'''

SYNCHRONIZE, PROCESS_TERMINATE, PROCESS_QUERY_LIMITED_INFORMATION = 0x00100000, 0x0001, 0x1000
WAIT_OBJECT_0 = 0


def read_line(stream, timeout=30):
    got = []
    reader = threading.Thread(target=lambda: got.append(stream.readline()), daemon=True)
    reader.start()
    reader.join(timeout)
    if reader.is_alive():
        raise AssertionError('the helper did not answer within %ss' % timeout)
    return got[0]


@unittest.skipUnless(os.name == 'nt', 'Windows job objects')
class RunnerStartGap(unittest.TestCase):
    def setUp(self):
        from ctypes import wintypes as w
        self.k = k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.restype = w.HANDLE
        k.OpenProcess.argtypes = (w.DWORD, w.BOOL, w.DWORD)
        k.WaitForSingleObject.argtypes = (w.HANDLE, w.DWORD)
        k.WaitForSingleObject.restype = w.DWORD
        k.TerminateProcess.argtypes = (w.HANDLE, w.UINT)
        k.CloseHandle.argtypes = (w.HANDLE,)

    def helper(self, mode):
        process = subprocess.Popen([sys.executable, '-B', '-c', HELPER, str(ROOT), mode], cwd=ROOT,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.end_helper, process)
        line = read_line(process.stdout)
        if not line.strip().isdigit():
            process.kill()
            raise AssertionError('helper failed to start a runner: ' + line + process.stderr.read())
        return process, int(line)

    def end_helper(self, process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()

    def runner(self, pid):
        handle = self.k.OpenProcess(SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        self.assertTrue(handle, 'cannot open the runner: %d' % ctypes.get_last_error())
        self.addCleanup(self.end_runner, handle)
        return handle

    def end_runner(self, handle):
        # A stranded runner is ended here, through the handle opened while its helper lived.
        if self.k.WaitForSingleObject(handle, 0) != WAIT_OBJECT_0:
            self.k.TerminateProcess(handle, 1)
            self.k.WaitForSingleObject(handle, 5000)
        self.k.CloseHandle(handle)

    def test_a_runner_ends_with_a_server_stopped_before_its_job_owns_it(self):
        helper, pid = self.helper('stop')
        runner = self.runner(pid)
        helper.stdin.write('go\n')
        helper.stdin.flush()
        helper.wait(timeout=30)
        self.assertEqual(self.k.WaitForSingleObject(runner, 10000), WAIT_OBJECT_0,
                         'the runner outlived its stopped server (left suspended)')

    def test_a_start_that_fails_in_the_gap_ends_its_runner(self):
        helper, pid = self.helper('fail')
        runner = self.runner(pid)
        helper.stdin.write('go\n')
        helper.stdin.flush()
        self.assertEqual(read_line(helper.stdout).strip(), 'interrupted')
        self.assertEqual(self.k.WaitForSingleObject(runner, 10000), WAIT_OBJECT_0,
                         'a failed start left its runner behind while the server runs on')
        helper.stdin.write('done\n')
        helper.stdin.flush()
        helper.wait(timeout=30)


if __name__ == '__main__':
    unittest.main()
