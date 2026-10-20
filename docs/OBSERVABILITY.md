# Observability

MathApp produce un trace JSONL locale in `logs/trace.jsonl` (2 MB, poi `trace.jsonl.1`). Non registra il contenuto dei messaggi o le chiavi: solo metadata operativi.

## Request

Ogni richiesta riceve un `X-Request-Id` (`req_...`). Al completamento di una chiamata `/api/*` viene scritto:

```json
{ "ts": "...", "event": "http", "id": "req_...", "method": "POST", "path": "/api/chat", "status": 200, "ms": 123 }
```

## Operazioni

`lib/observability.mjs`:

```text
newId(prefix)
trace(event, data)
startOperation(name, meta) -> { id, end(extra) }
recent(limit)
```

- `executeChat` apre `chat` e chiude `op.end` con convId/modello o cancellazione.
- Ogni tool call apre `tool.<name>` con `traceId` della chat e chiude con ok/errore.
- Gli adapter portano il proprio errore strutturato al chiamante; il dominio non perde il fault.

## Diagnosi

- `GET /api/traces?limit=50` restituisce gli ultimi eventi (solo locale).
- `/api/diagnostics` / `/api/health` restano il check di capability e storage.
- `mathapp.log` resta il log testuale degli errori; `logs/trace.jsonl` ? il flusso strutturato.

## Regole

1. Niente contenuti utente, prompt, chiavi o path personali nel trace.
2. ID brevi e correlabili: request -> chat -> tool.
3. Un errore di trace non deve mai bloccare l'app.
4. La retention ? gestita dalla rotazione a 2 MB; i dettagli di dominio restano nei log esistenti.
