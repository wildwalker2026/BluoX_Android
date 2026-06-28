#!/usr/bin/env python3
"""
Termux 命令执行服务器
通过 HTTP 接收命令，在 Termux 环境中执行，返回结果。
利用常驻进程不被 Android 冻结的特性，解决后台命令超时问题。
"""

import http.server
import json
import subprocess
import os
import time
import signal
import socket
import threading

PORT = 8765
MAX_OUTPUT = 200000
DEFAULT_TIMEOUT = 120

# 运行中的命令追踪：{ cmd_id: process }
RUNNING_COMMANDS = {}
RUNNING_LOCK = threading.Lock()

def io_sleep(seconds):
    """用 socketpair recv 超时代替 time.sleep，利用内核 IO 唤醒避免后台冻结"""
    a, b = socket.socketpair()
    a.settimeout(seconds)
    try:
        a.recv(1)
    except (socket.timeout, OSError):
        pass
    finally:
        a.close()
        b.close()

class CommandHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return ''
        return self.rfile.read(length).decode('utf-8')

    def do_GET(self):
        if self.path == '/ping':
            self._send_json(200, {
                'status': 'ok',
                'pid': os.getpid(),
                'uptime': int(time.time() - START_TIME),
                'active_commands': len(RUNNING_COMMANDS)
            })
        else:
            self._send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path == '/exec':
            self._handle_exec()
        elif self.path == '/cancel':
            self._handle_cancel()
        else:
            self._send_json(404, {'error': 'not found'})

    def _handle_exec(self):
        """通过 subprocess 执行 shell 命令，用 IO 轮询等待结果"""
        body = self._read_body()
        if not body:
            self._send_json(400, {'error': 'empty command'})
            return

        cmd = body
        timeout = DEFAULT_TIMEOUT
        workdir = None
        cmd_id = None

        try:
            req = json.loads(body)
            cmd = req.get('command', '')
            timeout = req.get('timeout', DEFAULT_TIMEOUT)
            workdir = req.get('workdir')
            output_file = req.get('output_file')
            cmd_id = req.get('cmd_id')
        except (json.JSONDecodeError, TypeError):
            pass

        if not cmd:
            self._send_json(400, {'error': 'empty command'})
            return

        try:
            env = os.environ.copy()
            env['TERM'] = 'xterm-256color'

            # 进度文件：优先用 Java 传入的路径，否则自动生成
            if not output_file:
                output_file = '/sdcard/Download/Bluox/Notes/.termux_http_out_{}.txt'.format(int(time.time() * 1000))
            # 用 tee 包装命令：输出同时写到管道和进度文件
            wrapped_cmd = '{ ' + cmd + ' ; } 2>&1 | stdbuf -oL tee ' + output_file

            proc = subprocess.Popen(
                ['/data/data/com.termux/files/usr/bin/bash', '-c', wrapped_cmd],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=workdir if workdir and os.path.isdir(workdir) else None,
                env=env,
                preexec_fn=os.setsid
            )

            # 注册到运行中命令追踪，供 /cancel 端点使用
            if cmd_id:
                with RUNNING_LOCK:
                    RUNNING_COMMANDS[cmd_id] = proc

            # 用 IO 轮询等待子进程完成，避免后台被冻结
            deadline = time.time() + timeout
            while True:
                ret = proc.poll()
                if ret is not None:
                    break
                remaining = deadline - time.time()
                if remaining <= 0:
                    # 超时
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except Exception:
                        proc.kill()
                    proc.wait()
                    stdout = proc.stdout.read().decode('utf-8', errors='replace')
                    self._send_json(200, {
                        'exitCode': -1,
                        'output': '命令执行超时（{}秒），已终止\n{}'.format(timeout, stdout)
                    })
                    return
                # 关键：用 IO 等待代替 time.sleep，避免被冻结
                io_sleep(min(0.5, remaining))

            stdout = proc.stdout.read().decode('utf-8', errors='replace')
            exit_code = proc.returncode

            if len(stdout) > MAX_OUTPUT:
                stdout = stdout[:MAX_OUTPUT] + '\n\n...（输出已截断）'

            self._send_json(200, {
                'exitCode': exit_code,
                'output': stdout
            })

        except Exception as e:
            self._send_json(500, {'error': str(e)})
        finally:
            if cmd_id:
                with RUNNING_LOCK:
                    RUNNING_COMMANDS.pop(cmd_id, None)

    def _handle_cancel(self):
        """取消指定命令的子进程"""
        body = self._read_body()
        try:
            req = json.loads(body)
            cmd_id = req.get('cmd_id')
        except (json.JSONDecodeError, TypeError):
            self._send_json(400, {'error': 'invalid request'})
            return

        if not cmd_id:
            self._send_json(400, {'error': 'missing cmd_id'})
            return

        with RUNNING_LOCK:
            proc = RUNNING_COMMANDS.get(cmd_id)

        if proc and proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                self._send_json(200, {'cancelled': True})
            except ProcessLookupError:
                self._send_json(200, {'cancelled': False, 'reason': 'already finished'})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
        else:
            self._send_json(200, {'cancelled': False, 'reason': 'not running'})


def graceful_shutdown(signum, frame):
    os._exit(0)


def acquire_wake_lock():
    """持有 termux-wake-lock，防止进程被系统冻结"""
    try:
        subprocess.run(
            ['/data/data/com.termux/files/usr/bin/termux-wake-lock', 'bluox-server'],
            timeout=5, capture_output=True
        )
    except Exception:
        pass  # termux-api 未安装时静默忽略


def release_wake_lock():
    """释放 wake lock"""
    try:
        subprocess.run(
            ['/data/data/com.termux/files/usr/bin/termux-wake-lock', 'release', 'bluox-server'],
            timeout=5, capture_output=True
        )
    except Exception:
        pass


START_TIME = time.time()

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, graceful_shutdown)
    signal.signal(signal.SIGINT, graceful_shutdown)

    # 持锁防冻结
    acquire_wake_lock()

    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), CommandHandler)
    server.daemon_threads = True

    print(f'Termux 命令服务器已启动')
    print(f'PID: {os.getpid()}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        graceful_shutdown(None, None)
    finally:
        release_wake_lock()