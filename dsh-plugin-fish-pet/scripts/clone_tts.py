#!/usr/bin/env python3
"""
桌宠本地声音克隆助手（免费、全离线）。

两个子命令：
  prepare     输入视频/音频 → 抽取参考音频 + 自动识别参考文本
  synthesize  用参考音频克隆音色，朗读任意文本

依赖（需用户自行 pip 安装，见 README）：
  sherpa-onnx numpy imageio-ffmpeg

模型目录下需要：
  sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/   （克隆 TTS，约 105MB）
  vocos_24khz.onnx                                  （声码器，约 52MB）
  sherpa-onnx-sense-voice-...-int8-.../             （可选，用于自动识别参考文本）

本脚本只做纯计算，不联网、不读取用户其他数据。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

# 参考音频目标格式：ZipVoice 用 24kHz 单声道
TARGET_SR = 24000
# 参考音频有效时长区间（秒）：太短克隆不出音色，太长没必要
MIN_SEC = 3.0
MAX_SEC = 20.0


def die(code, message):
    """统一错误输出：JSON 到 stdout，便于宿主解析。"""
    print(json.dumps({"ok": False, "code": code, "message": message}, ensure_ascii=False))
    sys.exit(0)


def read_wav(path):
    import numpy as np
    with wave.open(path, "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def write_wav(path, samples, sr):
    import numpy as np
    arr = np.asarray(samples, dtype=np.float32)
    arr = np.clip(arr, -1.0, 1.0)
    pcm = (arr * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return len(pcm) * 2


def find_ffmpeg():
    """优先用 imageio-ffmpeg 自带的静态 ffmpeg（系统通常没有）。"""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    for name in ("ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        try:
            subprocess.run([name, "-version"], capture_output=True, check=True)
            return name
        except Exception:
            continue
    return None


def extract_audio(src, dst):
    """把任意媒体转成 24kHz 单声道 16bit wav。"""
    ff = find_ffmpeg()
    if not ff:
        die("NO_FFMPEG", "找不到 ffmpeg，请先 pip install imageio-ffmpeg")
    cmd = [
        ff, "-y", "-i", src,
        "-vn",                      # 丢掉视频轨
        "-ac", "1",                 # 单声道
        "-ar", str(TARGET_SR),      # 24kHz
        "-t", str(MAX_SEC),         # 最多取 20 秒
        "-af", "highpass=f=60,lowpass=f=8000",  # 去低频轰鸣与高频噪声
        dst,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) == 0:
        tail = (r.stderr or "").strip().splitlines()[-3:]
        die("EXTRACT_FAILED", "音频抽取失败：" + " | ".join(tail))


def load_zipvoice(model_dir, vocoder):
    import sherpa_onnx
    zv = os.path.join(model_dir, "sherpa-onnx-zipvoice-distill-int8-zh-en-emilia")
    if not os.path.isdir(zv):
        die("NO_MODEL", "缺少克隆模型目录：" + zv)
    if not os.path.isfile(vocoder):
        die("NO_VOCODER", "缺少声码器文件：" + vocoder)
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            zipvoice=sherpa_onnx.OfflineTtsZipvoiceModelConfig(
                tokens=os.path.join(zv, "tokens.txt"),
                encoder=os.path.join(zv, "encoder.int8.onnx"),
                decoder=os.path.join(zv, "decoder.int8.onnx"),
                vocoder=vocoder,
                data_dir=os.path.join(zv, "espeak-ng-data"),
                lexicon=os.path.join(zv, "lexicon.txt"),
            ),
            num_threads=int(os.environ.get("CLONE_THREADS", "4")),
            provider="cpu",
        ),
    )
    if not cfg.validate():
        die("BAD_CONFIG", "克隆模型配置校验失败")
    return sherpa_onnx.OfflineTts(cfg)


def transcribe(model_dir, wav_path):
    """用 SenseVoice 识别参考音频内容；模型缺失则返回空串（由调用方决定怎么办）。"""
    import glob
    import sherpa_onnx
    cands = sorted(glob.glob(os.path.join(model_dir, "sherpa-onnx-sense-voice*")))
    if not cands:
        return ""
    d = cands[-1]
    model = os.path.join(d, "model.int8.onnx")
    tokens = os.path.join(d, "tokens.txt")
    if not (os.path.isfile(model) and os.path.isfile(tokens)):
        return ""
    rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=model, tokens=tokens,
        num_threads=int(os.environ.get("CLONE_THREADS", "4")),
        use_itn=True, language="zh",
    )
    a, sr = read_wav(wav_path)
    s = rec.create_stream()
    s.accept_waveform(sr, a)
    rec.decode_stream(s)
    return (s.result.text or "").strip()


def cmd_prepare(args):
    out_wav = args.out_wav
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    try:
        extract_audio(args.input, tmp)
        a, sr = read_wav(tmp)
        dur = len(a) / sr
        if dur < MIN_SEC:
            die("AUDIO_TOO_SHORT", f"有效音频只有 {dur:.1f} 秒，至少需要 {MIN_SEC:.0f} 秒")
        # 居中截取，避免开头空白或结尾静音
        if dur > MAX_SEC:
            start = int((dur - MAX_SEC) / 2 * sr)
            a = a[start:start + int(MAX_SEC * sr)]
            dur = len(a) / sr
        size = write_wav(out_wav, a, sr)
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass

    text = args.text.strip() if args.text else ""
    source = "user"
    if not text:
        text = transcribe(args.model_dir, out_wav)
        source = "asr" if text else "none"

    print(json.dumps({
        "ok": True,
        "wav": out_wav,
        "text": text,
        "textSource": source,
        "duration": round(dur, 2),
        "bytes": size,
    }, ensure_ascii=False))


def cmd_synthesize(args):
    text = (args.text or "").strip()
    if not text:
        die("EMPTY_TEXT", "文本为空")
    if not os.path.isfile(args.ref_wav):
        die("NO_REFERENCE", "参考音频不存在")
    ref_text = (args.ref_text or "").strip()
    if not ref_text:
        die("NO_REFERENCE_TEXT", "缺少参考文本，克隆需要参考音频对应的文字")

    import sherpa_onnx
    tts = load_zipvoice(args.model_dir, args.vocoder)
    ref, sr = read_wav(args.ref_wav)
    g = sherpa_onnx.GenerationConfig()
    g.reference_audio = ref
    g.reference_sample_rate = sr
    g.reference_text = ref_text
    g.num_steps = int(args.steps)
    audio = tts.generate(text, g)
    if len(audio.samples) == 0:
        die("EMPTY_AUDIO", "合成结果为空，请检查参考音频与文本是否匹配")
    size = write_wav(args.out_wav, audio.samples, audio.sample_rate)
    print(json.dumps({
        "ok": True,
        "wav": args.out_wav,
        "bytes": size,
        "duration": round(len(audio.samples) / audio.sample_rate, 2),
    }, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("prepare")
    pp.add_argument("--input", required=True)
    pp.add_argument("--out-wav", required=True)
    pp.add_argument("--model-dir", required=True)
    pp.add_argument("--text", default="")
    pp.set_defaults(func=cmd_prepare)

    ps = sub.add_parser("synthesize")
    ps.add_argument("--text", required=True)
    ps.add_argument("--ref-wav", required=True)
    ps.add_argument("--ref-text", required=True)
    ps.add_argument("--out-wav", required=True)
    ps.add_argument("--model-dir", required=True)
    ps.add_argument("--vocoder", required=True)
    ps.add_argument("--steps", default="4")
    ps.set_defaults(func=cmd_synthesize)

    args = p.parse_args()
    try:
        args.func(args)
    except SystemExit:
        raise
    except Exception as e:
        die("UNEXPECTED", f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
