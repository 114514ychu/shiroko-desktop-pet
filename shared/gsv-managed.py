"""Owned local inference worker. The pet controls lifetime and CPU recovery."""
import argparse
import gc
import json
import logging
import os
from pathlib import Path
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import Voice, ROOT

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=9881)
parser.add_argument('--device', choices=['auto', 'cpu'], default='auto')
parser.add_argument('--parent-pid', type=int, required=True)
args = parser.parse_args()
if args.device == 'cpu':
    # Hide CUDA before importing torch/GSV. Upstream chooses its attention
    # backend at import time; a CUDA-only kernel cannot execute CPU tensors.
    os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
token = os.environ.pop('SHIROKO_GSV_TOKEN')
lock = threading.Lock()
voice = None
loaded_variant = None


def load_variant(variant):
    global voice, loaded_variant
    if loaded_variant != variant or voice is None:
        # Keep only one voice in RAM/VRAM when changing outfits.
        voice = None
        loaded_variant = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        # The pet's spoken channel is Japanese. Chinese BERT contributes no
        # features to it and would download an extra ONNX model on CPU.
        voice = Voice(device=args.device, variant=variant, use_bert=False)
        loaded_variant = variant
    return voice


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Avoid writing conversation text or per-request URLs to logs.

    def respond(self, data, content_type='application/json', status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def authorized(self):
        if not secrets.compare_digest(self.headers.get('X-Local-Token', ''), token):
            self.respond(b'{"error":"Local token required"}', status=403)
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        if self.path != '/health':
            self.respond(b'{}', status=404)
            return
        self.respond(json.dumps({'engine': 'gsv-managed', 'busy': lock.locked(),
                                 'loaded': voice is not None,
                                 'device': voice.device if voice else 'auto'}).encode())

    def do_POST(self):
        if not self.authorized():
            return
        if self.path not in ('/prepare', '/synthesize'):
            self.respond(b'{}', status=404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 128000:
                raise ValueError('请求长度无效。')
            data = json.loads(self.rfile.read(length))
            variant = data.get('variant', 'default')
            if variant not in ('default', 'terror'):
                raise ValueError('音色无效。')
            text = data.get('text', '')
            language = data.get('language', 'ja')
            if self.path == '/synthesize' and (not isinstance(text, str) or not text.strip() or len(text) > 6000 or language not in ('ja', 'zh', 'en')):
                raise ValueError('请输入有效的日语、英语或中文。')
            with lock:
                current = load_variant(variant)
                if self.path == '/prepare':
                    self.respond(json.dumps({'ok': True, 'device': current.device}).encode())
                else:
                    handle, filename = tempfile.mkstemp(suffix='.wav', dir=ROOT / 'temp')
                    os.close(handle)
                    try:
                        current.synthesize(text, language, output=filename)
                        audio = Path(filename).read_bytes()
                        self.respond(audio, 'audio/wav')
                    finally:
                        Path(filename).unlink(missing_ok=True)
        except Exception as error:
            # Only explicit accelerator errors trigger process replacement on CPU.
            detail = str(error)
            cuda = any(word in detail.lower() for word in ('cuda', 'cudnn', 'cublas', 'nvidia driver'))
            logging.error('GSV operation failed: %s', type(error).__name__)
            self.respond(json.dumps({'error': detail, 'code': 'ECUDA' if cuda else 'EGSV'}, ensure_ascii=False).encode(), status=500)


def watch_parent():
    # Reclaim models even if the desktop app is killed or crashes.
    import ctypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.restype = ctypes.c_void_p
    handle = kernel.OpenProcess(0x00100000, False, args.parent_pid)
    if not handle:
        os._exit(0)
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
    os._exit(0)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    threading.Thread(target=watch_parent, daemon=True).start()
    print('GSV_MANAGED_READY', flush=True)
    server.serve_forever()
