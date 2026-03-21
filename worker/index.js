/**
 * voiceflow-proxy — PIN auth, Groq + xAI + Gemini proxy, KV cheat sheet.
 * Deploy: from this folder, npx wrangler deploy
 */
export default {
  async fetch(request, env) {
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

    if (pathname.startsWith('/kv/') && request.method === 'POST') {
      const key = pathname.slice('/kv/'.length);
      if (!key) return new Response('{"error":"no key"}', { status: 400, headers: cors });
      await env.KV.put(key, await request.text());
      return new Response('{"ok":true}', { headers: cors });
    }

    if (pathname.startsWith('/kv/') && request.method === 'GET') {
      const key = pathname.slice('/kv/'.length);
      if (!key) return new Response('{"error":"no key"}', { status: 400, headers: cors });
      const data = await env.KV.get(key);
      if (data === null) return new Response('null', { headers: cors });
      return new Response(data, { headers: cors });
    }

    let targetUrl;
    let auth;

    if (pathname.startsWith('/groq/')) {
      targetUrl = 'https://api.groq.com/openai/v1/' + pathname.slice('/groq/'.length);
      auth = 'Bearer ' + env.GROQ_KEY;
    } else if (pathname.startsWith('/xai/')) {
      targetUrl = 'https://api.x.ai/v1/' + pathname.slice('/xai/'.length);
      auth = 'Bearer ' + env.XAI_KEY;
    } else if (pathname.startsWith('/gemini/')) {
      if (!env.GEMINI_KEY) {
        return new Response(
          JSON.stringify({ error: { message: 'GEMINI_KEY secret not set on worker' } }),
          { status: 500, headers: cors }
        );
      }
      const path = pathname.slice('/gemini/'.length);
      const u = new URL('https://generativelanguage.googleapis.com/v1beta/' + path);
      u.searchParams.set('key', env.GEMINI_KEY);
      targetUrl = u.toString();
      auth = null;
    } else {
      return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404, headers: cors });
    }

    const body = request.method === 'POST' ? await request.text() : undefined;
    const headers = auth ? { Authorization: auth } : {};
    const ct = request.headers.get('Content-Type');
    if (ct) headers['Content-Type'] = ct;
    else if (request.method === 'POST' && !auth) headers['Content-Type'] = 'application/json';

    const response = await fetch(targetUrl, { method: request.method, headers, body });
    const rh = new Headers(response.headers);
    rh.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, headers: rh });
  },
};
