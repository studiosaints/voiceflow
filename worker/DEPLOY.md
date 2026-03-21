# Fix “404 / non-JSON” for Gemini

That error means **the request never reaches Google** — the Worker at `voiceflow-proxy` is still an **old script** with no `/gemini/` branch (body is often plain `Not found`, which is not JSON).

## Option A — Wrangler (recommended)

1. In `wrangler.toml`, set the real **KV namespace id** (Workers → voiceflow-proxy → Settings → Variables → KV), not `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
2. From this folder:

   ```bash
   npx wrangler login
   npx wrangler deploy
   ```

Secrets (`ACCESS_PIN`, `XAI_KEY`, `GROQ_KEY`, `GEMINI_KEY`) stay on Cloudflare; they are not in this file.

## Option B — Dashboard (no local KV id)

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **voiceflow-proxy**.
2. **Quick edit** (or **Edit code**).
3. Replace the **entire** script with the contents of **`index.js`** from this folder (same file as in the repo).
4. **Save and deploy**.

Existing secrets and KV bindings on that Worker are unchanged; you are only updating script code.

## Verify

```bash
curl -sS -w "\nHTTP:%{http_code}\n" \
  -X POST "https://voiceflow-proxy.edoardosanti.workers.dev/gemini/models/gemini-1.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "X-Pin: YOUR_APP_PIN" \
  -d '{"contents":[{"parts":[{"text":"Reply with the word ok only."}]}]}'
```

You should see **JSON** (with `candidates` or a Google `error` object), not `Not found`, and HTTP **200** if the key and route are valid.
