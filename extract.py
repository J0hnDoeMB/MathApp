#!/usr/bin/env python
"""extract.py — estrae testo da un PDF. Legge base64 (o path) da argv/stdin e stampa JSON.

Uso:  python extract.py <file.pdf>
      type base64.txt | python extract.py
Output: {"ok": true, "text": "...", "pages": N}  oppure  {"ok": false, "error": "..."}
"""
from __future__ import annotations

import base64
import io
import json
import sys

# Windows: la console usa cp1252 e non sa scrivere '●', '²', lettere accentate...
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

MAX_CHARS = 60000


def out(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False))


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        if arg:
            with open(arg, "rb") as f:
                raw = f.read()
        else:
            data = sys.stdin.read().strip()
            raw = base64.b64decode(data)
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"lettura non riuscita: {e}"})
        return

    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        chunks, truncated = [], False
        for i, page in enumerate(reader.pages):
            try:
                chunks.append(f"--- pagina {i + 1} ---\n" + (page.extract_text() or ""))
            except Exception as e:  # noqa: BLE001
                chunks.append(f"--- pagina {i + 1}: estrazione non riuscita ({e}) ---")
            if sum(len(c) for c in chunks) > MAX_CHARS:
                truncated = True
                break
        text = "\n".join(chunks).strip()
        if truncated:
            text += "\n\n[...troncato: PDF troppo lungo...]"
        if not text:
            out({"ok": False, "error": "nessun testo estraibile (PDF scansionato come immagine?)"})
            return
        out({"ok": True, "text": text, "pages": len(reader.pages), "truncated": truncated})
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
