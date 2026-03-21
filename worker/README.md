# voiceflow-proxy (Cloudflare Worker)

Deploy from **this folder** (not your home directory — avoids Wrangler permission weirdness on macOS).

## One-time setup

```bash
cd "/path/to/voiceflow/worker"
npm install
npx wrangler login
```

### KV namespace

If `wrangler.toml` still has `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`:

```bash
npx wrangler kv namespace create KV
```

Copy the id into `wrangler.toml`, or if you already have a KV for this worker, use **Workers & Pages → voiceflow-proxy → Settings → Variables → KV** and copy the namespace id.

### Secrets (never commit these)

```bash
echo 'YOUR_PIN' | npx wrangler secret put ACCESS_PIN
echo 'YOUR_XAI_KEY' | npx wrangler secret put XAI_KEY
echo 'YOUR_GROQ_KEY' | npx wrangler secret put GROQ_KEY
echo 'YOUR_GEMINI_KEY' | npx wrangler secret put GEMINI_KEY
```

## Deploy

```bash
npx wrangler deploy
```

## Troubleshooting

- **Required Worker name missing** — run `npx wrangler deploy` from the folder that contains `wrangler.toml` (this `worker/` directory).
- **Permission error … .Trash** — don’t run Wrangler from `~`; `cd` into this project folder first.
- **KV errors** — fix the `id` in `wrangler.toml` to match your real namespace.
