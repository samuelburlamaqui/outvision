// Atende o que não é arquivo estático:
// - /config.js: entrega as chaves PÚBLICAS do Supabase, lidas das variáveis do Worker
//   (Settings > Variables and Secrets: SUPABASE_URL e SUPABASE_ANON_KEY);
// - qualquer outro endereço: devolve a página inicial do site.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/config.js") {
      const cfg = env.SUPABASE_URL && env.SUPABASE_ANON_KEY
        ? { supabaseUrl: String(env.SUPABASE_URL).trim().replace(/\/+$/, ""), supabaseKey: String(env.SUPABASE_ANON_KEY).trim() }
        : null;
      return new Response(`window.RADAR_CONFIG = ${JSON.stringify(cfg)};\n`, {
        headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  },
};
