# Web App Recipes

Reusable patterns from the VoiceFlow project. Copy-paste into any browser-based project.

---

## 1. Free Static Hosting (GitHub Pages)

Host any single-page HTML app for free. No server needed.

```bash
# In your project folder
git init
git add index.html .gitignore
git commit -m "initial commit"
gh repo create MY-APP --public --source=. --push
```

Then: **GitHub repo → Settings → Pages → Source: main → Save**

Live at `https://YOURUSERNAME.github.io/MY-APP/`

---

## 2. Cloudflare Worker — API Proxy (bypass CORS + hide keys)

Many APIs (xAI, OpenAI, Anthropic) block browser-side calls via CORS. A Worker proxies them server-side for free (100k req/day).

### Worker code (`worker/index.js`)

```javascript
export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Pin, Authorization',
        },
      });
    }

    // PIN auth — reject if wrong
    const pin = request.headers.get('X-Pin') || '';
    if (pin !== env.ACCESS_PIN) {
      return new Response(JSON.stringify({ error: 'Invalid PIN' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Rewrite path: /xai/chat/completions → /v1/chat/completions
    const url = new URL(request.url);
    const apiPath = url.pathname.replace(/^\/xai\//, '/v1/');
    const apiUrl = 'https://api.x.ai' + apiPath;

    // Use browser key if provided, otherwise fall back to stored secret
    const browserAuth = request.headers.get('Authorization');
    const auth = browserAuth || ('Bearer ' + env.API_KEY);

    const response = await fetch(apiUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
      },
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  },
};
```

### Config (`worker/wrangler.toml`)

```toml
name = "my-proxy"
main = "index.js"
compatibility_date = "2024-01-01"
```

### Deploy

```bash
cd worker
npx wrangler login          # one-time
npx wrangler deploy         # deploys to *.workers.dev

# Store secrets (never in code)
echo "sk-abc123" | npx wrangler secret put API_KEY
echo "mypin"     | npx wrangler secret put ACCESS_PIN
```

### Browser-side usage

```javascript
const PROXY = 'https://my-proxy.myaccount.workers.dev';
const PIN = 'mypin';

const res = await fetch(PROXY + '/xai/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Pin': PIN,
  },
  body: JSON.stringify({
    model: 'grok-4-1-fast-reasoning',
    messages: [{ role: 'user', content: 'Hello' }],
  }),
});
const data = await res.json();
```

### Adapting for other APIs

Change the rewrite rule and target URL:

| API | Target | Path rewrite |
|---|---|---|
| xAI | `https://api.x.ai` | `/xai/` → `/v1/` |
| OpenAI | `https://api.openai.com` | `/openai/` → `/v1/` |
| Anthropic | `https://api.anthropic.com` | `/claude/` → `/v1/` |

---

## 3. Touch ID / Passkey Auth (WebAuthn)

Store secrets (PIN, API keys) in the macOS Secure Enclave via a passkey. Survives browser data clears. Falls back to manual entry.

### Registration (one-time setup)

```javascript
async function registerTouchID(payload) {
  // payload = any string you want to store (JSON works)
  if (!window.PublicKeyCredential) return false;
  try {
    await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'My App', id: location.hostname },
        user: {
          id: new TextEncoder().encode(payload),
          name: 'app-user',
          displayName: 'My App',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // Touch ID / Face ID only
          residentKey: 'required',              // discoverable credential
          requireResidentKey: true,
          userVerification: 'required',         // biometric required
        },
        timeout: 60000,
      },
    });
    return true;
  } catch (e) {
    console.log('Registration skipped:', e.message);
    return false;
  }
}
```

### Authentication (every visit)

```javascript
async function tryTouchID() {
  if (!window.PublicKeyCredential) return null;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (assertion.response.userHandle) {
      return new TextDecoder().decode(assertion.response.userHandle);
    }
  } catch (e) {
    console.log('Touch ID skipped:', e.message);
  }
  return null;
}
```

### Storing multiple values

Pack them as JSON in the `user.id` during registration:

```javascript
// Registration
const secrets = JSON.stringify({ pin: '1234', groqKey: 'gsk_...', theme: 'dark' });
await registerTouchID(secrets);

// Authentication
const raw = await tryTouchID();
if (raw) {
  const secrets = JSON.parse(raw);
  console.log(secrets.pin, secrets.groqKey);
}
```

### Key facts

- Credential lives in the OS keychain (Secure Enclave on Mac)
- Survives browser data clears, cookie wipes, localStorage resets
- Tied to the domain (`rpId`) — `localhost` and `github.io` are separate
- Works on: macOS (Touch ID), iOS (Face ID), Windows (Hello), Android (fingerprint)
- `residentKey: 'required'` = discoverable = no need to store credential ID client-side

---

## 4. localStorage Config with Settings Modal

Simple pattern for persistent user settings with a modal UI.

### JavaScript

```javascript
// Load on startup
let API_KEY = localStorage.getItem('api_key') || '';
let SETTING_B = localStorage.getItem('setting_b') || 'default';

// Save
function saveSettings() {
  API_KEY = document.getElementById('api-key-input').value.trim();
  localStorage.setItem('api_key', API_KEY);
  closeModal();
}

// Auto-open on first visit
window.onload = () => {
  if (!API_KEY) openSettings();
};
```

### Persists until

- User clears browser data for the site
- Different browser / device / incognito
- Use Touch ID (recipe #3) to survive clears

---

## 5. Full Auth Flow (combining all recipes)

```
Page load
  │
  ├─ localStorage has PIN + keys? → use them, done
  │
  ├─ Try Touch ID → success? → restore PIN + keys from credential → done
  │
  └─ Neither? → show Settings modal → user enters PIN + keys
                    │
                    └─ "Enable Touch ID" button → registerTouchID(JSON)
                       → next visit: fingerprint unlocks everything
```

Browser talks to Cloudflare Worker with `X-Pin` header. Worker checks PIN, injects the real API key server-side, forwards to the AI API. No secrets in the browser, no CORS issues, works on any network.

---

## Quick Reference

| What | Tool | Cost |
|---|---|---|
| Static hosting | GitHub Pages | Free |
| API proxy | Cloudflare Workers | Free (100k req/day) |
| Secret storage | Wrangler secrets | Free |
| Biometric auth | WebAuthn (browser API) | Free |
| DNS + SSL | Cloudflare (auto) | Free |
