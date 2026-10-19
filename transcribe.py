#!/usr/bin/env python
"""transcribe.py — trascrizione audio LOCALE con faster-whisper (open source, offline).

Uso:
  python transcribe.py <file_audio|-> [modello] [lingua]
  python transcribe.py --worker [modello] [lingua]

Stampa un JSON: {ok, text, language, language_probability, duration, model, segments}

La lingua default e' l'italiano ("it"); usa "auto" per il rilevamento automatico.
Con --worker il processo resta in ascolto: una richiesta JSON per riga su stdin
({"id": N, "b64": "..."} oppure {"cmd": "exit"}), una risposta JSON per riga su
stdout con lo stesso "id". Cosi' il modello si carica una volta sola.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "small")
DEFAULT_LANG = os.environ.get("WHISPER_LANG", "it")

# Contesto e termini matematici: migliorano punteggiatura, maiuscole e lessico.
INITIAL_PROMPT = (
    "Lezione di matematica in italiano. Lo studente detta una domanda su derivate, "
    "integrali, limiti, funzioni, equazioni, disequazioni, geometria e algebra. "
    "Scrivi con la punteggiatura corretta e i termini tecnici giusti."
)
HOTWORDS = (
    "derivata, integrale, limite, teorema, funzione, equazione, disequazione, "
    "geometria, algebra, valor medio, Lagrange, seno, coseno, tangente, "
    "parabola, retta, piano, vettore, matrice"
)


def _load_model(model_name):
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(2, (os.cpu_count() or 4) - 1),
    )


def _language(value):
    lang = str(value or "").strip().lower()
    return None if lang in ("", "auto", "none") else lang


def _decode_audio(b64):
    raw = base64.b64decode(b64)
    fd, tmp_path = tempfile.mkstemp(suffix=".bin")
    os.close(fd)
    with open(tmp_path, "wb") as f:
        f.write(raw)
    return tmp_path


def _transcribe_file(model, path, lang):
    segments, info = model.transcribe(
        path,
        language=_language(lang),
        vad_filter=True,
        beam_size=1,
        without_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPT,
        hotwords=HOTWORDS,
    )
    segs = []
    parts = []
    for s in segments:
        parts.append(s.text)
        segs.append({"start": round(s.start, 1), "end": round(s.end, 1), "text": s.text.strip()})
    return {
        "ok": True,
        "text": "".join(parts).strip(),
        "language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0) or 0), 3),
        "duration": round(float(getattr(info, "duration", 0) or 0), 1),
        "segments": segs,
    }


def transcribe_b64(model, b64, lang):
    tmp_path = None
    try:
        tmp_path = _decode_audio(b64)
        return _transcribe_file(model, tmp_path, lang)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:  # noqa: BLE001
                pass


def run_worker(model_name, lang):
    try:
        model = _load_model(model_name)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"caricamento modello: {type(e).__name__}: {e}"}), flush=True)
        return
    print(json.dumps({"ok": True, "ready": True, "model": model_name, "language": _language(lang) or "auto"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:  # noqa: BLE001
            continue
        if req.get("cmd") == "exit":
            break
        result = transcribe_b64(model, str(req.get("b64") or ""), lang)
        result["id"] = req.get("id")
        result["model"] = model_name
        print(json.dumps(result, ensure_ascii=False), flush=True)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        model_name = (sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL) or DEFAULT_MODEL
        lang = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_LANG
        run_worker(model_name, lang)
        return

    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    model_name = (sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL) or DEFAULT_MODEL
    lang = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_LANG

    tmp_path = None
    try:
        if arg == "-":
            data = sys.stdin.read().strip()
            tmp_path = _decode_audio(data)
            path = tmp_path
        else:
            path = arg
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"input non valido: {e}"}))
        return

    try:
        model = _load_model(model_name)
        result = _transcribe_file(model, path, lang)
        result["model"] = model_name
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
