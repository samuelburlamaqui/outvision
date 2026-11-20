// worker/index.js
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/config.js") {
      const cfg = env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? { supabaseUrl: String(env.SUPABASE_URL).trim().replace(/\/+$/, ""), supabaseKey: String(env.SUPABASE_ANON_KEY).trim() } : null;
      return new Response(`window.RADAR_CONFIG = ${JSON.stringify(cfg)};
`, {
        headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }
      });
    }
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
