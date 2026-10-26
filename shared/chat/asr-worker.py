import base64
import contextlib
import json
import os
import sys
import traceback

def send(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

try:
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import torch
        from funasr import AutoModel
        import sentencepiece as spm
        from pathlib import Path
        from funasr.register import tables
        from funasr.tokenizer.sentencepiece_tokenizer import SentencepiecesTokenizer
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        # SentencePiece's native file opener fails on some Windows Unicode paths.
        # Python can open them; pass the serialized model directly to the library.
        class PetLocalTokenizer(SentencepiecesTokenizer):
            def _build_sentence_piece_processor(self):
                if self.sp is None:
                    self.sp = spm.SentencePieceProcessor(model_proto=Path(self.bpemodel).read_bytes())
        tables.register('tokenizer_classes', 'PetLocalTokenizer')(PetLocalTokenizer)
        torch.set_num_threads(4)
        model = AutoModel(model=sys.argv[1], device='cpu', ncpu=4,
                          tokenizer='PetLocalTokenizer',
                          disable_update=True, disable_pbar=True,
                          trust_remote_code=False)
        # Prepare kernels before opening the microphone; no speech is sent online.
        model.generate(input=np.zeros(16000, dtype=np.float32), language='zh', use_itn=True)
    send({'ready': True})
except Exception as error:
    traceback.print_exc(file=sys.stderr)
    send({'error': '本地语音识别模型加载失败：' + str(error)[:200]})
    sys.exit(1)

for line in sys.stdin:
    try:
        request = json.loads(line)
        raw = base64.b64decode(request['audio'], validate=True)
        if not 6400 <= len(raw) <= 16000 * 2 * 21 or len(raw) % 2:
            raise ValueError('录音长度无效。')
        samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        with contextlib.redirect_stdout(sys.stderr):
            result = model.generate(input=samples, language='zh', use_itn=True,
                                    batch_size_s=30, disable_pbar=True)
        text = ''.join(rich_transcription_postprocess(item.get('text', '')) for item in result).strip()
        send({'id': request['id'], 'text': text})
    except Exception as error:
        send({'id': request.get('id') if isinstance(locals().get('request'), dict) else None,
              'error': '本地语音识别失败：' + str(error)[:200]})
