# Web App Recipes

Reusable patterns from VoiceFlow, QuoteFiller, and PaymentCalc. Battle-tested, copy-paste ready.

---

## 1. Free Static Hosting (GitHub Pages)

Host any single-page HTML app for free. No server, no build step.

```bash
cd my-project
git init
echo ".DS_Store" > .gitignore
git add -A
git commit -m "initial commit"
gh repo create MY-ORG/my-app --public --source=. --push
```

Enable Pages via CLI (no clicking through Settings):

```bash
gh api repos/MY-ORG/my-app/pages -X POST --input - <<'EOF'
{"source":{"branch":"master","path":"/"}}
EOF
```

Live at `https://MY-ORG.github.io/my-app/` within 1-2 minutes.

---

## 2. PIN Lock Screen (universal, consistent across apps)

Full-screen overlay that gates the entire app. PIN stored in localStorage — enter once per browser, persists indefinitely.

### HTML (right after `<body>`)

```html
<div id="pin-lock" class="fixed inset-0 bg-zinc-950 z-[9999] flex items-center justify-center">
    <div class="text-center">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600/10 flex items-center justify-center mx-auto mb-4">
            <i class="fa-solid fa-lock text-2xl text-indigo-400"></i>
        </div>
        <h2 class="text-lg font-semibold text-white mb-1">My App</h2>
        <p id="pin-subtitle" class="text-xs text-zinc-500 mb-6">Enter PIN to continue</p>
        <input id="pin-input" type="password" placeholder="PIN" autofocus
               class="w-48 text-center tracking-widest bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
               onkeydown="if(event.key==='Enter')unlockApp()">
        <br>
        <button onclick="unlockApp()" class="mt-3 bg-white text-black font-semibold px-8 py-2 rounded-xl text-sm hover:bg-zinc-200 transition-colors">UNLOCK</button>
        <p id="pin-error" class="hidden text-red-400 text-xs mt-3">Wrong PIN</p>
    </div>
</div>
```

### JavaScript

```javascript
const PIN_KEY = 'my_app_access_pin'; // unique per app to avoid collisions

function unlockApp() {
    const pin = document.getElementById('pin-input').value.trim();
    if (!pin) return;
    const stored = localStorage.getItem(PIN_KEY);
    if (stored && pin === stored) {
        document.getElementById('pin-lock').classList.add('hidden');
        init(); // boot your app
    } else if (!stored) {
        localStorage.setItem(PIN_KEY, pin);
        document.getElementById('pin-lock').classList.add('hidden');
        init();
    } else {
        document.getElementById('pin-error').classList.remove('hidden');
        document.getElementById('pin-input').value = '';
        setTimeout(() => document.getElementById('pin-error').classList.add('hidden'), 2000);
    }
}

// Auto-unlock if PIN already stored (returning user on same browser)
if (localStorage.getItem(PIN_KEY)) {
    document.getElementById('pin-lock').classList.add('hidden');
    init();
} else {
    document.getElementById('pin-subtitle').textContent = 'Choose a PIN (first time setup)';
}
```

### Key facts

- `localStorage` persists indefinitely — survives tab closes, browser restarts, OS restarts
- Only wiped if user manually clears "Cookies and site data" for the site
- Each app uses a unique key (`access_pin`, `qf_access_pin`, `pc_access_pin`) so they don't collide
- PIN is also sent as `X-Pin` header to the Cloudflare Worker for server-side auth

---

## 3. Cloudflare Worker — Multi-API Proxy + KV Storage

One Worker handles everything: PIN auth, multi-API proxying (xAI, Groq, etc.), and cloud backup via KV.

### Worker code (`worker/index.js`)

```javascript
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
        },
      });
    }

    // PIN auth — every request must include X-Pin header
    const pin = request.headers.get('X-Pin') || '';
    if (pin !== env.ACCESS_PIN) {
      return new Response(JSON.stringify({ error: 'Invalid PIN' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    // ── KV backup: save ──
    if (pathname.startsWith('/kv/') && request.method === 'POST') {
      const key = pathname.slice('/kv/'.length);
      if (!key) return new Response('{"error":"no key"}', { status: 400, headers: cors });
      await env.KV.put(key, await request.text());
      return new Response('{"ok":true}', { headers: cors });
    }

    // ── KV backup: load ──
    if (pathname.startsWith('/kv/') && request.method === 'GET') {
      const key = pathname.slice('/kv/'.length);
      if (!key) return new Response('{"error":"no key"}', { status: 400, headers: cors });
      const data = await env.KV.get(key);
      if (data === null) return new Response('null', { headers: cors });
      return new Response(data, { headers: cors });
    }

    // ── API proxy (add more APIs by adding more if-blocks) ──
    let targetUrl, auth;

    if (pathname.startsWith('/groq/')) {
      targetUrl = 'https://api.groq.com/openai/v1/' + pathname.slice('/groq/'.length);
      auth = 'Bearer ' + env.GROQ_KEY;
    } else if (pathname.startsWith('/xai/')) {
      targetUrl = 'https://api.x.ai/v1/' + pathname.slice('/xai/'.length);
      auth = 'Bearer ' + env.XAI_KEY;
    } else if (pathname.startsWith('/gemini/')) {
      // Google AI (Gemini) uses ?key= on the URL — not Bearer. Path after /gemini/ is e.g. models/gemini-1.5-flash:generateContent
      const path = pathname.slice('/gemini/'.length);
      const u = new URL('https://generativelanguage.googleapis.com/v1beta/' + path);
      u.searchParams.set('key', env.GEMINI_KEY);
      targetUrl = u.toString();
      auth = null;
    } else {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const body = request.method === 'POST' ? await request.text() : undefined;
    const headers = auth ? { 'Authorization': auth } : {};
    const ct = request.headers.get('Content-Type');
    if (ct) headers['Content-Type'] = ct;

    const response = await fetch(targetUrl, { method: request.method, headers, body });
    const rh = new Headers(response.headers);
    rh.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, headers: rh });
  },
};
```

### Config (`worker/wrangler.toml`)

```toml
name = "my-proxy"
main = "index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"
```

### Deploy

```bash
cd worker
npx wrangler login                              # one-time
npx wrangler kv namespace create KV             # creates KV store, gives you the ID
# paste the ID into wrangler.toml
npx wrangler deploy                             # deploy Worker
echo "your-pin"    | npx wrangler secret put ACCESS_PIN
echo "sk-xai-..." | npx wrangler secret put XAI_KEY
echo "gsk_..."    | npx wrangler secret put GROQ_KEY
# Optional — game-plan “Gemini” option in the app hits `/gemini/...` on this worker:
# echo "AIza..." | npx wrangler secret put GEMINI_KEY
```

### Adding a new API

Just add another `if` block in the Worker:

```javascript
} else if (pathname.startsWith('/openai/')) {
  targetUrl = 'https://api.openai.com/v1/' + pathname.slice('/openai/'.length);
  auth = 'Bearer ' + env.OPENAI_KEY;
}
```

Then set the secret: `echo "sk-..." | npx wrangler secret put OPENAI_KEY`

| API | Prefix | Target |
|---|---|---|
| xAI (Grok) | `/xai/` | `https://api.x.ai/v1/` |
| Groq (Whisper) | `/groq/` | `https://api.groq.com/openai/v1/` |
| OpenAI | `/openai/` | `https://api.openai.com/v1/` |
| Anthropic | `/claude/` | `https://api.anthropic.com/v1/` |
| Gemini | `/gemini/` | `https://generativelanguage.googleapis.com/v1beta/` |

---

## 4. Cloud Sync with Timestamp Comparison

Auto-save app data to Cloudflare KV on every change. On startup, compare timestamps to always use the newest version — whether it came from this device or another.

### Building the backup payload

```javascript
async function buildBackupData() {
    const lsData = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('myapp_')) lsData[k] = localStorage.getItem(k);
    }
    return {
        version: 2,
        exportedAt: new Date().toISOString(),  // critical for comparison
        localStorage: lsData,
    };
}
```

### Auto-save on every localStorage write

```javascript
const CLOUD_URL = 'https://my-proxy.myaccount.workers.dev';
function getPin() { return localStorage.getItem('myapp_access_pin') || ''; }

const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(k, v) {
    _origSetItem(k, v);
    if (k.startsWith('myapp_')) scheduleCloudSave();
};

let _cloudTimer = null;
function scheduleCloudSave() {
    clearTimeout(_cloudTimer);
    _cloudTimer = setTimeout(async () => {
        try {
            const backup = await buildBackupData();
            await fetch(CLOUD_URL + '/kv/myapp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Pin': getPin() },
                body: JSON.stringify(backup),
            });
            _origSetItem('myapp_last_sync', String(new Date(backup.exportedAt).getTime()));
        } catch (e) { console.warn('Cloud save failed:', e); }
    }, 2000);  // debounce 2s to batch rapid changes
}
```

### Smart load: always use the newer version

```javascript
async function loadFromCloud(force) {
    try {
        const res = await fetch(CLOUD_URL + '/kv/myapp', {
            headers: { 'X-Pin': getPin() },
        });
        if (!res.ok) return false;
        const backup = JSON.parse(await res.text());
        if (!backup || !backup.localStorage) return false;

        // Skip if local is already up-to-date (unless force=true for fresh browsers)
        if (!force) {
            const cloudTime = backup.exportedAt ? new Date(backup.exportedAt).getTime() : 0;
            const localTime = Number(localStorage.getItem('myapp_last_sync') || 0);
            if (localTime >= cloudTime) return false;
        }

        // Apply cloud data using _origSetItem to avoid re-triggering cloud save
        Object.entries(backup.localStorage).forEach(([k, v]) => _origSetItem(k, v));
        if (backup.exportedAt) {
            _origSetItem('myapp_last_sync', String(new Date(backup.exportedAt).getTime()));
        }
        return true;
    } catch (e) { console.warn('Cloud load failed:', e); return false; }
}
```

### Init: check cloud every time

```javascript
async function init() {
    const hasLocal = localStorage.getItem('myapp_data');
    try {
        const loaded = await loadFromCloud(!hasLocal);
        if (loaded) showToast(hasLocal ? 'Updated from cloud' : 'Data restored from cloud');
        else if (!hasLocal) showToast('No cloud data yet — start fresh');
    } catch (e) {
        if (!hasLocal) showToast('Offline — start fresh');
    }
    // ... rest of init
}
```

### Key facts

- `_origSetItem` is used when writing cloud data to local to avoid an infinite save loop
- `exportedAt` in the backup payload is the timestamp used for comparison
- `qf_last_sync` tracks when local data was last synced — compared against cloud's `exportedAt`
- Debounce (2s) prevents hammering KV on rapid edits
- Also fires on `visibilitychange` (tab hidden) and `pagehide` (tab closing) as safety net

---

## 5. Full Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (GitHub Pages)                         │
│                                                 │
│  PIN stored in localStorage (per app)           │
│  ↓                                              │
│  Every API call includes X-Pin header           │
│  Every data change → scheduleCloudSave()        │
│  Every page load → loadFromCloud() + compare    │
└───────────────────┬─────────────────────────────┘
                    │ HTTPS
                    ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare Worker (free tier)                  │
│                                                 │
│  1. Check X-Pin vs env.ACCESS_PIN               │
│  2. Route by path prefix:                       │
│     /xai/*   → api.x.ai     (env.XAI_KEY)      │
│     /groq/*  → api.groq.com (env.GROQ_KEY)     │
│     /kv/*    → KV get/put   (cloud backup)      │
│  3. Inject Authorization header server-side     │
│  4. Return response with CORS headers           │
└─────────────────────────────────────────────────┘

Secrets (never in browser):
  ACCESS_PIN, XAI_KEY, GROQ_KEY → wrangler secret put

Data flow:
  Browser ←→ Worker ←→ AI APIs (xAI, Groq)
  Browser ←→ Worker ←→ Cloudflare KV (backup)
```

---

## 6. Useful `gh` CLI Commands

```bash
# Create repo and push in one shot
gh repo create MY-ORG/my-app --public --source=. --push

# Enable GitHub Pages without clicking through Settings UI
gh api repos/MY-ORG/my-app/pages -X POST --input - <<'EOF'
{"source":{"branch":"master","path":"/"}}
EOF

# Check Pages deployment status
gh api repos/MY-ORG/my-app/pages

# View repo in browser
gh repo view MY-ORG/my-app --web
```

---

## Quick Reference

| What | Tool | Cost |
|---|---|---|
| Static hosting | GitHub Pages | Free |
| API proxy + KV storage | Cloudflare Workers | Free (100k req/day) |
| Secret storage (API keys) | `wrangler secret put` | Free |
| Cloud data backup | Cloudflare KV | Free (1k writes/day, 100k reads/day) |
| Repo + Pages setup | `gh` CLI | Free |

| App | GitHub Pages URL | PIN key |
|---|---|---|
| VoiceFlow | `studiosaints.github.io/voiceflow/` | `access_pin` |
| QuoteFiller | `studiosaints.github.io/quotefiller/` | `qf_access_pin` |
| PaymentCalc | `studiosaints.github.io/payment-calc/` | `pc_access_pin` |
