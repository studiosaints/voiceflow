# voiceflow-proxy (Cloudflare Worker)

**Gemini 404 / “non-JSON”?** The live Worker still needs the `/gemini/` code deployed — see **[DEPLOY.md](./DEPLOY.md)** (CLI or paste `index.js` in the dashboard).

## One-time setup

1. **KV namespace id** — In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → **voiceflow-proxy** → Settings → **Variables** → find the KV binding and copy the namespace **ID**. Paste it into `wrangler.toml` instead of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

2. **Secrets** (already set if the app worked before):

   ```bash
   cd worker
   npx wrangler login
   echo "YOUR_PIN" | npx wrangler secret put ACCESS_PIN
   echo "sk-..." | npx wrangler secret put XAI_KEY
   echo "gsk_..." | npx wrangler secret put GROQ_KEY
   echo "AIza..." | npx wrangler secret put GEMINI_KEY
   ```

## Deploy (adds `/gemini/` route)

```bash
cd worker
npx wrangler deploy
```

After deploy, Gemini requests to `https://voiceflow-proxy.edoardosanti.workers.dev/gemini/models/...` return JSON from Google, not 404.
