"use strict";
/* radar de obras — app (admin e vendedores)
   Dados no Supabase; as regras de quem vê o quê estão no banco (Row Level Security).
   Telas: #todas (admin), #minhas (todos), #equipe (admin). */
(function () {
  // ------------------------------------------------------------ regras (espelho de pipeline/regras.py)
  const JANELAS = [
    { nome: "Apresentação / especificação", curto: "Apresentação", desc: "apresentar a representação e entrar na especificação", ini: 0, fim: 30, cor: "var(--apresentacao)" },
    { nome: "Vibra", curto: "Vibra", desc: "fios e cabos elétricos", ini: 30, fim: 65, cor: "var(--vibra)" },
    { nome: "Mohawk", curto: "Mohawk", desc: "pisos e revestimentos (Eliane)", ini: 50, fim: 85, cor: "var(--mohawk)" },
    { nome: "Lorenzetti", curto: "Lorenzetti", desc: "louças, metais e chuveiros", ini: 60, fim: 95, cor: "var(--lorenzetti)" },
    { nome: "Assa Abloy", curto: "Assa Abloy", desc: "fechaduras, ferragens e portas", ini: 70, fim: 100, cor: "var(--assa)" },
  ];
  const FASES = [[15, "Início / fundação"], [45, "Estrutura"], [70, "Alvenaria e instalações"], [95, "Acabamento"],
    [115, "Finalização"], [Infinity, "Provavelmente concluída"]];
  // "Todas as obras" (admin) = view obras_radar no banco: ativas, iniciadas desde 2023, qualquer área, sem infraestrutura
  const STATUS = [["nova", "Nova"], ["contato", "Contato feito"], ["visita", "Visita"], ["proposta", "Proposta"],
    ["fechada", "Fechada"], ["perdida", "Perdida"]];
  const STATUS_NOME = Object.fromEntries(STATUS);
  const QUALIF = { "0053": "Construtora", "0057": "Dono da obra", "0064": "Incorporador", "0070": "Proprietário do imóvel",
    "0109": "Consórcio", "0110": "Construção em nome coletivo", "0111": "Líder de consórcio" };
  const ICONE = { "Residencial multifamiliar": "predio", "Comercial salas e lojas": "loja", "Galpão industrial": "galpao",
    "Residencial unifamiliar": "casa", "Conjunto habitacional popular": "conjunto", "Casa popular": "casa", "Edifício de Garagens": "garagem" };
  const COLS = "cno,nome,responsavel,cnpj,qualificacao,situacao,data_inicio,data_registro,municipio,bairro,tipo_logradouro," +
    "logradouro,numero,complemento,cep,area_principal,destinacao,destinacoes,categoria,vinculadas,prazo_meses,primeira_vez_em";
  const ESCALA_MAX = 130, LOTE = 40, LOTE_LISTA = 100, AREA_SUSPEITA = 300000, PAGINA = 1000;
  // nomes curtos dos tipos, para a lista
  const TIPO_CURTO = { "Residencial multifamiliar": "Prédio residencial", "Comercial salas e lojas": "Comercial",
    "Galpão industrial": "Galpão", "Residencial unifamiliar": "Casa", "Conjunto habitacional popular": "Conjunto habitacional",
    "Casa popular": "Casa popular", "Edifício de Garagens": "Garagem" };
  const JANELA_CURTA = { "Apresentação / especificação": "Apresentação", Vibra: "Vibra", Mohawk: "Mohawk", Lorenzetti: "Lorenzetti", "Assa Abloy": "Assa Abloy" };
  // forma de ver (lista ou fichas) fica lembrada neste aparelho
  const lerModo = () => { try { return localStorage.getItem("radar-modo") || "lista"; } catch (e) { return "lista"; } };
  const gravarModo = (m) => { try { localStorage.setItem("radar-modo", m); } catch (e) { /* sem armazenamento: só nesta sessão */ } };

  // ------------------------------------------------------------ utilidades
  const nf = new Intl.NumberFormat("pt-BR");
  const $ = (id) => document.getElementById(id);
  const sem = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dataBR = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "–");
  const ico = (n) => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const fmtCnpj = (s) => (/^\d{14}$/.test(s || "") ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s || "");
  const fmtCnpjsNoTexto = (t) => (t || "").replace(/\b\d{14}\b/g, fmtCnpj);
  const fmtCno = (s) => (s && s.length === 12 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 10)}/${s.slice(10)}` : s);
  const HOJE = new Date(); HOJE.setHours(0, 0, 0, 0);
  const NEWS_DESDE = Date.parse("2026-11-23T11:00:00Z"), NEWS_DIAS = 7;
  const rotAtualizacao = () => (E.atualizacao ? `· dados atualizados em ${E.atualizacao.toLocaleDateString("pt-BR")}` : "");

  // Texto do cadastro vem TODO EM MAIÚSCULAS; vira "Título" para ler o dia inteiro.
  const SIGLAS = new Set(("LTDA SA SPE EIRELI ME EPP CNPJ PA UBS EMEF EMEIF EMEI UFPA UFOPA UFRA IFPA SEDUC SESAU SESPA SEDOP " +
    "SESAN CEP BR II III IV VI VII VIII IX XI XII XIII MRV DNIT CRAS CAPS UPA SENAI SESC SESI SEBRAE BB CEF INSS TRT TRE " +
    "TJPA MPPA COHAB CDP FII PCB SS CT PAC FL CPH HU SAAE COSANPA CELPA").split(" "));
  const MINUS = new Set("de da do das dos e em na no nas nos a o as os para com por ao à".split(" "));
  function titulo(s) {
    if (!s) return "";
    if (/[a-zà-ÿ]/.test(s)) return s;
    return s.toLowerCase().split(/(\s+|-|\/|\(|\))/).map((w, i) => {
      if (!w || /^(\s+|-|\/|\(|\))$/.test(w)) return w;
      const up = w.toUpperCase(), limpo = up.replace(/[.,;:]/g, "");
      if (SIGLAS.has(limpo)) return up;
      if (i > 0 && MINUS.has(w)) return w;
      if (/^\d/.test(w) || /^[a-z]\.?,?$/.test(w)) return up;
      if (w.length <= 3 && !/[aeiouáéíóúâêôãõày]/.test(w)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join("");
  }
  function endereco(o) {
    const sn = ["SN", "S/N", "0", "00", "S.N", "S N"];
    const partes = [[o.tipo_logradouro, o.logradouro].filter(Boolean).join(" "), sn.includes((o.numero || "").toUpperCase()) ? "" : o.numero];
    let s = partes.filter(Boolean).join(", ");
    if (o.complemento) s += " - " + o.complemento;
    return s;
  }
  function linkMapa(o) {
    const q = `${endereco(o)}, ${o.bairro || ""}, ${o.municipio} - PA, ${o.cep || ""}`;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }
  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }
  function falha(err, contexto) {
    console.error(contexto, err);
    const m = (err && (err.message || err.error_description)) || String(err);
    toast((contexto ? contexto + ": " : "") + (/row-level security|permission/i.test(m) ? "sem permissão para isso." : m));
  }

  // ------------------------------------------------------------ estado
  const E = {
    sb: null, eu: null, perfis: [], obras: new Map(), enc: [], acomp: new Map(), notas: new Map(),
    vista: "", filtros: {}, lista: [], mostradas: 0, baseNova: null, modo: lerModo(),
    links: new Map(), empresas: new Map(), salvas: new Set(), construtoras: new Map(), temEmpresas: false,
  };
  const ehAdmin = () => E.eu && E.eu.papel === "admin";
  const nomeDe = (id) => { const p = E.perfis.find((x) => x.id === id); return p ? p.nome || p.email : "—"; };
  const encDe = (cno) => E.enc.filter((e) => e.cno === cno);
  const minha = (cno) => E.enc.some((e) => e.cno === cno && e.vendedor_id === E.eu.id);
  const acompDe = (cno, vid) => E.acomp.get(cno + "|" + vid);
  // situação de uma obra para uma representante: etapa, próxima ação vencida, dias sem movimentação
  const PARADA_DIAS = 14;
  const hojeISO = () => new Date(HOJE.getTime() - HOJE.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function situacao(cno, vid) {
    const a = acompDe(cno, vid) || {}, e = E.enc.find((x) => x.cno === cno && x.vendedor_id === vid) || {};
    const st = a.status || "nova", aberta = st !== "fechada" && st !== "perdida";
    const desde = a.atualizado_em || e.encaminhado_em;
    const dias = desde ? Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 86400000)) : null;
    return { st, aberta, dias, proxima: a.proxima_acao || null,
      vencida: aberta && !!a.proxima_acao && a.proxima_acao < hojeISO(), parada: aberta && dias != null && dias >= PARADA_DIAS };
  }

  // ------------------------------------------------------------ telas
  function mostrar(qual) {
    $("tela-entrada").hidden = qual !== "entrada";
    $("tela-msg").hidden = qual !== "msg";
    $("tela-app").hidden = qual !== "app";
  }
  function msg(texto, acao) {
    $("msg-texto").innerHTML = esc(texto) + (acao ? `<br><br><button class="btn" type="button" id="msg-acao">${esc(acao.rotulo)}</button>` : "");
    if (acao) $("msg-acao").onclick = acao.fn;
    // o radar só gira enquanto carrega; em mensagem de erro ele para
    $("tela-msg").classList.toggle("parado", !!acao || !/^Carregando/.test(texto));
    mostrar("msg");
  }
  function mostrarEntrada() {
    E.eu = null;
    $("erro-entrada").hidden = true;
    mostrar("entrada");
    setTimeout(() => $("email").focus(), 50);
  }

  // ------------------------------------------------------------ dados
  async function paginar(montar) {
    const out = [];
    for (let i = 0; ; i += PAGINA) {
      const { data, error } = await montar().range(i, i + PAGINA - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGINA) break;
    }
    return out;
  }
  function calcular(o) {
    const ini = o.data_inicio ? new Date(o.data_inicio + "T00:00:00") : null;
    o.meses = ini ? Math.max(0, (HOJE - ini) / 86400000 / 30.44) : null;
    o.prazo = Number(o.prazo_meses) || 12;
    o.pct = o.meses == null ? null : (100 * o.meses) / o.prazo;
    o.fase = o.pct == null ? "Sem data de início" : FASES.find((f) => o.pct < f[0])[1];
    o.janelas = o.pct == null ? [] : JANELAS.filter((j) => o.pct >= j.ini && o.pct < j.fim);
    o.passou = o.pct != null && o.pct >= 115;
    o.area = o.area_principal == null ? null : Number(o.area_principal);
    o.susp = o.area != null && o.area > AREA_SUSPEITA;
    o.cnpjF = fmtCnpj(o.cnpj);
    o.tNome = titulo(o.nome); o.tResp = titulo(o.responsavel); o.tBairro = titulo(o.bairro); o.tMun = titulo(o.municipio);
    o.tEnd = titulo(endereco(o)); o.tVinc = titulo(fmtCnpjsNoTexto(o.vinculadas));
    o.busca = sem([o.nome, o.responsavel, o.cnpj, o.cnpjF, o.bairro, o.municipio, endereco(o), o.vinculadas, o.cno, o.destinacoes].join(" "));
    return o;
  }
  async function carregarTudo() {
    const sb = E.sb;
    const [perfis, enc, acomp, notas] = await Promise.all([
      paginar(() => sb.from("perfis").select("id,nome,email,papel,ativo").order("nome")),
      paginar(() => sb.from("encaminhamentos").select("cno,vendedor_id,encaminhado_em").order("cno")),
      paginar(() => sb.from("acompanhamento").select("cno,vendedor_id,status,proxima_acao,atualizado_em").order("cno")),
      paginar(() => sb.from("anotacoes").select("cno").order("cno")),
    ]);
    E.perfis = perfis; E.enc = enc;
    E.acomp = new Map(acomp.map((a) => [a.cno + "|" + a.vendedor_id, a]));
    E.notas = new Map(); notas.forEach((n) => E.notas.set(n.cno, (E.notas.get(n.cno) || 0) + 1));

    let obras;
    if (ehAdmin()) {
      try {
        obras = await paginar(() => sb.from("obras_radar").select(COLS).order("cno"));
      } catch (e) { // banco ainda sem a view: mesmo recorte direto na tabela
        obras = await paginar(() => sb.from("obras").select(COLS).eq("situacao", "02").gte("data_inicio", "2023-01-01")
          .gt("area_principal", 0).is("motivo_infra", null).order("cno"));
      }
      obras.forEach((o) => (o.recorte = true));
      const tem = new Set(obras.map((o) => o.cno));
      const faltam = [...new Set(enc.map((e) => e.cno))].filter((c) => !tem.has(c));
      for (let i = 0; i < faltam.length; i += 150) {
        const { data, error } = await sb.from("obras").select(COLS).in("cno", faltam.slice(i, i + 150));
        if (error) throw error;
        obras.push(...data);
      }
    } else {
      obras = await paginar(() => sb.from("obras").select(COLS).order("cno"));
    }
    E.obras = new Map(obras.map((o) => [o.cno, calcular(o)]));
    await carregarEmpresas();
    // "News" = obra que entrou na base nos últimos NEWS_DIAS dias, contando só as atualizações
    // feitas depois de NEWS_DESDE (as obras que já estavam na base não recebem a etiqueta)
    const limite = Math.max(NEWS_DESDE, Date.now() - NEWS_DIAS * 86400000);
    obras.forEach((o) => { const t = new Date(o.primeira_vez_em).getTime(); o.nova = t > limite; });
    // data da última atualização das obras (mostrada no lugar de "fase calculada para hoje")
    try {
      const { data, error } = await sb.rpc("ultima_atualizacao");
      E.atualizacao = !error && data && data[0] ? new Date(data[0].em) : null;
    } catch (e) { E.atualizacao = null; }
  }

  // empresas ligadas às obras carregadas, e as construtoras salvas pelo usuário
  async function carregarEmpresas() {
    const sb = E.sb, emBlocos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
    try {
      const CL = "cno,cnpj,cnpj_basico,papel,qualificacao,ativo";
      const links = [];
      let fora = [...E.obras.keys()];
      if (ehAdmin()) {
        try {
          links.push(...await paginar(() => sb.from("obra_empresas_radar").select(CL).order("cno").order("cnpj").order("papel").order("qualificacao")));
          fora = [...E.obras.values()].filter((o) => !o.recorte).map((o) => o.cno);
        } catch (e) { /* sem a view: busca por blocos */ }
      }
      const partes = await Promise.all(emBlocos(fora, 150).map((b) => sb.from("obra_empresas").select(CL).in("cno", b)));
      partes.forEach(({ data, error }) => { if (error) throw error; links.push(...data); });
      const basicos = [...new Set(links.map((l) => l.cnpj_basico))];
      const [emps, salvas] = await Promise.all([
        Promise.all(emBlocos(basicos, 150).map((b) => sb.from("empresas").select("cnpj_basico,nome,cnpjs,obras_total,obras_ativas,primeira_obra,ultima_obra").in("cnpj_basico", b))),
        paginar(() => sb.from("empresas_salvas").select("cnpj_basico").eq("usuario_id", E.eu.id).order("cnpj_basico")),
      ]);
      E.empresas = new Map();
      emps.forEach(({ data, error }) => { if (error) throw error; data.forEach((e) => E.empresas.set(e.cnpj_basico, e)); });
      E.links = new Map();
      links.forEach((l) => { if (!E.links.has(l.cno)) E.links.set(l.cno, []); E.links.get(l.cno).push(l); });
      E.salvas = new Set(salvas.map((x) => x.cnpj_basico));
      E.temEmpresas = true;
      montarConstrutoras();
    } catch (e) {
      console.warn("construtoras indisponíveis", e);
      E.temEmpresas = false;
    }
  }

  // ------------------------------------------------------------ entrada e sessão
  async function iniciar() {
    const cfg = window.RADAR_CONFIG;
    if (!cfg || !window.supabase) {
      msg("O site está sem a configuração do banco de dados. Abra a página /checagem.html para ver o que falta.");
      return;
    }
    E.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    E.sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") mostrarEntrada(); });
    const { data } = await E.sb.auth.getSession();
    if (data && data.session) await entrar(data.session.user);
    else mostrarEntrada();
  }
  async function entrar(user) {
    msg("Carregando obras…");
    try {
      const { data: perfil, error } = await E.sb.from("perfis").select("id,nome,email,papel,ativo").eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (!perfil) return msg("Seu usuário não tem perfil no sistema. Fale com o administrador.", { rotulo: "Sair", fn: sair });
      if (!perfil.ativo) return msg("Seu acesso está desativado. Fale com o administrador.", { rotulo: "Sair", fn: sair });
      E.eu = perfil;
      await carregarTudo();
    } catch (e) {
      console.error(e);
      return msg("Não foi possível carregar os dados (" + (e.message || e) + "). Recarregue a página.", { rotulo: "Sair", fn: sair });
    }
    $("eu-nome").textContent = E.eu.nome || E.eu.email;
    mostrar("app");
    rota();
  }
  async function sair() {
    await E.sb.auth.signOut();
    mostrarEntrada();
  }
  $("form-entrada").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("btn-entrar"); btn.disabled = true; $("erro-entrada").hidden = true;
    const { data, error } = await E.sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("senha").value });
    btn.disabled = false;
    if (error) {
      $("erro-entrada").textContent = /invalid login/i.test(error.message) ? "E-mail ou senha incorretos."
        : /fetch|network/i.test(error.message) ? "Sem conexão com o servidor. Confira a internet e tente de novo." : error.message;
      $("erro-entrada").hidden = false;
      return;
    }
    $("senha").value = "";
    await entrar(data.user);
  });
  $("btn-sair").addEventListener("click", sair);
  $("btn-senha").addEventListener("click", () => { $("nova-senha").value = ""; $("erro-senha").hidden = true; $("dlg-senha").showModal(); });
  $("btn-salvar-senha").addEventListener("click", async () => {
    const s = $("nova-senha").value;
    if (s.length < 8) { $("erro-senha").textContent = "A senha precisa ter pelo menos 8 caracteres."; $("erro-senha").hidden = false; return; }
    const { error } = await E.sb.auth.updateUser({ password: s });
    if (error) { $("erro-senha").textContent = error.message; $("erro-senha").hidden = false; return; }
    $("dlg-senha").close(); toast("Senha alterada");
  });

  // ------------------------------------------------------------ navegação
  function rota() {
    if (!E.eu) return;
    let v = (location.hash || "").replace("#", "");
    if (!["todas", "minhas", "construtoras", "insights", "equipe"].includes(v) || (!ehAdmin() && ["todas", "insights", "equipe"].includes(v))) v = ehAdmin() ? "todas" : "minhas";
    E.vista = v;
    if (location.hash.replace("#", "") !== v) history.replaceState(null, "", "#" + v);
    renderAbas();
    renderVista();
  }
  window.addEventListener("hashchange", rota);
  function renderAbas() {
    const minhas = new Set(E.enc.filter((e) => e.vendedor_id === E.eu.id).map((e) => e.cno)).size;
    const abas = [];
    if (ehAdmin()) abas.push(["todas", "Todas as obras", [...E.obras.values()].filter((o) => o.recorte).length]);
    abas.push(["minhas", "Minhas obras", minhas]);
    abas.push(["construtoras", "Construtoras", E.construtoras.size]);
    if (ehAdmin()) abas.push(["insights", "Insights", null]);
    if (ehAdmin()) abas.push(["equipe", "Equipe", E.perfis.length]);
    $("abas").innerHTML = abas.map(([id, rot, n]) =>
      `<a href="#${id}" ${E.vista === id ? 'aria-current="page"' : ""}>${esc(rot)}${n == null ? "" : ` <span class="cont">${nf.format(n)}</span>`}</a>`).join("");
  }

  // ------------------------------------------------------------ listas de obras
  function filtrosPadrao(v) {
    return { busca: "", mun: "", dest: "", janela: "", enc: "", status: "", salvas: false, area: "", especial: "", ordem: v === "minhas" ? "proxima" : "prioridade" };
  }
  function baseDaVista() {
    const todas = [...E.obras.values()];
    if (E.vista === "todas") return todas;
    return todas.filter((o) => minha(o.cno));
  }
  function renderVista() {
    const c = $("conteudo");
    if (E.vista === "equipe") return renderEquipe();
    if (E.vista === "construtoras") return renderConstrutoras();
    if (E.vista === "insights") return renderInsights();
    const f = (E.filtros[E.vista] = E.filtros[E.vista] || filtrosPadrao(E.vista));
    const base = baseDaVista();
    const porMun = {}, porDest = {};
    base.forEach((o) => { porMun[o.municipio] = (porMun[o.municipio] || 0) + 1; porDest[o.destinacao || "Não informado"] = (porDest[o.destinacao || "Não informado"] || 0) + 1; });
    const opt = (obj, sel, fmt) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(fmt ? fmt(k) : k)} (${n})</option>`).join("");
    const vendedores = E.perfis.filter((p) => p.ativo);
    const quadro = E.modo === "quadro";
    const filtroEnc = E.vista === "todas" && quadro ? `
      <div class="campo"><label for="f-enc">Representante</label><select id="f-enc">
        <option value="">Todas</option>
        ${vendedores.filter((p) => E.enc.some((e) => e.vendedor_id === p.id)).map((p) => `<option value="${esc(p.id)}" ${f.enc === p.id ? "selected" : ""}>${esc(p.nome || p.email)}</option>`).join("")}
      </select></div>` : E.vista === "todas" ? `
      <div class="campo"><label for="f-enc">Encaminhamento</label><select id="f-enc">
        <option value="">Todas</option>
        <option value="sem" ${f.enc === "sem" ? "selected" : ""}>Sem vendedor</option>
        <option value="com" ${f.enc === "com" ? "selected" : ""}>Com vendedor</option>
        ${vendedores.map((p) => `<option value="${esc(p.id)}" ${f.enc === p.id ? "selected" : ""}>Com ${esc(p.nome || p.email)}</option>`).join("")}
      </select></div>` : "";
    const ordens = E.vista === "todas"
      ? [["prioridade", "Momento de contato"], ["cidade", "Cidade (A–Z)"], ["area", "Maior área"], ["inicio", "Início mais recente"], ["registro", "Cadastro mais recente"], ["entrada", "Entrou na base mais recente"]]
      : [["proxima", "Próxima ação"], ["prioridade", "Momento de contato"], ["cidade", "Cidade (A–Z)"], ["area", "Maior área"], ["atualizado", "Movimentada mais recente"]];
    c.innerHTML = `
      <section class="painel" aria-label="Filtros">
        <div class="linha">
          <div class="campo largo"><label for="f-busca">Buscar</label><input id="f-busca" type="search" value="${esc(f.busca)}" placeholder="Obra, construtora, CNPJ, bairro…" autocomplete="off"></div>
          <div class="campo"><label for="f-mun">Município</label><select id="f-mun"><option value="">Todos</option>${opt(porMun, f.mun, titulo)}</select></div>
          <div class="campo"><label for="f-dest">Tipo de obra</label><select id="f-dest"><option value="">Todos</option>${opt(porDest, f.dest)}</select></div>
          <div class="campo"><label for="f-area">Área mínima</label><select id="f-area">${AREAS.map(([v, r]) => `<option value="${v}" ${String(f.area) === v ? "selected" : ""}>${r}</option>`).join("")}</select></div>
          ${filtroEnc}
          <div class="campo"><label for="f-ordem">Ordenar por</label><select id="f-ordem">${ordens.map(([k, r]) => `<option value="${k}" ${f.ordem === k ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        </div>
        <div class="linha" style="justify-content:space-between">
          <div class="chips" id="chips" role="group" aria-label="${E.vista === "minhas" ? "Andamento" : "Momento da obra"}"></div>
          ${E.temEmpresas ? `<label class="toggle"><input type="checkbox" id="f-salvas" ${f.salvas ? "checked" : ""}> Só de minhas construtoras ★</label>` : ""}
        </div>
      </section>
      <div class="resumo">
        <span><strong id="qtd">0</strong> <span id="qtd-rot">obras</span> <small class="hoje-rot">${rotAtualizacao()}</small></span>
        <div class="modos" role="group" aria-label="Forma de ver as obras">
          <button type="button" data-modo="lista" aria-pressed="${E.modo === "lista"}">${ico("lista")}Lista</button>
          <button type="button" data-modo="fichas" aria-pressed="${E.modo === "fichas"}">${ico("fichas")}Fichas</button>
          <button type="button" data-modo="quadro" aria-pressed="${quadro}">${ico("quadro")}Quadro</button>
        </div>
      </div>
      ${quadro && E.vista === "todas" ? `<p class="dica-quadro">No quadro entram só as obras encaminhadas: um cartão por representante, na etapa em que ela marcou a obra. Cada representante muda a etapa no painel da obra.</p>` : ""}
      <div class="${E.modo === "lista" ? "lista" : quadro ? "quadro" : "grade"}" id="grade"></div>
      <button class="btn mais" id="mais" type="button" hidden>Mostrar mais</button>`;
    aplicar();
  }
  // no quadro de "Todas as obras" só entram obras encaminhadas (todas ou de uma representante)
  const encDoQuadro = (f) => (f.enc && f.enc !== "sem" && f.enc !== "com" ? f.enc : "com");
  function baseFiltrada() {
    const f = E.filtros[E.vista];
    const enc = E.modo === "quadro" && E.vista === "todas" ? encDoQuadro(f) : f.enc;
    const q = sem(f.busca.trim());
    return baseDaVista().filter((o) => (!q || o.busca.includes(q)) && (!f.mun || o.municipio === f.mun) &&
      (!f.dest || (o.destinacao || "Não informado") === f.dest) && (!f.salvas || deEmpresaSalva(o.cno)) &&
      (!f.area || (o.area || 0) >= Number(f.area)) && (!f.especial || (ESPECIAIS[f.especial] || {}).teste(o)) &&
      (!enc || (enc === "sem" ? !encDe(o.cno).length : enc === "com" ? encDe(o.cno).length > 0 : encDe(o.cno).some((e) => e.vendedor_id === enc))));
  }
  // desenha os botões de filtro com as contagens atuais; devolve o teste do botão escolhido
  function renderChips(base) {
    const f = E.filtros[E.vista];
    let chips, passa;
    if (E.vista === "minhas" && E.modo === "quadro") { $("chips").innerHTML = ""; return () => true; }
    if (E.vista === "minhas") {
      const st = (o) => (acompDe(o.cno, E.eu.id) || {}).status || "nova";
      chips = [["", "Todas", "todas", base.length], ...STATUS.map(([k, r]) => [k, r, "", base.filter((o) => st(o) === k).length])];
      passa = (o) => !f.status || st(o) === f.status;
      $("chips").innerHTML = chips.map(([v, rot, cls, n]) => `<button type="button" class="chip ${cls}" data-filtro-status="${v}" aria-pressed="${f.status === v}" ${v ? `style="--c:var(--st-${v})"` : ""}><span class="dot"></span>${esc(rot)} <b>${nf.format(n)}</b></button>`).join("");
    } else {
      chips = [["", "Todas", "todas", base.length], ...JANELAS.map((j) => [j.nome, j.curto, "", base.filter((o) => o.janelas.includes(j)).length, j.cor]),
        ["passou", "Passou do prazo", "prazo", base.filter((o) => o.passou).length]];
      passa = (o) => !f.janela || (f.janela === "passou" ? o.passou : o.janelas.some((j) => j.nome === f.janela));
      $("chips").innerHTML = chips.map(([v, rot, cls, n, cor]) => `<button type="button" class="chip ${cls}" data-filtro-janela="${esc(v)}" aria-pressed="${f.janela === v}" ${cor ? `style="--c:${cor}"` : ""}><span class="dot"></span>${esc(rot)} <b>${nf.format(n)}</b></button>`).join("");
    }
    return passa;
  }
  function aplicar() {
    const f = E.filtros[E.vista];
    const base = baseFiltrada();
    const passa = renderChips(base);
    if (f.especial && ESPECIAIS[f.especial]) $("chips").insertAdjacentHTML("afterbegin",
      `<button type="button" class="chip especial" data-tirar-especial aria-label="Tirar o filtro ${esc(ESPECIAIS[f.especial].rotulo)}">${esc(ESPECIAIS[f.especial].rotulo)} ×</button>`);
    E.lista = base.filter(passa).sort(ORDENS[f.ordem] || ORDENS.prioridade);
    if (E.modo === "quadro") return desenharQuadro();
    $("qtd").textContent = nf.format(E.lista.length);
    $("qtd-rot").textContent = E.lista.length === 1 ? "obra" : "obras";
    E.mostradas = 0;
    $("grade").innerHTML = E.lista.length ? "" : `<p class="vazio">${E.vista === "minhas" && !baseDaVista().length
      ? (ehAdmin() ? "Nenhuma obra encaminhada para você. Em “Todas as obras”, use “Encaminhar para…” e escolha seu nome." : "Ainda não há obras encaminhadas para você. Elas aparecem aqui assim que o administrador encaminhar.")
      : "Nenhuma obra com esses filtros. Limpe a busca ou escolha “Todas”."}</p>`;
    desenharMais();
  }
  const areaOk = (o) => (o.susp ? 0 : o.area || 0);
  function prioridade(a, b) {
    const pa = a.janelas.filter((j) => j.ini > 0).length, pb = b.janelas.filter((j) => j.ini > 0).length;
    return (a.passou - b.passou) || (pb - pa) || (!a.janelas.length - !b.janelas.length) || (!a.cnpj - !b.cnpj) || (areaOk(b) - areaOk(a));
  }
  const ORDENS = {
    prioridade,
    area: (a, b) => areaOk(b) - areaOk(a),
    inicio: (a, b) => (b.data_inicio || "").localeCompare(a.data_inicio || ""),
    registro: (a, b) => (b.data_registro || "").localeCompare(a.data_registro || ""),
    entrada: (a, b) => (b.primeira_vez_em || "").localeCompare(a.primeira_vez_em || ""),
    cidade: (a, b) => (a.municipio || "").localeCompare(b.municipio || "", "pt-BR") || prioridade(a, b),
    proxima: (a, b) => {
      const pa = (acompDe(a.cno, E.eu.id) || {}).proxima_acao || "9999", pb = (acompDe(b.cno, E.eu.id) || {}).proxima_acao || "9999";
      return pa.localeCompare(pb) || prioridade(a, b);
    },
    atualizado: (a, b) => ((acompDe(b.cno, E.eu.id) || {}).atualizado_em || "").localeCompare((acompDe(a.cno, E.eu.id) || {}).atualizado_em || ""),
  };
  function desenharMais() {
    const emLista = E.modo === "lista", tam = emLista ? LOTE_LISTA : LOTE;
    const lote = E.lista.slice(E.mostradas, E.mostradas + tam);
    if (emLista && E.mostradas === 0 && lote.length) $("grade").insertAdjacentHTML("beforeend", cabecalhoLista());
    $("grade").insertAdjacentHTML("beforeend", lote.map(emLista ? linha : ficha).join(""));
    E.mostradas += lote.length;
    const falta = E.lista.length - E.mostradas;
    $("mais").hidden = falta <= 0;
    $("mais").textContent = `Mostrar mais ${nf.format(Math.min(tam, falta))} de ${nf.format(falta)}`;
  }

  // ------------------------------------------------------------ quadro (Kanban): colunas = etapas do andamento
  function cartoesDoQuadro() {
    const f = E.filtros[E.vista], cards = [];
    E.lista.forEach((o) => {
      const vids = E.vista === "minhas" ? [E.eu.id]
        : encDe(o.cno).map((e) => e.vendedor_id).filter((v) => encDoQuadro(f) === "com" || v === f.enc);
      vids.forEach((vid) => cards.push({ o, vid, s: situacao(o.cno, vid) }));
    });
    return cards;
  }
  // primeiro o que pede atenção: ação vencida, depois a próxima ação mais perto, depois o mais tempo parado
  const ordemCartao = (a, b) => (b.s.vencida - a.s.vencida) || (a.s.proxima || "9999").localeCompare(b.s.proxima || "9999") || ((b.s.dias || 0) - (a.s.dias || 0));
  function desenharQuadro() {
    const g = $("grade"), equipe = E.vista === "todas", cards = cartoesDoQuadro();
    // obras com mais de uma representante viram um cartão para cada uma
    const nObras = new Set(cards.map((c) => c.o.cno)).size;
    $("qtd").textContent = nf.format(nObras);
    $("qtd-rot").textContent = (equipe ? (nObras === 1 ? "obra encaminhada" : "obras encaminhadas") : (nObras === 1 ? "obra" : "obras"))
      + (cards.length !== nObras ? ` · ${nf.format(cards.length)} cartões` : "");
    $("mais").hidden = true;
    if (!cards.length) {
      g.innerHTML = `<p class="vazio">${equipe ? "Nenhuma obra encaminhada com esses filtros." : !baseDaVista().length
        ? "Ainda não há obras encaminhadas para você." : "Nenhuma obra com esses filtros. Limpe a busca ou escolha “Todas”."}</p>`;
      return;
    }
    const x = g.scrollLeft;
    g.innerHTML = STATUS.map(([k, rot]) => {
      const cs = cards.filter((c) => c.s.st === k).sort(ordemCartao);
      return `<section class="coluna" aria-label="${esc(rot)}: ${cs.length}">
        <h3 class="col-cab"><span class="status" data-s="${k}">${esc(rot)}</span><b>${nf.format(cs.length)}</b></h3>
        <div class="col-cards">${cs.map((c) => cartao(c, equipe)).join("") || `<p class="col-vazia">nenhuma</p>`}</div></section>`;
    }).join("");
    g.scrollLeft = x;
    const d = $("detalhe"); if (d.open && d.dataset.cno) marcarSelecionada(d.dataset.cno);
  }
  function cartao({ o, vid, s }, equipe) {
    const rodape = (s.vencida ? `<span class="q-vencida">ação vencida ${dataBR(s.proxima)}</span>` : s.proxima && s.aberta ? `<span class="fraco">próxima ação ${dataBR(s.proxima)}</span>` : "")
      + (s.parada ? `<span class="q-parada">parada há ${s.dias} dias</span>` : "");
    return `<div class="card-q${s.vencida || s.parada ? " atencao" : ""}" data-cno="${esc(o.cno)}" tabindex="0" role="button" aria-label="Abrir ${esc(o.tNome)}">
      <div class="q-top"><span class="mun">${esc(o.tMun || titulo(o.municipio))}</span><span class="q-area">${o.area ? nf.format(Math.round(o.area)) + " m²" : "–"}</span></div>
      <div class="q-obra">${esc(o.tNome)}</div>
      ${o.nova ? `<span class="novo" title="Entrou na base nos últimos 7 dias">News</span>` : ""}
      ${o.janelas.length ? `<div class="q-prod">${o.janelas.map((j) => `<span class="mini" style="--c:${j.cor}">${esc(JANELA_CURTA[j.nome])}</span>`).join("")}</div>` : ""}
      ${equipe ? `<div class="q-quem">${esc(nomeDe(vid))}</div>` : ""}
      ${rodape ? `<div class="q-rodape">${rodape}</div>` : ""}
    </div>`;
  }

  // ------------------------------------------------------------ ficha da obra
  function trilho(o) {
    if (o.pct == null) return "";
    const pos = (p) => ((Math.min(p, ESCALA_MAX) / ESCALA_MAX) * 100).toFixed(2) + "%";
    const raias = JANELAS.map((j, i) => `<div class="raia" style="top:${i * 9}px"><i class="${o.janelas.includes(j) ? "aberta" : ""}" style="--c:${j.cor};left:${pos(j.ini)};width:calc(${pos(j.fim)} - ${pos(j.ini)})"></i></div>`).join("");
    return `<div class="trilho" aria-hidden="true">${raias}<div class="alem" style="left:${pos(100)}"></div><div class="hoje" style="left:${pos(o.pct)}"></div></div>
      <div class="escala" aria-hidden="true"><span style="left:0">início</span><span style="left:${pos(50)}">metade</span><span style="left:${pos(100)}">fim previsto</span></div>`;
  }
  function blocoTempo(o) {
    const agora = o.janelas.length
      ? `<span class="rot">Agora:</span>` + o.janelas.map((j) => `<span class="prod" style="--c:${j.cor}">${esc(j.curto)}</span>`).join("")
      : o.passou ? `<span class="rot">Já passou do prazo estimado. Vale confirmar se a obra terminou.</span>` : `<span class="rot">Fora das janelas de produto</span>`;
    const meses = o.pct == null ? "" : `${nf.format(Math.round(o.meses))} de ~${nf.format(Math.round(o.prazo))} meses · ${nf.format(Math.round(o.pct))}%`;
    return `<div class="tempo"><div class="cab"><span class="fase">${esc(o.fase)}</span><span class="meses">${meses}</span></div>${trilho(o)}<div class="agora">${agora}</div></div>`;
  }
  function cabecalhoObra(o) {
    const alertas = [];
    if (o.nova) alertas.push(`<span class="novo" title="Entrou na base nos últimos 7 dias">News</span>`);
    if (o.susp) alertas.push(`<span class="alerta">área provavelmente digitada errada</span>`);
    if (!o.cnpj) alertas.push(`<span class="alerta">pessoa física</span>`);
    if (o.situacao && o.situacao !== "02") alertas.push(`<span class="alerta">situação no CNO: ${esc({ "01": "nula", "03": "suspensa", "14": "paralisada", "15": "encerrada" }[o.situacao] || o.situacao)}</span>`);
    return {
      cidade: `<div class="cidade">${ico("pin")}<div class="lugar"><span class="mun">${esc(o.tMun || titulo(o.municipio))}</span>${o.bairro ? `<span class="bairro">${esc(o.tBairro)}</span>` : ""}</div>
        <div class="area"><b>${o.area ? nf.format(Math.round(o.area)) : "–"}</b><small>m²</small></div></div>`,
      tipos: `<div class="tipos"><span class="tipo">${ico(ICONE[o.destinacao] || "predio")}${esc(o.destinacao || "Tipo não informado")}</span>${o.categoria ? `<span class="cat">${esc(o.categoria)}</span>` : ""}${alertas.join("")}</div>`,
      resp: `<div class="resp">${o.responsavel && o.responsavel !== o.nome ? `<span class="nome">${esc(o.tResp)}</span>` : ""}${o.cnpj ? `<span class="cnpj"><span class="mono">${esc(o.cnpjF)}</span><button type="button" class="copiar" data-copiar="${esc(o.cnpjF)}">Copiar CNPJ</button>${linkCnpja(o.cnpj)}</span>` : ""}<span>${esc(QUALIF[o.qualificacao] || "")}</span></div>`,
      local: `<div class="local"><span class="end">${esc(o.tEnd)}${o.cep ? " · CEP " + esc(o.cep) : ""}</span><a class="mapa" href="${esc(linkMapa(o))}" target="_blank" rel="noopener">${ico("mapa")}Abrir no mapa</a></div>`,
    };
  }
  function seletorStatus(o) {
    const a = acompDe(o.cno, E.eu.id) || {};
    const st = a.status || "nova";
    const id = "s" + o.cno + (E.vistaDialog ? "d" : "");
    return `<div class="linha">
      <div class="campo"><label for="${id}-st">Andamento</label><select id="${id}-st" data-status-obra="${esc(o.cno)}">${STATUS.map(([k, r]) => `<option value="${k}" ${k === st ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <div class="campo"><label for="${id}-px">Próxima ação</label><input id="${id}-px" type="date" data-proxima="${esc(o.cno)}" value="${esc(a.proxima_acao || "")}"></div>
    </div>`;
  }
  function acoesFicha(o) {
    const n = E.notas.get(o.cno) || 0;
    const btnDet = `<button class="btn" type="button" data-detalhe="${esc(o.cno)}">Detalhes e anotações${n ? ` (${n})` : ""}</button>`;
    if (E.vista === "todas") {
      const encs = encDe(o.cno);
      const ja = new Set(encs.map((e) => e.vendedor_id));
      const opcoes = E.perfis.filter((p) => p.ativo && !ja.has(p.id));
      const pessoas = encs.map((e) => {
        const st = (acompDe(o.cno, e.vendedor_id) || {}).status || "nova";
        return `<span class="pessoa">${esc(nomeDe(e.vendedor_id))} <span class="status" data-s="${st}">${esc(STATUS_NOME[st])}</span>
          <button type="button" data-remover="${esc(o.cno)}" data-vendedor="${esc(e.vendedor_id)}" aria-label="Tirar de ${esc(nomeDe(e.vendedor_id))}">×</button></span>`;
      }).join("");
      return `<div class="acoes">
        ${pessoas ? `<div class="atribuidos">${pessoas}</div>` : ""}
        <div class="linha">${opcoes.length ? `<select data-encaminhar="${esc(o.cno)}" aria-label="Encaminhar obra"><option value="">Encaminhar para…</option>${opcoes.map((p) => `<option value="${esc(p.id)}">${esc(p.nome || p.email)}</option>`).join("")}</select>` : ""}${btnDet}</div>
      </div>`;
    }
    return `<div class="acoes">${seletorStatus(o)}<div class="linha">${btnDet}</div></div>`;
  }
  function ficha(o) {
    const h = cabecalhoObra(o);
    return `<article class="ficha" data-cno="${esc(o.cno)}">${h.cidade}
      <div class="corpo">${h.tipos}
        <div style="display:grid;gap:6px;min-width:0"><h3>${esc(o.tNome)}</h3>${h.resp}</div>
        ${h.local}${blocoTempo(o)}${acoesFicha(o)}
        <div class="rodape"><span>Início ${dataBR(o.data_inicio)}</span><span>Cadastro ${dataBR(o.data_registro)}</span><span class="mono">CNO ${esc(fmtCno(o.cno))}</span></div>
      </div></article>`;
  }
  function atualizarFicha(cno) {
    if (E.modo === "quadro" && (E.vista === "todas" || E.vista === "minhas") && $("grade")) { aplicar(); renderAbas(); return; }
    const el = document.querySelector(`#grade [data-cno="${CSS.escape(cno)}"]`);
    const o = E.obras.get(cno);
    if (el && o) el.outerHTML = el.classList.contains("linha-obra") ? linha(o) : ficha(o);
    const d = $("detalhe");
    if (d.open && d.dataset.cno === cno) marcarSelecionada(cno);
    renderAbas();
  }

  // ------------------------------------------------------------ lista compacta (uma linha por obra)
  function cabecalhoLista() {
    const f = E.filtros[E.vista];
    const col = (rot, ordem) => ordem
      ? `<button type="button" data-ordenar="${ordem}" aria-sort="${f.ordem === ordem ? "descending" : "none"}">${rot}${f.ordem === ordem ? " ▾" : ""}</button>`
      : `<span>${rot}</span>`;
    return `<div class="cab-lista" aria-hidden="true">
      ${col("Cidade", "cidade")}${col("Obra", "")}${col("Tipo", "")}${col("Área", "area")}${col("Fase", "prioridade")}${col("Agora", "")}
      ${E.vista === "todas" ? col("Vendedor", "") : col("Andamento", "proxima")}</div>`;
  }
  function linha(o) {
    const barra = o.pct == null ? "" : `<span class="barra${o.passou ? " passou" : ""}"><i style="width:${Math.min(o.pct, 100).toFixed(0)}%"></i></span>`;
    const agora = o.janelas.length
      ? o.janelas.map((j) => `<span class="mini" style="--c:${j.cor}">${esc(JANELA_CURTA[j.nome])}</span>`).join("")
      : o.passou ? `<span class="fraco">passou do prazo</span>` : `<span class="fraco">—</span>`;
    const avisos = [o.nova ? `<span class="novo" title="Entrou na base nos últimos 7 dias">News</span>` : "", !o.cnpj ? `<span class="alerta">pessoa física</span>` : "",
      o.susp ? `<span class="alerta">área suspeita</span>` : ""].join("");
    let vend;
    if (E.vista === "todas") {
      const encs = encDe(o.cno);
      if (encs.length) {
        vend = encs.map((e) => { const st = (acompDe(o.cno, e.vendedor_id) || {}).status || "nova";
          return `<span class="quem">${esc(nomeDe(e.vendedor_id))} <span class="status" data-s="${st}">${esc(STATUS_NOME[st])}</span></span>`; }).join("");
      } else {
        const opcoes = E.perfis.filter((p) => p.ativo);
        vend = `<select data-encaminhar="${esc(o.cno)}" aria-label="Encaminhar obra"><option value="">Encaminhar…</option>${opcoes.map((p) => `<option value="${esc(p.id)}">${esc(p.nome || p.email)}</option>`).join("")}</select>`;
      }
    } else {
      const a = acompDe(o.cno, E.eu.id) || {}, st = a.status || "nova";
      vend = `<select data-status-obra="${esc(o.cno)}" aria-label="Andamento">${STATUS.map(([k, r]) => `<option value="${k}" ${k === st ? "selected" : ""}>${r}</option>`).join("")}</select>
        ${a.proxima_acao ? `<span class="fraco">próxima ação ${dataBR(a.proxima_acao)}</span>` : ""}`;
    }
    const n = E.notas.get(o.cno) || 0;
    return `<div class="linha-obra" data-cno="${esc(o.cno)}" tabindex="0" role="button" aria-label="Abrir ${esc(o.tNome)}">
      <div class="c-cidade"><span class="mun">${esc(o.tMun || titulo(o.municipio))}</span><span class="bairro">${esc(o.tBairro)}</span></div>
      <div class="c-obra"><span class="t">${esc(o.tNome)}</span>
        <span class="s">${o.responsavel && o.responsavel !== o.nome ? esc(o.tResp) + " · " : ""}${esc(o.cnpjF || QUALIF[o.qualificacao] || "")}${n ? ` · ${n} anotaç${n === 1 ? "ão" : "ões"}` : ""}</span>
        ${avisos ? `<span class="avisos">${avisos}</span>` : ""}</div>
      <div class="c-tipo"><span class="tipo">${ico(ICONE[o.destinacao] || "predio")}${esc(TIPO_CURTO[o.destinacao] || o.destinacao || "—")}</span>${o.categoria && o.categoria !== "Obra Nova" ? `<span class="fraco">${esc(o.categoria)}</span>` : ""}</div>
      <div class="c-area"><b>${o.area ? nf.format(Math.round(o.area)) : "–"}</b><small>m²</small></div>
      <div class="c-fase"><span><b>${esc(o.fase)}</b>${o.pct == null ? "" : ` <span class="fraco">${nf.format(Math.round(o.pct))}%</span>`}</span>${barra}</div>
      <div class="c-agora">${agora}</div>
      <div class="c-vend">${vend}</div>
    </div>`;
  }

  // ------------------------------------------------------------ ações
  async function encaminhar(cno, vid) {
    const { error } = await E.sb.from("encaminhamentos").insert({ cno, vendedor_id: vid, encaminhado_por: E.eu.id });
    if (error) return falha(error, "Não foi possível encaminhar");
    E.enc.push({ cno, vendedor_id: vid, encaminhado_em: new Date().toISOString() });
    atualizarFicha(cno);
    toast("Encaminhada para " + nomeDe(vid));
  }
  async function remover(cno, vid) {
    const { error } = await E.sb.from("encaminhamentos").delete().eq("cno", cno).eq("vendedor_id", vid);
    if (error) return falha(error, "Não foi possível tirar");
    E.enc = E.enc.filter((e) => !(e.cno === cno && e.vendedor_id === vid));
    atualizarFicha(cno);
    toast("Tirada de " + nomeDe(vid));
  }
  async function salvarAcomp(cno, mudanca) {
    const atual = acompDe(cno, E.eu.id) || { cno, vendedor_id: E.eu.id, status: "nova", proxima_acao: null };
    const novo = { ...atual, ...mudanca, atualizado_em: new Date().toISOString() };
    const { error } = await E.sb.from("acompanhamento").upsert({
      cno, vendedor_id: E.eu.id, status: novo.status, proxima_acao: novo.proxima_acao || null, atualizado_em: novo.atualizado_em,
    }, { onConflict: "cno,vendedor_id" });
    if (error) return falha(error, "Não foi possível salvar");
    E.acomp.set(cno + "|" + E.eu.id, novo);
    if (E.modo === "quadro" && (E.vista === "todas" || E.vista === "minhas") && $("grade")) aplicar();
    else if (E.vista === "minhas" && $("chips")) renderChips(baseFiltrada());
    toast(mudanca.status ? "Andamento: " + STATUS_NOME[mudanca.status] : "Próxima ação salva");
  }
  // abre a ficha da empresa no CNPJá (site público de consulta de CNPJ), numa nova aba
  function linkCnpja(cnpj) {
    const n = String(cnpj || "").replace(/\D/g, "");
    return n.length === 14 ? `<a class="copiar" href="https://cnpja.com/office/${n}" target="_blank" rel="noopener noreferrer">Ver no CNPJá ↗</a>` : "";
  }
  async function copiar(btn) {
    const txt = btn.dataset.copiar;
    try { await navigator.clipboard.writeText(txt); btn.textContent = "Copiado"; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(btn.previousElementSibling || btn);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "Selecionado";
    }
    setTimeout(() => (btn.textContent = "Copiar CNPJ"), 1500);
  }

  // ------------------------------------------------------------ painel lateral
  // Tela larga: painel à direita, sem cobrir a lista (dá para tocar em outra obra).
  // Tela estreita: o painel desliza por cima, com fundo escurecido.
  const TELA_LARGA = window.matchMedia("(min-width: 1100px)");
  function medirTopo() {
    const topo = document.querySelector(".topo");
    if (topo) document.documentElement.style.setProperty("--topo-h", topo.getBoundingClientRect().height + "px");
  }
  function abrirPainel(dlg) {
    medirTopo();
    if (TELA_LARGA.matches) {
      if (dlg.open && dlg.matches(":modal")) dlg.close();
      if (!dlg.open) dlg.show();
      document.body.classList.add("com-painel");
    } else if (!dlg.open) {
      dlg.showModal();
    }
    dlg.scrollTop = 0;
  }
  function marcarSelecionada(valor, attr = "cno") {
    document.querySelectorAll("#grade .selecionada").forEach((el) => el.classList.remove("selecionada"));
    if (valor) { const el = document.querySelector(`#grade [data-${attr}="${CSS.escape(valor)}"]`); if (el) el.classList.add("selecionada"); }
  }
  // reabre o que está no painel (obra ou construtora), depois de uma alteração
  function reabrir() {
    const d = $("detalhe");
    if (d.dataset.cno) return abrirDetalhe(d.dataset.cno, d.dataset.voltar || null);
    if (d.dataset.basico) return abrirEmpresa(d.dataset.basico);
  }

  // ------------------------------------------------------------ painel de detalhes e anotações
  function controleEncaminhar(o) {
    const encs = encDe(o.cno), ja = new Set(encs.map((e) => e.vendedor_id));
    const tirar = encs.map((e) => `<button class="btn discreto" type="button" data-remover="${esc(o.cno)}" data-vendedor="${esc(e.vendedor_id)}">Tirar de ${esc(nomeDe(e.vendedor_id))}</button>`).join("");
    const opcoes = E.perfis.filter((p) => p.ativo && !ja.has(p.id));
    return `<div class="linha">${opcoes.length ? `<select data-encaminhar="${esc(o.cno)}" aria-label="Encaminhar obra"><option value="">Encaminhar para…</option>${opcoes.map((p) => `<option value="${esc(p.id)}">${esc(p.nome || p.email)}</option>`).join("")}</select>` : ""}${tirar}</div>`;
  }
  async function abrirDetalhe(cno, voltar) {
    const o = E.obras.get(cno);
    if (!o) return;
    const h = cabecalhoObra(o);
    const encs = encDe(cno);
    const andamento = encs.length ? encs.map((e) => {
      const a = acompDe(cno, e.vendedor_id) || {};
      const st = a.status || "nova";
      return `<div class="pessoa" style="padding-right:12px">${esc(nomeDe(e.vendedor_id))} <span class="status" data-s="${st}">${esc(STATUS_NOME[st])}</span>${a.proxima_acao ? ` · próxima ação ${dataBR(a.proxima_acao)}` : ""}</div>`;
    }).join("") : `<p style="margin:0;color:var(--muted)">Ainda não encaminhada.</p>`;
    const dlg = $("detalhe");
    dlg.innerHTML = `
      <div class="cab-dialog"><h3>${esc(o.tNome)}</h3><button class="btn discreto" type="button" data-fechar aria-label="Fechar">${ico("fechar")}</button></div>
      ${voltar && E.construtoras.get(voltar) ? `<button class="voltar" type="button" data-abrir-empresa="${esc(voltar)}">← ${esc(E.construtoras.get(voltar).nome)}</button>` : ""}
      ${voltar === "lista" && I.ultimaLista ? `<button class="voltar" type="button" data-voltar-lista="1">← ${esc(I.ultimaLista.titulo)}</button>` : ""}
      ${h.cidade}
      <div class="conteudo">
        ${h.tipos}${h.resp}${h.local}${blocoTempo(o)}
        ${minha(cno) ? `<section><h4>Meu andamento</h4>${(E.vistaDialog = true, seletorStatus(o))}</section>` : ""}
        <section><h4>Andamento da equipe</h4><div class="atribuidos">${andamento}</div>${ehAdmin() ? controleEncaminhar(o) : ""}</section>
        ${E.temEmpresas && (E.links.get(cno) || []).length ? `<section><h4>Empresas desta obra</h4><div class="empresas-obra">${empresasDaObra(cno)}</div></section>`
          : o.tVinc ? `<section><h4>Empresas ligadas à obra</h4><p style="margin:0">${esc(o.tVinc)}</p></section>` : ""}
        <section><h4>Anotações</h4>
          <form id="form-nota" class="notas">
            <textarea id="nota-texto" placeholder="Ex.: Falei com o engenheiro Carlos, pediu proposta de porcelanato para o hall." maxlength="5000"></textarea>
            <button class="btn primario" type="submit">Salvar anotação</button>
          </form>
          <div class="notas" id="lista-notas"><p style="margin:0;color:var(--muted)">Carregando anotações…</p></div>
        </section>
        <div class="rodape"><span>Início ${dataBR(o.data_inicio)}</span><span>Cadastro ${dataBR(o.data_registro)}</span><span class="mono">CNO ${esc(fmtCno(o.cno))}</span></div>
      </div>`;
    E.vistaDialog = false;
    dlg.dataset.cno = cno;
    dlg.dataset.basico = "";
    dlg.dataset.lista = "";
    dlg.dataset.voltar = voltar || "";
    abrirPainel(dlg);
    marcarSelecionada(cno);
    await carregarNotas(cno);
  }
  async function carregarNotas(cno) {
    const { data, error } = await E.sb.from("anotacoes").select("id,texto,criado_em,autor_id").eq("cno", cno).order("criado_em", { ascending: false });
    const alvo = $("lista-notas");
    if (!alvo) return;
    if (error) { alvo.innerHTML = `<div class="aviso erro">Não foi possível carregar as anotações.</div>`; return; }
    E.notas.set(cno, data.length);
    alvo.innerHTML = data.length ? data.map((n) => `<div class="nota"><div class="quem"><span><b>${esc(n.autor_id === E.eu.id ? "Você" : nomeDe(n.autor_id))}</b> · ${new Date(n.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
      ${n.autor_id === E.eu.id || ehAdmin() ? `<button class="btn discreto" type="button" data-apagar-nota="${n.id}" style="min-height:28px;padding:0 6px">apagar</button>` : ""}</div><p>${esc(n.texto)}</p></div>`).join("")
      : `<p style="margin:0;color:var(--muted)">Nenhuma anotação ainda.</p>`;
  }
  $("detalhe").addEventListener("submit", async (ev) => {
    if (ev.target.id !== "form-nota") return;
    ev.preventDefault();
    const cno = $("detalhe").dataset.cno, texto = $("nota-texto").value.trim();
    if (!texto) return;
    const btn = ev.target.querySelector("button"); btn.disabled = true;
    const { error } = await E.sb.from("anotacoes").insert({ cno, texto, autor_id: E.eu.id });
    btn.disabled = false;
    if (error) return falha(error, "Não foi possível salvar a anotação");
    $("nota-texto").value = "";
    await carregarNotas(cno);
    atualizarFicha(cno);
    toast("Anotação salva");
  });
  $("detalhe").addEventListener("click", async (ev) => {
    // fecha pelo X; no modo sobreposto (tela estreita), também tocando fora do painel
    if (ev.target.closest("[data-fechar]") || (ev.target === $("detalhe") && $("detalhe").matches(":modal"))) return $("detalhe").close();
    const ap = ev.target.closest("[data-apagar-nota]");
    if (ap) {
      if (ap.dataset.confirmar !== "1") { ap.dataset.confirmar = "1"; ap.textContent = "toque de novo para apagar"; return; }
      const { error } = await E.sb.from("anotacoes").delete().eq("id", Number(ap.dataset.apagarNota));
      if (error) return falha(error, "Não foi possível apagar");
      const cno = $("detalhe").dataset.cno;
      await carregarNotas(cno); atualizarFicha(cno);
    }
  });

  // ------------------------------------------------------------ construtoras
  const PAPEL = { "0053": "Construtora", "0057": "Dona da obra", "0070": "Proprietária", "0064": "Incorporadora",
    "0109": "Consórcio", "0110": "Construção coletiva", "0111": "Líder de consórcio" };
  const papelDe = (l) => (l.papel === "vinculo" && l.qualificacao === "0053" ? "Construtora contratada" : PAPEL[l.qualificacao] || "Outro papel");
  const fmtRaiz = (b) => `${b.slice(0, 2)}.${b.slice(2, 5)}.${b.slice(5, 8)}`;
  const deEmpresaSalva = (cno) => (E.links.get(cno) || []).some((l) => E.salvas.has(l.cnpj_basico));

  function montarConstrutoras() {
    const m = new Map();
    for (const [cno, ls] of E.links) {
      const o = E.obras.get(cno);
      if (!o) continue;
      for (const l of ls) {
        let c = m.get(l.cnpj_basico);
        if (!c) {
          const emp = E.empresas.get(l.cnpj_basico) || {};
          c = { basico: l.cnpj_basico, emp, obras: new Map(), papeis: new Set(), nome: titulo(emp.nome || "CNPJ " + fmtRaiz(l.cnpj_basico)) };
          m.set(l.cnpj_basico, c);
        }
        c.obras.set(cno, o);
        c.papeis.add(papelDe(l));
      }
    }
    for (const c of m.values()) resumirConstrutora(c);
    E.construtoras = m;
  }
  function resumirConstrutora(c) {
    const obras = [...c.obras.values()];
    const cidades = new Map(), equipe = new Set(), janelas = new Map();
    let area = 0;
    obras.forEach((o) => {
      cidades.set(o.municipio, (cidades.get(o.municipio) || 0) + 1);
      area += o.susp ? 0 : o.area || 0;
      encDe(o.cno).forEach((e) => equipe.add(nomeDe(e.vendedor_id)));
      o.janelas.filter((j) => j.ini > 0).forEach((j) => janelas.set(j.nome, (janelas.get(j.nome) || 0) + 1));
    });
    Object.assign(c, {
      lista: obras, n: obras.length, area, equipe: [...equipe],
      naJanela: obras.filter((o) => o.janelas.some((j) => j.ini > 0)).length,
      andamento: obras.filter((o) => !o.passou).length,
      janelas, cidades: [...cidades.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
      tipos: new Set(obras.map((o) => o.destinacao || "Não informado")),
      busca: sem([c.nome, c.emp.nome, c.basico, fmtRaiz(c.basico), ...(c.emp.cnpjs || [])].join(" ")),
    });
  }
  const ORDENS_EMP = {
    janela: (a, b) => b.naJanela - a.naJanela || b.n - a.n || b.area - a.area,
    obras: (a, b) => b.n - a.n || b.naJanela - a.naJanela,
    area: (a, b) => b.area - a.area,
    historico: (a, b) => (b.emp.obras_total || 0) - (a.emp.obras_total || 0) || b.n - a.n,
    nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
  };
  function renderConstrutoras() {
    const c = $("conteudo");
    if (!E.temEmpresas) {
      c.innerHTML = `<p class="vazio">As construtoras ainda estão sendo preparadas no banco. Volte em alguns minutos e recarregue a página.</p>`;
      return;
    }
    const f = (E.filtros.construtoras = E.filtros.construtoras || { busca: "", mun: "", dest: "", papel: "", salvas: false, ordem: "janela" });
    for (const x of E.construtoras.values()) resumirConstrutora(x); // reflete encaminhamentos recentes
    const todas = [...E.construtoras.values()];
    const conta = (fn) => { const m = {}; todas.forEach((x) => fn(x).forEach((k) => (m[k] = (m[k] || 0) + 1))); return m; };
    const opt = (obj, sel, fmt) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(fmt ? fmt(k) : k)} (${n})</option>`).join("");
    const ordens = [["janela", "Mais obras na janela agora"], ["obras", "Mais obras"], ["area", "Maior área somada"], ["historico", "Mais obras no histórico"], ["nome", "Nome (A–Z)"]];
    c.innerHTML = `
      <section class="painel" aria-label="Filtros">
        <div class="linha">
          <div class="campo largo"><label for="f-busca">Buscar</label><input id="f-busca" type="search" value="${esc(f.busca)}" placeholder="Nome da empresa ou CNPJ…" autocomplete="off"></div>
          <div class="campo"><label for="f-mun">Com obra em</label><select id="f-mun"><option value="">Todos os municípios</option>${opt(conta((x) => x.cidades), f.mun, titulo)}</select></div>
          <div class="campo"><label for="f-dest">Com obra do tipo</label><select id="f-dest"><option value="">Todos os tipos</option>${opt(conta((x) => [...x.tipos]), f.dest)}</select></div>
          <div class="campo"><label for="f-papel">Papel</label><select id="f-papel"><option value="">Todos</option>${opt(conta((x) => [...x.papeis]), f.papel)}</select></div>
          <div class="campo"><label for="f-ordem">Ordenar por</label><select id="f-ordem">${ordens.map(([k, r]) => `<option value="${k}" ${f.ordem === k ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        </div>
        <div class="chips" id="chips" role="group" aria-label="Quais construtoras"></div>
      </section>
      <div class="resumo"><span><strong id="qtd">0</strong> <span id="qtd-rot">construtoras</span> <small class="hoje-rot">${rotAtualizacao()}</small></span></div>
      <div class="lista" id="grade"></div>
      <button class="btn mais" id="mais" type="button" hidden>Mostrar mais</button>`;
    aplicarConstrutoras();
  }
  function aplicarConstrutoras() {
    const f = E.filtros.construtoras, q = sem(f.busca.trim());
    const base = [...E.construtoras.values()].filter((x) => (!q || x.busca.includes(q)) && (!f.mun || x.cidades.includes(f.mun)) &&
      (!f.dest || x.tipos.has(f.dest)) && (!f.papel || x.papeis.has(f.papel)) && (!f.soJanela || x.naJanela > 0));
    const nSalvas = base.filter((x) => E.salvas.has(x.basico)).length;
    $("chips").innerHTML = `
      <button type="button" class="chip todas" data-filtro-salvas="0" aria-pressed="${!f.salvas}"><span class="dot"></span>Todas <b>${nf.format(base.length)}</b></button>
      <button type="button" class="chip estrela-chip" data-filtro-salvas="1" aria-pressed="${f.salvas}"><span aria-hidden="true">★</span> Minhas construtoras <b>${nf.format(nSalvas)}</b></button>${f.soJanela ? `<button type="button" class="chip especial" data-tirar-sojanela>Com obra na janela agora ×</button>` : ""}`;
    E.lista = base.filter((x) => !f.salvas || E.salvas.has(x.basico)).sort(ORDENS_EMP[f.ordem] || ORDENS_EMP.janela);
    $("qtd").textContent = nf.format(E.lista.length);
    $("qtd-rot").textContent = E.lista.length === 1 ? "construtora" : "construtoras";
    E.mostradas = 0;
    $("grade").innerHTML = E.lista.length ? cabecalhoEmpresas() : `<p class="vazio">${f.salvas && !nSalvas
      ? "Você ainda não salvou nenhuma construtora. Toque na ☆ ao lado do nome para salvar."
      : "Nenhuma construtora com esses filtros."}</p>`;
    desenharMaisEmpresas();
  }
  function desenharMaisEmpresas() {
    const lote = E.lista.slice(E.mostradas, E.mostradas + LOTE_LISTA);
    $("grade").insertAdjacentHTML("beforeend", lote.map(linhaEmpresa).join(""));
    E.mostradas += lote.length;
    const falta = E.lista.length - E.mostradas;
    $("mais").hidden = falta <= 0;
    $("mais").textContent = `Mostrar mais ${nf.format(Math.min(LOTE_LISTA, falta))} de ${nf.format(falta)}`;
  }
  function cabecalhoEmpresas() {
    const f = E.filtros.construtoras;
    const col = (rot, ordem) => ordem ? `<button type="button" data-ordenar="${ordem}">${rot}${f.ordem === ordem ? " ▾" : ""}</button>` : `<span>${rot}</span>`;
    return `<div class="cab-lista cab-emp" aria-hidden="true"><span></span>${col("Construtora", "nome")}${col("Obras", "obras")}${col("Na janela agora", "janela")}${col("Área", "area")}<span>Cidades</span>${col("Histórico", "historico")}<span>Equipe</span></div>`;
  }
  function estrela(basico) {
    const on = E.salvas.has(basico);
    return `<button type="button" class="estrela" data-estrela="${esc(basico)}" aria-pressed="${on}" aria-label="${on ? "Tirar de" : "Salvar em"} minhas construtoras">${on ? "★" : "☆"}</button>`;
  }
  function janelasResumo(c) {
    if (!c.naJanela) return `<span class="fraco">nenhuma agora</span>`;
    return `<b class="num">${c.naJanela}</b> ` + JANELAS.filter((j) => c.janelas.get(j.nome)).map((j) => `<span class="mini" style="--c:${j.cor}">${esc(JANELA_CURTA[j.nome])} ${c.janelas.get(j.nome)}</span>`).join("");
  }
  function historico(c) {
    const e = c.emp;
    if (!e.obras_total) return `<span class="fraco">—</span>`;
    return `<span>${nf.format(e.obras_total)} obra${e.obras_total === 1 ? "" : "s"} no PA</span><span class="fraco">desde ${e.primeira_obra ? e.primeira_obra.slice(0, 4) : "?"} · última ${e.ultima_obra ? e.ultima_obra.slice(5, 7) + "/" + e.ultima_obra.slice(0, 4) : "?"}</span>`;
  }
  function linhaEmpresa(c) {
    const filiais = (c.emp.cnpjs || []).length;
    const cid = c.cidades.slice(0, 2).map(titulo).join(", ") + (c.cidades.length > 2 ? ` +${c.cidades.length - 2}` : "");
    return `<div class="linha-emp" data-basico="${esc(c.basico)}" tabindex="0" role="button" aria-label="Abrir ${esc(c.nome)}">
      <div class="c-est">${estrela(c.basico)}</div>
      <div class="c-nome"><span class="t">${esc(c.nome)}</span>
        <span class="s mono">${fmtRaiz(c.basico)}${filiais > 1 ? ` · ${filiais} CNPJs (matriz e filiais)` : ""}</span>
        <span class="papeis">${[...c.papeis].map((p) => `<span class="papel">${esc(p)}</span>`).join("")}</span></div>
      <div class="c-n"><b>${c.n}</b><small>${c.andamento} em andamento</small></div>
      <div class="c-jan">${janelasResumo(c)}</div>
      <div class="c-area"><b>${nf.format(Math.round(c.area))}</b><small>m²</small></div>
      <div class="c-cid">${esc(cid)}</div>
      <div class="c-hist">${historico(c)}</div>
      <div class="c-eq">${c.equipe.length ? esc(c.equipe.join(", ")) : '<span class="fraco">ninguém ainda</span>'}</div>
    </div>`;
  }
  function atualizarLinhaEmpresa(basico) {
    const el = document.querySelector(`#grade .linha-emp[data-basico="${CSS.escape(basico)}"]`);
    const c = E.construtoras.get(basico);
    if (el && c) { resumirConstrutora(c); el.outerHTML = linhaEmpresa(c); }
  }
  async function alternarSalva(basico) {
    const salvar = !E.salvas.has(basico);
    const q = salvar ? E.sb.from("empresas_salvas").insert({ usuario_id: E.eu.id, cnpj_basico: basico })
      : E.sb.from("empresas_salvas").delete().eq("usuario_id", E.eu.id).eq("cnpj_basico", basico);
    const { error } = await q;
    if (error) return falha(error, "Não foi possível salvar");
    salvar ? E.salvas.add(basico) : E.salvas.delete(basico);
    const nome = (E.construtoras.get(basico) || {}).nome || "Construtora";
    toast(salvar ? `${nome} salva em Minhas construtoras` : `${nome} tirada de Minhas construtoras`);
    document.querySelectorAll(`[data-estrela="${CSS.escape(basico)}"]`).forEach((b) => { b.outerHTML = estrela(basico); });
    if (E.vista === "construtoras" && $("chips")) {
      if (E.filtros.construtoras.salvas) aplicarConstrutoras();
      else { const n = [...E.construtoras.keys()].filter((k) => E.salvas.has(k)).length; const b = document.querySelector('[data-filtro-salvas="1"] b'); if (b) b.textContent = nf.format(n); }
    }
    const d = $("detalhe");
    if (d.open && d.dataset.basico === basico) abrirEmpresa(basico);
  }
  function empresasDaObra(cno) {
    const porRaiz = new Map();
    (E.links.get(cno) || []).forEach((l) => { if (!porRaiz.has(l.cnpj_basico)) porRaiz.set(l.cnpj_basico, new Set()); porRaiz.get(l.cnpj_basico).add(papelDe(l)); });
    return [...porRaiz.entries()].map(([b, papeis]) => {
      const c = E.construtoras.get(b);
      const nome = c ? c.nome : titulo((E.empresas.get(b) || {}).nome || "CNPJ " + fmtRaiz(b));
      return `<div class="emp-item">${estrela(b)}<div><b>${esc(nome)}</b><span class="fraco">${esc([...papeis].join(" · "))}${c && c.n > 1 ? ` · ${c.n} obras no radar` : ""}</span></div>
        ${c ? `<button class="btn" type="button" data-abrir-empresa="${esc(b)}">Ver construtora</button>` : ""}</div>`;
    }).join("");
  }
  function linhaMini(o) {
    const vend = encDe(o.cno).map((e) => nomeDe(e.vendedor_id)).join(", ");
    return `<button type="button" class="obra-mini" data-abrir-obra="${esc(o.cno)}">
      <span class="topo-mini"><span class="mun">${esc(o.tMun || titulo(o.municipio))}</span><span class="tipo-mini">${ico(ICONE[o.destinacao] || "predio")}${esc(TIPO_CURTO[o.destinacao] || o.destinacao || "—")}</span><b>${o.area ? nf.format(Math.round(o.area)) + " m²" : "–"}</b></span>
      <span class="t">${esc(o.tNome)}</span>
      <span class="rodape-mini"><span>${esc(o.fase)}${o.pct == null ? "" : " · " + nf.format(Math.round(o.pct)) + "%"}</span>
        ${o.janelas.filter((j) => j.ini > 0).map((j) => `<span class="mini" style="--c:${j.cor}">${esc(JANELA_CURTA[j.nome])}</span>`).join("")}
        ${vend ? `<span class="fraco">· ${esc(vend)}</span>` : ""}</span>
    </button>`;
  }
  function abrirEmpresa(basico) {
    const c = E.construtoras.get(basico);
    if (!c) return;
    resumirConstrutora(c);
    const e = c.emp, salva = E.salvas.has(basico);
    const obras = [...c.lista].sort(prioridade);
    const dlg = $("detalhe");
    dlg.innerHTML = `
      <div class="cab-dialog"><h3>${esc(c.nome)}</h3><button class="btn discreto" type="button" data-fechar aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="cidade"><div class="lugar"><span class="mun" style="font-size:18px">${esc(c.nome)}</span><span class="bairro mono">CNPJ ${fmtRaiz(basico)}${(e.cnpjs || []).length > 1 ? ` · ${(e.cnpjs || []).length} CNPJs` : ""}</span></div>
        <div class="area"><b>${c.n}</b><small>obra${c.n === 1 ? "" : "s"}</small></div></div>
      <div class="conteudo">
        <button class="btn ${salva ? "" : "primario"}" type="button" data-estrela="${esc(basico)}">${salva ? "★ Salva em Minhas construtoras · tirar" : "☆ Salvar em Minhas construtoras"}</button>
        <div class="papeis">${[...c.papeis].map((p) => `<span class="papel">${esc(p)}</span>`).join("")}</div>
        <div class="numeros">
          <div><b>${c.naJanela}</b><span>na janela de produto agora</span></div>
          <div><b>${c.andamento}</b><span>em andamento (pelo prazo)</span></div>
          <div><b>${nf.format(Math.round(c.area))}</b><span>m² somados</span></div>
          <div><b>${e.obras_total ? nf.format(e.obras_total) : "–"}</b><span>obras no PA desde ${e.primeira_obra ? e.primeira_obra.slice(0, 4) : "?"}</span></div>
        </div>
        ${c.naJanela ? `<div class="agora"><span class="rot">Janelas abertas:</span>${janelasResumo(c)}</div>` : ""}
        <section><h4>Cidades</h4><p style="margin:0">${esc(c.cidades.map(titulo).join(", "))}</p></section>
        <section><h4>Equipe atendendo</h4><p style="margin:0">${c.equipe.length ? esc(c.equipe.join(", ")) : "Nenhuma obra desta construtora encaminhada ainda."}</p></section>
        <section><h4>Obras no radar (${c.n})</h4><div class="obras-mini">${obras.map(linhaMini).join("")}</div></section>
        <p class="fraco" style="margin:0">Telefone e e-mail entram aqui na próxima etapa (consulta de CNPJ).</p>
      </div>`;
    dlg.dataset.cno = "";
    dlg.dataset.voltar = "";
    dlg.dataset.lista = "";
    dlg.dataset.basico = basico;
    abrirPainel(dlg);
    marcarSelecionada(basico, "basico");
  }

  // ------------------------------------------------------------ insights (só admin)
  const AREAS = [["", "Qualquer"], ["100", "100 m² ou mais"], ["300", "300 m² ou mais"], ["800", "800 m² ou mais"], ["2000", "2.000 m² ou mais"], ["5000", "5.000 m² ou mais"]];
  const DIA = 86400000;
  const ESPECIAIS = {
    novas30: { rotulo: "Cadastradas nos últimos 30 dias", teste: (o) => o.data_registro && new Date(o.data_registro + "T00:00:00") >= new Date(HOJE - 30 * DIA) },
  };
  const PRODUTOS = JANELAS.filter((j) => j.ini > 0);
  const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  // tipos do Mercado, na ordem fixa da paleta validada (cores --serie-1 a 6)
  const GRUPOS = [
    { id: "casa", nome: "Casa", de: ["Residencial unifamiliar"] },
    { id: "predio", nome: "Prédio residencial", de: ["Residencial multifamiliar"] },
    { id: "comercial", nome: "Comercial", de: ["Comercial salas e lojas"] },
    { id: "galpao", nome: "Galpão", de: ["Galpão industrial"] },
    { id: "popular", nome: "Habitação popular", de: ["Casa popular", "Conjunto habitacional popular"] },
    { id: "outros", nome: "Outros", de: ["Edifício de Garagens", "Sem área informada"] },
  ].map((g, i) => ({ ...g, cor: `var(--serie-${i + 1})` }));
  const grupoDe = (tipo) => (GRUPOS.find((g) => g.de.includes(tipo)) || GRUPOS[GRUPOS.length - 1]).id;
  const MERC_DESDE = "2020-01-01";
  const compacto = (v) => (v >= 1e6 ? nf.format(Math.round(v / 1e5) / 10) + " mi" : v >= 1e4 ? nf.format(Math.round(v / 1e3)) + " mil" : nf.format(Math.round(v)));

  const I = { aba: "demanda", d: { mun: "", dest: "", area: "", metrica: "obras" },
    m: { gran: "trimestre", metrica: "obras", cidade: "", grupo: "", infra: false, ordemCid: "volume", todasCid: false },
    cacheTipo: new Map(), cacheCid: new Map(), celulas: new Map(), carregando: false };

  function entrada(o, j) {
    if (!o.data_inicio) return null;
    return new Date(new Date(o.data_inicio + "T00:00:00").getTime() + o.prazo * 30.44 * DIA * j.ini / 100);
  }
  const radar = () => [...E.obras.values()].filter((o) => o.recorte);

  function renderInsights() {
    $("conteudo").innerHTML = `
      <div class="resumo"><div class="modos" role="group" aria-label="Seção dos insights">
        <button type="button" data-insights-aba="demanda" aria-pressed="${I.aba === "demanda"}">Demanda prevista</button>
        <button type="button" data-insights-aba="mercado" aria-pressed="${I.aba === "mercado"}">Mercado</button>
        <button type="button" data-insights-aba="mapa" aria-pressed="${I.aba === "mapa"}">Mapa</button>
      </div></div>
      <div id="insights-corpo" class="insights"></div>`;
    if (I.aba === "mapa") return renderMapa();
    I.aba === "demanda" ? renderDemanda() : renderMercado();
  }

  // ---------- demanda prevista
  function renderDemanda() {
    const r = radar();
    const porMun = {}, porDest = {};
    r.forEach((o) => { porMun[o.municipio] = (porMun[o.municipio] || 0) + 1; porDest[o.destinacao || "Não informado"] = (porDest[o.destinacao || "Não informado"] || 0) + 1; });
    const opt = (obj, sel, fmt) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(fmt ? fmt(k) : k)} (${n})</option>`).join("");
    const d = I.d;
    // números do topo
    const em90 = new Date(HOJE.getTime() + 90 * DIA);
    const novas = r.filter(ESPECIAIS.novas30.teste).length;
    const entram = r.filter((o) => PRODUTOS.some((j) => { const e = entrada(o, j); return e && e > HOJE && e <= em90; }));
    const cJanela = [...E.construtoras.values()].filter((c) => c.naJanela > 0).length;
    I.entram90 = entram;
    $("insights-corpo").innerHTML = `
      <div class="kpis">
        <button type="button" class="kpi" data-kpi="radar"><span class="rot">Obras no radar</span><b>${nf.format(r.length)}</b><span class="sub">ativas, iniciadas desde 2023</span></button>
        <button type="button" class="kpi" data-kpi="novas"><span class="rot">Cadastradas nos últimos 30 dias</span><b>${nf.format(novas)}</b><span class="sub">ver a lista</span></button>
        <button type="button" class="kpi" data-kpi="entram"><span class="rot">Entram numa janela em 90 dias</span><b>${nf.format(entram.length)}</b><span class="sub">Vibra, Mohawk, Lorenzetti ou Assa Abloy</span></button>
        <button type="button" class="kpi" data-kpi="construtoras"><span class="rot">Construtoras com obra na janela</span><b>${nf.format(cJanela)}</b><span class="sub">ver construtoras</span></button>
      </div>
      <section class="painel">
        <div class="linha">
          <div class="campo"><label for="d-mun">Município</label><select id="d-mun"><option value="">Todos</option>${opt(porMun, d.mun, titulo)}</select></div>
          <div class="campo"><label for="d-dest">Tipo de obra</label><select id="d-dest"><option value="">Todos</option>${opt(porDest, d.dest)}</select></div>
          <div class="campo"><label for="d-area">Área mínima</label><select id="d-area">${AREAS.map(([v, rot]) => `<option value="${v}" ${d.area === v ? "selected" : ""}>${rot}</option>`).join("")}</select></div>
          <div class="campo"><span class="rotulo">Contar</span><div class="modos" role="group" aria-label="Contar por">
            <button type="button" data-d-metrica="obras" aria-pressed="${d.metrica === "obras"}">Obras</button>
            <button type="button" data-d-metrica="m2" aria-pressed="${d.metrica === "m2"}">m²</button></div></div>
        </div>
      </section>
      <section class="cartao-viz">
        <div class="cab-viz"><h2>Demanda prevista por produto</h2>
          <p>Quantas obras do radar entram na janela de cada produto nos próximos meses, pelo prazo estimado de cada obra. Toque num número para ver as obras.</p></div>
        <div class="tabela-viz" id="matriz"></div>
        <div class="escala-viz" aria-hidden="true"><span>menos</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i style="background:var(--seq-${i})"></i>`).join("")}<span>mais</span></div>
      </section>`;
    desenharMatriz();
  }
  function desenharMatriz() {
    const d = I.d;
    const obras = radar().filter((o) => (!d.mun || o.municipio === d.mun) && (!d.dest || (o.destinacao || "Não informado") === d.dest) && (!d.area || (o.area || 0) >= Number(d.area)));
    const meses = Array.from({ length: 6 }, (_, i) => new Date(HOJE.getFullYear(), HOJE.getMonth() + i, 1));
    const fim = new Date(HOJE.getFullYear(), HOJE.getMonth() + 6, 1);
    I.celulas = new Map();
    const pega = (k) => { if (!I.celulas.has(k)) I.celulas.set(k, []); return I.celulas.get(k); };
    obras.forEach((o) => PRODUTOS.forEach((j) => {
      if (o.janelas.includes(j)) return pega(j.nome + "|agora").push(o);
      const e = entrada(o, j);
      if (!e || e <= HOJE || e >= fim) return;
      const i = (e.getFullYear() - HOJE.getFullYear()) * 12 + e.getMonth() - HOJE.getMonth();
      pega(j.nome + "|" + i).push(o);
    }));
    const valor = (lista) => (d.metrica === "m2" ? lista.reduce((s, o) => s + (o.susp ? 0 : o.area || 0), 0) : lista.length);
    let max = 0;
    PRODUTOS.forEach((j) => meses.forEach((_, i) => { max = Math.max(max, valor(I.celulas.get(j.nome + "|" + i) || [])); }));
    const passo = (v) => (v <= 0 || !max ? -1 : Math.min(5, Math.floor((v / max) * 6 - 1e-9)));
    const celula = (j, chave, destaque) => {
      const lista = I.celulas.get(j.nome + "|" + chave) || [];
      const v = valor(lista), m2 = lista.reduce((s, o) => s + (o.susp ? 0 : o.area || 0), 0);
      const outro = d.metrica === "m2" ? `${nf.format(lista.length)} obra${lista.length === 1 ? "" : "s"}` : `${compacto(m2)} m²`;
      if (!lista.length) return `<td class="vazia">–</td>`;
      const p = destaque ? -1 : passo(v);
      return `<td><button type="button" class="celula ${p >= 3 ? "escura" : ""}" style="${p >= 0 ? `background:var(--seq-${p})` : ""}" data-celula="${esc(j.nome + "|" + chave)}">
        <b>${d.metrica === "m2" ? compacto(v) : nf.format(v)}</b><small>${esc(outro)}</small></button></td>`;
    };
    $("matriz").innerHTML = `<table class="matriz">
      <thead><tr><th scope="col">Produto</th><th scope="col">Já na janela</th>${meses.map((m, i) => `<th scope="col">${i === 0 ? "Resto de " : ""}${MES_CURTO[m.getMonth()]}/${String(m.getFullYear()).slice(2)}</th>`).join("")}</tr></thead>
      <tbody>${PRODUTOS.map((j) => `<tr><th scope="row"><span class="dot" style="background:${j.cor}"></span>${esc(j.curto)}<small>${esc(j.desc)}</small></th>${celula(j, "agora", true)}${meses.map((_, i) => celula(j, i, false)).join("")}</tr>`).join("")}</tbody>
    </table>`;
  }

  // lista de obras no painel lateral (a partir de um número dos insights)
  function abrirListaObras(titulo, sub, obras, dataDe) {
    I.ultimaLista = { titulo, sub, obras, dataDe };
    const ordenadas = [...obras].sort((a, b) => (dataDe ? (dataDe(a) || 0) - (dataDe(b) || 0) : 0) || areaOk(b) - areaOk(a));
    const dlg = $("detalhe");
    dlg.innerHTML = `
      <div class="cab-dialog"><h3>${esc(titulo)}</h3><button class="btn discreto" type="button" data-fechar aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="conteudo"><p class="fraco" style="margin:0">${esc(sub)}</p>
        <div class="obras-mini">${ordenadas.map((o) => linhaMini(o).replace('data-abrir-obra=', `data-voltar-lista="1" data-abrir-obra=`)
          .replace('<span class="t">', dataDe && dataDe(o) ? `<span class="fraco">entra por volta de ${dataDe(o).toLocaleDateString("pt-BR")}</span><span class="t">` : '<span class="t">')).join("")}</div></div>`;
    dlg.dataset.cno = ""; dlg.dataset.basico = ""; dlg.dataset.voltar = "";
    dlg.dataset.lista = "1";
    abrirPainel(dlg);
  }
  function cliqueInsights(t) {
    const aba = t.closest("[data-insights-aba]");
    if (aba) { I.aba = aba.dataset.insightsAba; renderInsights(); return true; }
    const dm = t.closest("[data-d-metrica]");
    if (dm) { I.d.metrica = dm.dataset.dMetrica; renderDemanda(); return true; }
    const cel = t.closest("[data-celula]");
    if (cel) {
      const [nome, chave] = cel.dataset.celula.split("|");
      const j = PRODUTOS.find((x) => x.nome === nome);
      const lista = I.celulas.get(cel.dataset.celula) || [];
      const m2 = lista.reduce((s, o) => s + (o.susp ? 0 : o.area || 0), 0);
      if (chave === "agora") abrirListaObras(`${j.curto}: já na janela`, `${nf.format(lista.length)} obras · ${nf.format(Math.round(m2))} m²`, lista);
      else {
        const m = new Date(HOJE.getFullYear(), HOJE.getMonth() + Number(chave), 1);
        abrirListaObras(`${j.curto}: entram em ${MES_CURTO[m.getMonth()]}/${m.getFullYear()}`, `${nf.format(lista.length)} obras · ${nf.format(Math.round(m2))} m² · data estimada pelo prazo típico`, lista, (o) => entrada(o, j));
      }
      return true;
    }
    const k = t.closest("[data-kpi]");
    if (k) {
      const v = k.dataset.kpi;
      if (v === "radar") { E.filtros.todas = filtrosPadrao("todas"); location.hash = "#todas"; }
      if (v === "novas") { E.filtros.todas = { ...filtrosPadrao("todas"), especial: "novas30", ordem: "registro" }; location.hash = "#todas"; }
      if (v === "entram") {
        const prox = (o) => PRODUTOS.map((j) => entrada(o, j)).filter((e) => e && e > HOJE).sort((a, b) => a - b)[0];
        abrirListaObras("Entram numa janela em 90 dias", `${nf.format(I.entram90.length)} obras · primeira janela de produto que se abre em cada uma`, I.entram90, prox);
      }
      if (v === "construtoras") { E.filtros.construtoras = { ...(E.filtros.construtoras || {}), busca: "", mun: "", dest: "", papel: "", salvas: false, ordem: "janela", soJanela: true }; location.hash = "#construtoras"; }
      return true;
    }
    const mmo = t.closest("[data-mapa-modo]");
    if (mmo) { I.mp.modo = mmo.dataset.mapaModo; renderMapa(); return true; }
    if (t.closest("[data-mapa-todos]")) { I.mp.todos = !I.mp.todos; renderMapa(); return true; }
    const mg = t.closest("[data-mapa-grupo]");
    if (mg) {
      const nome = mg.dataset.mapaGrupo, lista = (I.mapaGrupos && I.mapaGrupos.get(nome)) || [];
      const m2 = lista.reduce((s, o) => s + (o.susp ? 0 : o.area || 0), 0);
      abrirListaObras(`${nome}: ${nf.format(lista.length)} obras no radar`, `${nf.format(Math.round(m2))} m² somados · ordenadas pela maior área`, lista);
      return true;
    }
    const mm = t.closest("[data-m]");
    if (mm) { const [chave, v] = mm.dataset.m.split(":"); I.m[chave] = v; renderMercado(); return true; }
    const cid = t.closest("[data-cidade]");
    if (cid) { I.m.cidade = I.m.cidade === cid.dataset.cidade ? "" : cid.dataset.cidade; renderMercado(); window.scrollTo({ top: 0, behavior: "smooth" }); return true; }
    if (t.closest("[data-todas-cidades]")) { I.m.todasCid = !I.m.todasCid; renderMercado(); return true; }
    return false;
  }
  function mudouInsights(t) {
    const mapaD = { "d-mun": "mun", "d-dest": "dest", "d-area": "area" };
    if (mapaD[t.id]) { I.d[mapaD[t.id]] = t.value; return desenharMatriz(); }
    if (t.id === "m-cidade") { I.m.cidade = t.value; return renderMercado(); }
    if (t.id === "m-grupo") { I.m.grupo = t.value; return renderMercado(); }
    if (t.id === "m-infra") { I.m.infra = t.checked; return renderMercado(); }
    if (t.id === "mp-dest") { I.mp.dest = t.value; return renderMapa(); }
    if (t.id === "mp-area") { I.mp.area = t.value; return renderMapa(); }
  }

  // ---------- mapa: obras do radar por município ou por mesorregião
  const APELIDOS_MUN = { "ELDORADO DOS CARAJAS": "ELDORADO DO CARAJAS", "SANTA ISABEL DO PARA": "SANTA IZABEL DO PARA" };
  const normMun = (s) => {
    const n = (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
    return APELIDOS_MUN[n] || n;
  };
  I.mp = { modo: "municipio", dest: "", area: "", todos: false };
  async function carregarGeo() {
    if (I.geo) return I.geo;
    const [mun, meso] = await Promise.all(["mapas/pa_municipios.geojson", "mapas/pa_mesorregioes.geojson"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); })));
    // projeção simples: o Pará fica perto do Equador
    let minx = 180, maxx = -180, miny = 90, maxy = -90;
    const polys = (g) => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]);
    meso.features.forEach((f) => polys(f.geometry).forEach((p) => p[0].forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); })));
    const kx = Math.cos(((miny + maxy) / 2) * Math.PI / 180), W = 1000, esc = W / ((maxx - minx) * kx), H = (maxy - miny) * esc;
    const P = ([x, y]) => [(x - minx) * kx * esc, (maxy - y) * esc];
    const forma = (f) => {
      let d = "", melhor = null, maiorArea = -1;
      polys(f.geometry).forEach((p) => p.forEach((anel, i) => {
        const pts = anel.map(P);
        d += "M" + pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L") + "Z";
        if (i) return;
        let a = 0, cx = 0, cy = 0;
        for (let k = 0; k < pts.length - 1; k++) { const c = pts[k][0] * pts[k + 1][1] - pts[k + 1][0] * pts[k][1]; a += c; cx += (pts[k][0] + pts[k + 1][0]) * c; cy += (pts[k][1] + pts[k + 1][1]) * c; }
        if (Math.abs(a) > maiorArea && a) { maiorArea = Math.abs(a); melhor = [cx / (3 * a), cy / (3 * a)]; }
      }));
      return { d, centro: melhor };
    };
    I.geo = {
      W, H,
      mun: mun.features.map((f) => ({ ...f.properties, chave: normMun(f.properties.nome), ...forma(f) })),
      meso: meso.features.map((f) => ({ ...f.properties, ...forma(f) })),
    };
    return I.geo;
  }
  async function renderMapa() {
    const corpo = $("insights-corpo");
    corpo.innerHTML = `<p class="vazio">Carregando o mapa…</p>`;
    let geo;
    try { geo = await carregarGeo(); }
    catch (e) { console.error(e); corpo.innerHTML = `<p class="vazio">Não foi possível carregar o mapa (${esc(e.message || e)}). Recarregue a página.</p>`; return; }
    const mp = I.mp, r = radar();
    const porDest = {};
    r.forEach((o) => { porDest[o.destinacao || "Não informado"] = (porDest[o.destinacao || "Não informado"] || 0) + 1; });
    const obras = r.filter((o) => (!mp.dest || (o.destinacao || "Não informado") === mp.dest) && (!mp.area || (o.area || 0) >= Number(mp.area)));
    const munPorChave = new Map(geo.mun.map((m) => [m.chave, m]));
    const grupos = new Map();   // nome do município ou da região -> obras
    let fora = 0;
    obras.forEach((o) => {
      const m = munPorChave.get(normMun(o.municipio));
      if (!m) { fora++; return; }
      const k = mp.modo === "regiao" ? m.mesorregiao : m.nome;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(o);
    });
    I.mapaGrupos = grupos;
    const n = (k) => (grupos.get(k) || []).length;
    const max = Math.max(1, ...[...grupos.values()].map((l) => l.length));
    let svg = `<svg class="mapa-svg" viewBox="0 0 ${geo.W} ${geo.H.toFixed(0)}" role="img" aria-label="Obras do radar ${mp.modo === "regiao" ? "por mesorregião" : "por município"} no Pará">`;
    if (mp.modo === "regiao") {
      const passo = (v) => (v ? Math.min(5, Math.floor((v / max) * 6 - 1e-9)) : -1);
      geo.meso.forEach((g) => {
        const v = n(g.nome), p = passo(v);
        svg += `<path d="${g.d}" class="area-meso" fill="${p < 0 ? "var(--surface-2)" : `var(--seq-${p})`}" data-mapa-grupo="${esc(g.nome)}" tabindex="0"><title>${esc(g.nome)}: ${nf.format(v)} obras</title></path>`;
      });
      geo.meso.forEach((g) => {
        if (!g.centro) return;
        const [cx, cy] = g.centro, metro = g.nome === "Metropolitana de Belém";
        const escuro = !metro && passo(n(g.nome)) >= 3 ? " sobre-escuro" : "";
        const linhas = metro ? ["Metropolitana", "de Belém"] : g.nome.replace(" Paraense", "|Paraense").split("|");
        const [ox, oy] = { "Nordeste Paraense": [-50, 45] }[g.nome] || [0, 0];
        const tx = metro ? Math.min(cx + 30, geo.W - 100) : cx + ox, ty = metro ? cy - 150 : cy + oy - 14 * linhas.length;
        if (metro) svg += `<line x1="${cx.toFixed(1)}" y1="${(cy - 8).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(ty + 64).toFixed(1)}" class="guia"/>`;
        svg += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" class="rot-mapa forte${escuro}">${linhas.map((l, i) => `<tspan x="${tx.toFixed(1)}" dy="${i ? "1.1em" : 0}">${esc(l)}</tspan>`).join("")}</text>`
          + `<text x="${tx.toFixed(1)}" y="${(ty + 28 * linhas.length + 12).toFixed(1)}" text-anchor="middle" class="rot-mapa num-mapa${escuro}">${nf.format(n(g.nome))}</text>`;
      });
    } else {
      geo.mun.forEach((m) => { svg += `<path d="${m.d}" class="area-mun"><title>${esc(m.nome)}: ${nf.format(n(m.nome))} obras</title></path>`; });
      geo.meso.forEach((g) => { svg += `<path d="${g.d}" class="borda-meso"/>`; });
      const rmax = 40, raio = (v) => rmax * Math.sqrt(v / max);
      const comObras = geo.mun.filter((m) => n(m.nome) > 0 && m.centro).sort((a, b) => n(b.nome) - n(a.nome));
      comObras.forEach((m) => {
        const [cx, cy] = m.centro;
        svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(3, raio(n(m.nome))).toFixed(1)}" class="bolha" data-mapa-grupo="${esc(m.nome)}" tabindex="0"><title>${esc(m.nome)}: ${nf.format(n(m.nome))} obras</title></circle>`;
      });
      // legenda das bolhas (no canto sudeste, que é vazio) — dentro do SVG para ter a mesma escala do mapa
      const refs = [max, max / 4, max / 16].map((v) => Math.max(1, Math.round(v))).filter((v, i, a) => a.indexOf(v) === i);
      const lx = 840, lb = geo.H - 24, LEG = [790, lb - 2 * rmax - 52, geo.W, geo.H];
      svg += `<g class="leg-mapa" aria-hidden="true"><text x="${LEG[0]}" y="${lb - 2 * rmax - 22}" class="rot-mapa leg-tit">Nº de obras</text>`;
      refs.forEach((v) => {
        const rr = Math.max(3, raio(v)), topo = lb - 2 * rr;
        svg += `<circle cx="${lx}" cy="${(lb - rr).toFixed(1)}" r="${rr.toFixed(1)}" class="bolha leg"/>`
          + `<line x1="${lx}" y1="${topo.toFixed(1)}" x2="${lx + rmax + 14}" y2="${topo.toFixed(1)}" class="guia"/>`
          + `<text x="${lx + rmax + 20}" y="${(topo + 7).toFixed(1)}" class="rot-mapa">${nf.format(v)}</text>`;
      });
      svg += `</g>`;
      // nomes das maiores: ao lado da bolha, sem cobrir outro nome nem outra bolha;
      // se não couber (aglomerado de Belém), vai para o mar ao nordeste com uma linha-guia
      const bolhas = comObras.map((m) => ({ nome: m.nome, cx: m.centro[0], cy: m.centro[1], r: Math.max(3, raio(n(m.nome))) })).filter((b) => b.r >= 5);
      const toca = (c, b) => { const dx = b.cx - Math.max(c[0], Math.min(b.cx, c[2])), dy = b.cy - Math.max(c[1], Math.min(b.cy, c[3])); return dx * dx + dy * dy < b.r * b.r; };
      const cruza = (a, c) => !(a[2] < c[0] || a[0] > c[2] || a[3] < c[1] || a[1] > c[3]);
      const caixas = [LEG], noMar = [];
      const rotulo = (m) => `${esc(m.nome)} <tspan class="fraco-mapa">${nf.format(n(m.nome))}</tspan>`;
      comObras.slice(0, 30).forEach((m) => {
        if (caixas.length > 12) return;
        const [cx, cy] = m.centro, rr = Math.max(3, raio(n(m.nome)));
        const txt = `${m.nome} ${nf.format(n(m.nome))}`, w = txt.length * 11.6, h = 26;
        const opcoes = [[cx + rr + 5, cy + 7, "start"], [cx - rr - 5, cy + 7, "end"], [cx, cy - rr - 8, "middle"], [cx, cy + rr + 24, "middle"]];
        for (const [x, y, anc] of opcoes) {
          const x0 = anc === "start" ? x : anc === "end" ? x - w : x - w / 2;
          const caixa = [x0, y - 19, x0 + w, y - 19 + h];
          if (caixa[0] < 0 || caixa[2] > geo.W || caixa[1] < 0 || caixa[3] > geo.H) continue;
          if (caixas.some((c) => cruza(caixa, c)) || bolhas.some((b) => b.nome !== m.nome && toca(caixa, b))) continue;
          caixas.push(caixa);
          svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anc}" class="rot-mapa rot-mun">${rotulo(m)}</text>`;
          return;
        }
        if (cx > geo.W * 0.6 && cy < geo.H * 0.4 && noMar.length < 6) { noMar.push({ m, cx, cy, rr, w }); caixas.push([0, 0, 0, 0]); }
      });
      // nomes que foram para o mar: coluna à esquerda das bolhas, alinhada à direita; a bolha mais a leste
      // fica no alto, assim as linhas-guia não se cruzam nem passam por cima dos nomes
      if (noMar.length) {
        const x = Math.max(...noMar.map((c) => c.w)) + 8 > Math.min(...noMar.map((c) => c.cx - c.rr)) - 30 ? geo.W - 8 : Math.min(...noMar.map((c) => c.cx - c.rr)) - 30;
        const base = Math.min(230, Math.min(...noMar.map((c) => c.cy - c.rr)) - 40);
        noMar.sort((a, b) => b.cx - a.cx).forEach((c, k) => {
          const y = base - 34 * (noMar.length - 1 - k);
          svg += `<polyline points="${c.cx.toFixed(1)},${(c.cy - c.rr).toFixed(1)} ${(x + 6).toFixed(1)},${(y - 7).toFixed(1)}" class="guia rot-mun"/>`
            + `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" class="rot-mapa rot-mun">${rotulo(c.m)}</text>`;
        });
      }
    }
    svg += `</svg>`;
    const legenda = mp.modo === "regiao"
      ? `<div class="escala-viz"><span>menos</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i style="background:var(--seq-${i})"></i>`).join("")}<span>mais obras</span></div>` : "";
    // lista ordenada
    const itens = [...grupos.entries()].map(([k, l]) => ({ k, v: l.length, meso: mp.modo === "regiao" ? "" : (geo.mun.find((m) => m.nome === k) || {}).mesorregiao }))
      .sort((a, b) => b.v - a.v);
    const total = obras.length - fora;
    const mostrar = mp.modo === "regiao" || mp.todos ? itens : itens.slice(0, 15);
    const lista = mostrar.map((x) => `<button type="button" class="ranking-item" data-mapa-grupo="${esc(x.k)}">
        <span class="rk-nome">${esc(x.k)}${x.meso ? `<small>${esc(x.meso)}</small>` : ""}</span>
        <span class="rk-barra"><i style="width:${((x.v / max) * 100).toFixed(1)}%"></i></span>
        <span class="rk-num">${nf.format(x.v)}${mp.modo === "regiao" ? `<small>${Math.round((x.v / Math.max(1, total)) * 100)}%</small>` : ""}</span></button>`).join("");
    corpo.innerHTML = `
      <section class="painel">
        <div class="linha">
          <div class="campo"><span class="rotulo">Ver por</span><div class="modos" role="group" aria-label="Ver por">
            <button type="button" data-mapa-modo="municipio" aria-pressed="${mp.modo === "municipio"}">Município</button>
            <button type="button" data-mapa-modo="regiao" aria-pressed="${mp.modo === "regiao"}">Região</button></div></div>
          <div class="campo"><label for="mp-dest">Tipo de obra</label><select id="mp-dest"><option value="">Todos</option>${Object.entries(porDest).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<option value="${esc(k)}" ${mp.dest === k ? "selected" : ""}>${esc(k)} (${v})</option>`).join("")}</select></div>
          <div class="campo"><label for="mp-area">Área mínima</label><select id="mp-area">${AREAS.map(([v, rot]) => `<option value="${v}" ${mp.area === v ? "selected" : ""}>${rot}</option>`).join("")}</select></div>
        </div>
      </section>
      <section class="cartao-viz">
        <div class="cab-viz"><h2>Obras no radar ${mp.modo === "regiao" ? "por região" : "por município"}</h2>
          <p>${nf.format(total)} obras ativas iniciadas desde 2023. ${mp.modo === "regiao" ? "Regiões = mesorregiões do IBGE." : "Contornos mais escuros = mesorregiões do IBGE."} Toque ${mp.modo === "regiao" ? "numa região" : "numa bolha"} ou na lista para ver as obras.</p></div>
        <div class="mapa-layout">
          <div class="mapa-caixa">${svg}${legenda}</div>
          <div class="ranking"><h3>${mp.modo === "regiao" ? "Regiões" : "Municípios com mais obras"}</h3>${lista || '<p class="fraco">Nenhuma obra com esses filtros.</p>'}
            ${mp.modo === "municipio" && itens.length > 15 ? `<button type="button" class="btn mais" data-mapa-todos>${mp.todos ? "Mostrar só os 15 primeiros" : `Mostrar os ${itens.length} municípios`}</button>` : ""}</div>
        </div>
        <p class="rodape-viz">Malhas: IBGE.${fora ? ` ${nf.format(fora)} obra(s) com município não localizado no mapa.` : ""}</p>
      </section>`;
  }

  // ---------- mercado
  async function rpcTudo(nome, args) {
    const out = [];
    for (let i = 0; ; i += PAGINA) {
      const { data, error } = await E.sb.rpc(nome, args).range(i, i + PAGINA - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGINA) break;
    }
    return out;
  }
  async function dadosMercado() {
    const kT = I.m.cidade || "*", kC = I.m.grupo || "*";
    if (!I.cacheTipo.has(kT)) I.cacheTipo.set(kT, await rpcTudo("mercado_por_tipo", { p_desde: MERC_DESDE, p_municipio: I.m.cidade || null }));
    if (!I.cacheCid.has(kC)) {
      const tipos = I.m.grupo ? GRUPOS.find((g) => g.id === I.m.grupo).de : [null];
      const partes = await Promise.all(tipos.map((t) => rpcTudo("mercado_por_cidade", { p_desde: MERC_DESDE, p_tipo: t })));
      I.cacheCid.set(kC, partes.flat());
    }
    return { tipo: I.cacheTipo.get(kT), cid: I.cacheCid.get(kC) };
  }
  // períodos: chave e rótulo para mês, trimestre ou ano
  function periodoDe(dataIso, gran) {
    const a = Number(dataIso.slice(0, 4)), m = Number(dataIso.slice(5, 7)) - 1;
    if (gran === "ano") return { k: String(a), ini: new Date(a, 0, 1), fim: new Date(a + 1, 0, 1), rot: String(a) };
    if (gran === "mes") return { k: dataIso.slice(0, 7), ini: new Date(a, m, 1), fim: new Date(a, m + 1, 1), rot: `${MES_CURTO[m]}/${String(a).slice(2)}` };
    const t = Math.floor(m / 3);
    return { k: `${a}-T${t + 1}`, ini: new Date(a, t * 3, 1), fim: new Date(a, t * 3 + 3, 1), rot: `${t + 1}º tri ${a}` };
  }
  function listaPeriodos(gran) {
    const out = [];
    let d = new Date(2020, 0, 1);
    while (d <= HOJE) {
      const p = periodoDe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, gran);
      out.push(p);
      d = p.fim;
    }
    return out;
  }
  // a obra é cadastrada no CNO, em média, 1 a 2 meses depois de começar: períodos recentes vêm incompletos
  const CORTE_PARCIAL = new Date(HOJE.getFullYear(), HOJE.getMonth() - 3, 1);

  async function renderMercado() {
    const m = I.m;
    const corpo = $("insights-corpo");
    if (!corpo.querySelector("#viz-mercado")) corpo.innerHTML = `<p class="vazio">Carregando os dados do mercado…</p>`;
    else corpo.classList.add("recarregando");
    let dados;
    try { dados = await dadosMercado(); }
    catch (e) { console.error(e); corpo.innerHTML = `<p class="vazio">Não foi possível carregar o mercado (${esc(e.message || e)}). Recarregue a página.</p>`; return; }
    corpo.classList.remove("recarregando");
    const val = (r) => (m.metrica === "m2" ? Number(r.m2) || 0 : r.obras);
    const ok = (r) => (m.infra || !r.infra);
    // ---- série por tipo
    const periodos = listaPeriodos(m.gran);
    const idx = new Map(periodos.map((p, i) => [p.k, i]));
    const serie = GRUPOS.map(() => periodos.map(() => 0));
    dados.tipo.filter(ok).forEach((r) => {
      const g = grupoDe(r.tipo);
      if (m.grupo && g !== m.grupo) return;
      const i = idx.get(periodoDe(r.mes, m.gran).k);
      if (i != null) serie[GRUPOS.findIndex((x) => x.id === g)][i] += val(r);
    });
    // ---- janelas de 12 meses completos (sem o atraso de cadastro)
    const fimAtual = CORTE_PARCIAL, iniAtual = new Date(fimAtual.getFullYear() - 1, fimAtual.getMonth(), 1), iniAnt = new Date(fimAtual.getFullYear() - 2, fimAtual.getMonth(), 1);
    const janela = (dIso) => { const d = new Date(dIso + "T00:00:00"); return d >= iniAtual && d < fimAtual ? "atual" : d >= iniAnt && d < iniAtual ? "ant" : null; };
    const porGrupo = GRUPOS.map(() => ({ atual: 0, ant: 0 }));
    dados.tipo.filter(ok).forEach((r) => { const w = janela(r.mes); if (!w) return; porGrupo[GRUPOS.findIndex((x) => x.id === grupoDe(r.tipo))][w] += val(r); });
    const rotJan = (a, b) => `${MES_CURTO[a.getMonth()]}/${a.getFullYear()}–${MES_CURTO[new Date(b - DIA).getMonth()]}/${new Date(b - DIA).getFullYear()}`;
    // ---- cidades
    const cidades = new Map();
    const trimestres = listaPeriodos("trimestre").filter((p) => p.fim <= CORTE_PARCIAL);
    const tIdx = new Map(trimestres.map((p, i) => [p.k, i]));
    dados.cid.filter(ok).forEach((r) => {
      let c = cidades.get(r.municipio);
      if (!c) { c = { nome: r.municipio, atual: 0, ant: 0, total: 0, tri: trimestres.map(() => 0) }; cidades.set(r.municipio, c); }
      const v = val(r);
      c.total += v;
      const ti = tIdx.get(periodoDe(r.trimestre, "trimestre").k);
      if (ti != null) c.tri[ti] += v;
      // trimestre inteiro dentro da janela?
      const ini = new Date(r.trimestre + "T00:00:00");
      if (ini >= iniAtual && ini < fimAtual) c.atual += v; else if (ini >= iniAnt && ini < iniAtual) c.ant += v;
    });
    let lista = [...cidades.values()].filter((c) => c.atual + c.ant > 0);
    const minAnt = m.metrica === "m2" ? 5000 : 10;
    if (m.ordemCid === "crescimento") lista = lista.filter((c) => c.ant >= minAnt).sort((a, b) => (b.atual / b.ant) - (a.atual / a.ant));
    else lista.sort((a, b) => b.atual - a.atual);
    const todasCid = [...cidades.values()].sort((a, b) => b.total - a.total);
    const mostrar = m.todasCid ? lista : lista.slice(0, 15);
    const variacao = (a, b) => {
      if (!b) return a ? `<span class="var sobe">novo</span>` : `<span class="fraco">–</span>`;
      const p = Math.round(((a - b) / b) * 100);
      return p === 0 ? `<span class="var">0%</span>` : `<span class="var ${p > 0 ? "sobe" : "desce"}">${p > 0 ? "▲ +" : "▼ "}${nf.format(p)}%</span>`;
    };
    const fmtV = (v) => (m.metrica === "m2" ? compacto(v) + " m²" : nf.format(v));
    const soma = (campo) => porGrupo.reduce((acc, x, i) => acc + (!m.grupo || GRUPOS[i].id === m.grupo ? x[campo] : 0), 0);
    const unidade = m.metrica === "m2" ? "m²" : "obras";
    corpo.innerHTML = `
      <section class="painel">
        <div class="linha">
          <div class="campo"><span class="rotulo">Período</span><div class="modos" role="group" aria-label="Período">
            ${[["mes", "Mês"], ["trimestre", "Trimestre"], ["ano", "Ano"]].map(([k, r]) => `<button type="button" data-m="gran:${k}" aria-pressed="${m.gran === k}">${r}</button>`).join("")}</div></div>
          <div class="campo"><span class="rotulo">Contar</span><div class="modos" role="group" aria-label="Contar por">
            <button type="button" data-m="metrica:obras" aria-pressed="${m.metrica === "obras"}">Obras</button><button type="button" data-m="metrica:m2" aria-pressed="${m.metrica === "m2"}">m²</button></div></div>
          <div class="campo"><label for="m-cidade">Município</label><select id="m-cidade"><option value="">Todo o Pará</option>${todasCid.map((c) => `<option value="${esc(c.nome)}" ${m.cidade === c.nome ? "selected" : ""}>${esc(titulo(c.nome))}</option>`).join("")}</select></div>
          <div class="campo"><label for="m-grupo">Tipo de obra</label><select id="m-grupo"><option value="">Todos</option>${GRUPOS.map((g) => `<option value="${g.id}" ${m.grupo === g.id ? "selected" : ""}>${g.nome}</option>`).join("")}</select></div>
          <label class="toggle" for="m-infra"><input id="m-infra" type="checkbox" ${m.infra ? "checked" : ""}> Incluir infraestrutura</label>
        </div>
      </section>
      <section class="cartao-viz" id="viz-mercado">
        <div class="cab-viz"><h2>Obras que começaram ${m.cidade ? "em " + esc(titulo(m.cidade)) : "no Pará"}, por tipo</h2>
          <p>Todas as obras, de qualquer tamanho e situação, desde 2020, pela data de início. Sem regularizações de obras antigas.</p></div>
        <div class="legenda-viz">${GRUPOS.filter((g) => !m.grupo || g.id === m.grupo).map((g) => `<span><i style="background:${g.cor}"></i>${esc(g.nome)}</span>`).join("")}
          <span class="fraco"><i class="parcial-chave"></i>período incompleto</span></div>
        <div class="grafico" id="grafico"></div>
        <p class="nota">Os períodos mais recentes aparecem mais claros porque estão incompletos: a obra costuma ser cadastrada na Receita 1 a 2 meses depois de começar.</p>
      </section>
      <section class="cartao-viz">
        <div class="cab-viz"><h2>Por tipo: últimos 12 meses completos</h2><p>${rotJan(iniAtual, fimAtual)} comparado com ${rotJan(iniAnt, iniAtual)}.</p></div>
        <div class="tabela"><table class="t-viz"><thead><tr><th>Tipo</th><th class="n">Últimos 12 meses</th><th class="n">12 meses anteriores</th><th class="n">Variação</th></tr></thead>
          <tbody>${GRUPOS.map((g, i) => (m.grupo && g.id !== m.grupo ? "" : `<tr><td><span class="dot" style="background:${g.cor}"></span>${esc(g.nome)}</td><td class="n">${fmtV(porGrupo[i].atual)}</td><td class="n">${fmtV(porGrupo[i].ant)}</td><td class="n">${variacao(porGrupo[i].atual, porGrupo[i].ant)}</td></tr>`)).join("")}
          <tr class="total"><td>Total</td><td class="n">${fmtV(soma("atual"))}</td><td class="n">${fmtV(soma("ant"))}</td><td class="n">${variacao(soma("atual"), soma("ant"))}</td></tr></tbody></table></div>
      </section>
      <section class="cartao-viz">
        <div class="cab-viz"><h2>Cidades${m.grupo ? " · " + esc(GRUPOS.find((g) => g.id === m.grupo).nome) : ""}</h2>
          <p>${unidade === "m²" ? "m² de obras iniciadas" : "Obras iniciadas"} nos últimos 12 meses completos, contra os 12 anteriores. Toque numa cidade para ver o gráfico dela.</p>
          <div class="modos" role="group" aria-label="Ordenar cidades"><button type="button" data-m="ordemCid:volume" aria-pressed="${m.ordemCid === "volume"}">Mais obras</button><button type="button" data-m="ordemCid:crescimento" aria-pressed="${m.ordemCid === "crescimento"}">Mais crescimento</button></div></div>
        <div class="tabela"><table class="t-viz"><thead><tr><th>Cidade</th><th class="n">Últimos 12 meses</th><th class="n">Anteriores</th><th class="n">Variação</th><th>Desde 2020 (por trimestre)</th></tr></thead>
          <tbody>${mostrar.map((c) => `<tr class="${m.cidade === c.nome ? "sel" : ""}"><td><button type="button" class="link-cidade" data-cidade="${esc(c.nome)}">${esc(titulo(c.nome))}</button></td><td class="n">${fmtV(c.atual)}</td><td class="n">${fmtV(c.ant)}</td><td class="n">${variacao(c.atual, c.ant)}</td><td>${sparkline(c.tri)}</td></tr>`).join("") || `<tr><td colspan="5" class="fraco">Nenhuma cidade com volume suficiente para comparar.</td></tr>`}</tbody></table></div>
        ${lista.length > 15 ? `<button type="button" class="btn mais" data-todas-cidades>${m.todasCid ? "Mostrar só as 15 primeiras" : `Mostrar todas as ${nf.format(lista.length)} cidades`}</button>` : ""}
        ${m.ordemCid === "crescimento" ? `<p class="nota">Só cidades com pelo menos ${fmtV(minAnt)} nos 12 meses anteriores, para não exagerar o crescimento de quem partiu de quase zero.</p>` : ""}
      </section>`;
    desenharColunas($("grafico"), periodos, serie, m);
  }
  function sparkline(vals) {
    const w = 120, h = 28, max = Math.max(1, ...vals);
    const pts = vals.map((v, i) => [vals.length > 1 ? (i / (vals.length - 1)) * (w - 6) + 3 : w / 2, h - 3 - (v / max) * (h - 6)]);
    const ult = pts[pts.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>${ult ? `<circle cx="${ult[0].toFixed(1)}" cy="${ult[1].toFixed(1)}" r="3" fill="var(--dado)"/>` : ""}</svg>`;
  }
  // colunas empilhadas por tipo, com dica ao tocar/passar o dedo
  function desenharColunas(alvo, periodos, serie, m) {
    const largura = Math.max(320, alvo.clientWidth || 600), altura = 260, mt = 16, mb = 34, ml = 52, mr = 8;
    const ativos = GRUPOS.map((g, i) => i).filter((i) => !m.grupo || GRUPOS[i].id === m.grupo);
    const totais = periodos.map((_, p) => ativos.reduce((s, i) => s + serie[i][p], 0));
    const bruto = Math.max(1, ...totais);
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passoY = [1, 2, 2.5, 5, 10].map((x) => x * mag / 4).find((x) => bruto / x <= 5) || mag;
    const maxY = Math.ceil(bruto / passoY) * passoY;
    const ph = altura - mt - mb, pw = largura - ml - mr;
    const banda = pw / periodos.length, bw = Math.max(2, Math.min(24, banda * 0.7));
    const y = (v) => mt + ph - (v / maxY) * ph;
    let svg = `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Obras iniciadas por período e tipo, desde 2020">`;
    for (let v = 0; v <= maxY + 1e-9; v += passoY) {
      svg += `<line x1="${ml}" x2="${largura - mr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
      svg += `<text x="${ml - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="eixo">${m.metrica === "m2" ? compacto(v) : nf.format(v)}</text>`;
    }
    periodos.forEach((p, pi) => {
      const x = ml + pi * banda + (banda - bw) / 2;
      const parcial = p.fim > CORTE_PARCIAL;
      let base = 0;
      const segs = ativos.filter((i) => serie[i][pi] > 0);
      segs.forEach((i, si) => {
        const v = serie[i][pi], y0 = y(base), y1 = y(base + v);
        const topo = si === segs.length - 1;
        const hgt = Math.max(0, y0 - y1 - (topo ? 0 : 2));
        const r = topo ? Math.min(4, bw / 2, hgt) : 0;
        const yt = y0 - hgt;
        svg += r > 0
          ? `<path d="M${x.toFixed(1)},${y0.toFixed(1)} V${(yt + r).toFixed(1)} Q${x.toFixed(1)},${yt.toFixed(1)} ${(x + r).toFixed(1)},${yt.toFixed(1)} H${(x + bw - r).toFixed(1)} Q${(x + bw).toFixed(1)},${yt.toFixed(1)} ${(x + bw).toFixed(1)},${(yt + r).toFixed(1)} V${y0.toFixed(1)} Z" fill="${GRUPOS[i].cor}" ${parcial ? 'opacity="0.38"' : ""}/>`
          : `<rect x="${x.toFixed(1)}" y="${yt.toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${GRUPOS[i].cor}" ${parcial ? 'opacity="0.38"' : ""}/>`;
        base += v;
      });
      // rótulos do eixo: o ano no começo de cada ano
      const mostraAno = m.gran === "ano" || p.ini.getMonth() === 0;
      if (mostraAno) svg += `<text x="${(ml + pi * banda + (m.gran === "ano" ? banda / 2 : 0)).toFixed(1)}" y="${altura - 12}" text-anchor="${m.gran === "ano" ? "middle" : "start"}" class="eixo">${p.ini.getFullYear()}</text>`;
      svg += `<rect class="alvo" x="${(ml + pi * banda).toFixed(1)}" y="${mt}" width="${banda.toFixed(1)}" height="${ph}" fill="transparent" tabindex="0" data-p="${pi}"/>`;
    });
    svg += `<line x1="${ml}" x2="${largura - mr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--muted)" stroke-width="1"/></svg>`;
    alvo.innerHTML = svg + `<div class="dica" hidden></div>`;
    const dica = alvo.querySelector(".dica");
    const mostrar = (el) => {
      const pi = Number(el.dataset.p), p = periodos[pi];
      dica.textContent = "";
      const t = document.createElement("div"); t.className = "dica-tit"; t.textContent = `${p.rot}${p.fim > CORTE_PARCIAL ? " (incompleto)" : ""}`; dica.appendChild(t);
      const tot = document.createElement("div"); tot.className = "dica-tot"; tot.textContent = `${m.metrica === "m2" ? compacto(totais[pi]) + " m²" : nf.format(totais[pi]) + " obras"}`; dica.appendChild(tot);
      [...ativos].reverse().forEach((i) => {
        if (!serie[i][pi]) return;
        const l = document.createElement("div"); l.className = "dica-linha";
        const k = document.createElement("i"); k.style.background = GRUPOS[i].cor; l.appendChild(k);
        const b = document.createElement("b"); b.textContent = m.metrica === "m2" ? compacto(serie[i][pi]) : nf.format(serie[i][pi]); l.appendChild(b);
        l.appendChild(document.createTextNode(" " + GRUPOS[i].nome)); dica.appendChild(l);
      });
      dica.hidden = false;
      const caixa = alvo.getBoundingClientRect(), r = el.getBoundingClientRect();
      const left = Math.min(Math.max(0, r.left - caixa.left + r.width / 2 - 90), caixa.width - 190);
      dica.style.left = left + "px"; dica.style.top = "4px";
      alvo.querySelectorAll(".alvo.ativo").forEach((a) => a.classList.remove("ativo")); el.classList.add("ativo");
    };
    alvo.querySelectorAll(".alvo").forEach((el) => {
      el.addEventListener("pointerenter", () => mostrar(el));
      el.addEventListener("focus", () => mostrar(el));
      el.addEventListener("click", () => mostrar(el));
    });
    alvo.addEventListener("pointerleave", () => { dica.hidden = true; });
  }
  let tResize;
  window.addEventListener("resize", () => { clearTimeout(tResize); tResize = setTimeout(() => { if (E.vista === "insights" && I.aba === "mercado" && $("grafico")) renderMercado(); }, 250); });

  // ------------------------------------------------------------ equipe (admin)
  function painelEquipe() {
    E.eqGrupos = new Map();
    const pessoas = E.perfis.filter((p) => p.ativo).map((p) => ({ p,
      cards: E.enc.filter((e) => e.vendedor_id === p.id && E.obras.has(e.cno)).map((e) => ({ o: E.obras.get(e.cno), s: situacao(e.cno, p.id) })) }))
      .filter((x) => x.cards.length || x.p.papel === "vendedor")
      .sort((a, b) => b.cards.length - a.cards.length || (a.p.nome || "").localeCompare(b.p.nome || ""));
    const grupos = [...STATUS.map(([k, r]) => [k, r, (c) => c.s.st === k]),
      ["parada", `Paradas (${PARADA_DIAS}+ dias)`, (c) => c.s.parada], ["vencida", "Ações vencidas", (c) => c.s.vencida], ["total", "Total", () => true]];
    const cel = (x, k, rot, teste) => {
      const lista = x.cards.filter(teste);
      if (!lista.length) return `<td class="n zero">–</td>`;
      const nome = x.p.nome || x.p.email;
      E.eqGrupos.set(x.p.id + "|" + k, { titulo: `${nome}: ${rot.toLowerCase()}`, sub: `${nf.format(lista.length)} obra${lista.length === 1 ? "" : "s"} · toque para abrir`, obras: lista.map((c) => c.o) });
      const alerta = (k === "parada" || k === "vencida") ? " alerta-eq" : "";
      return `<td class="n"><button type="button" class="num-eq${alerta}" data-eq="${esc(x.p.id + "|" + k)}">${nf.format(lista.length)}</button></td>`;
    };
    if (!pessoas.length) return `<section class="cartao-viz"><div class="cab-viz"><h2>Andamento da equipe</h2><p>Nenhuma obra encaminhada ainda.</p></div></section>`;
    return `<section class="cartao-viz">
      <div class="cab-viz"><h2>Andamento da equipe</h2>
        <p>Obras encaminhadas a cada representante, por etapa. Toque num número para ver as obras, ou no nome para abrir o quadro dela.
        “Parada” = sem movimentação há ${PARADA_DIAS} dias ou mais (fora as fechadas e perdidas).</p></div>
      <div class="tabela-viz"><table class="t-eq">
        <thead><tr><th>Representante</th>${grupos.map(([k, r]) => `<th class="n">${k.length > 0 && STATUS_NOME[k] ? `<span class="status" data-s="${k}">${esc(r)}</span>` : esc(r)}</th>`).join("")}</tr></thead>
        <tbody>${pessoas.map((x) => `<tr><th scope="row"><button type="button" class="link-cidade" data-eq-quadro="${esc(x.p.id)}">${esc(x.p.nome || x.p.email)}</button></th>${grupos.map(([k, r, t]) => cel(x, k, r, t)).join("")}</tr>`).join("")}</tbody>
      </table></div></section>`;
  }
  function renderEquipe() {
    const linhas = E.perfis.map((p) => {
      const obras = new Set(E.enc.filter((e) => e.vendedor_id === p.id).map((e) => e.cno));
      const cont = {}; obras.forEach((c) => { const s = (acompDe(c, p.id) || {}).status || "nova"; cont[s] = (cont[s] || 0) + 1; });
      const resumo = STATUS.filter(([k]) => cont[k]).map(([k, r]) => `<span class="status" data-s="${k}">${r} ${cont[k]}</span>`).join(" ");
      const euMesmo = p.id === E.eu.id;
      return `<tr>
        <td><b>${esc(p.nome || "—")}</b><br><span style="color:var(--muted);font-size:14px">${esc(p.email || "")}</span></td>
        <td><select data-papel="${esc(p.id)}" ${euMesmo ? "disabled" : ""} aria-label="Papel de ${esc(p.nome || p.email)}">
          <option value="vendedor" ${p.papel === "vendedor" ? "selected" : ""}>Vendedor</option>
          <option value="admin" ${p.papel === "admin" ? "selected" : ""}>Admin</option></select></td>
        <td><label class="toggle"><input type="checkbox" data-ativo="${esc(p.id)}" ${p.ativo ? "checked" : ""} ${euMesmo ? "disabled" : ""}> ativo</label></td>
        <td class="n">${obras.size}</td>
        <td>${resumo || '<span style="color:var(--muted)">—</span>'}</td>
      </tr>`;
    }).join("");
    $("conteudo").innerHTML = `
      ${painelEquipe()}
      <h2 class="titulo-sec">Pessoas e acessos</h2>
      <div class="tabela"><table>
        <thead><tr><th>Pessoa</th><th>Papel</th><th>Acesso</th><th class="n">Obras</th><th>Andamento</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
      <div class="explica">
        <b>Como adicionar um vendedor</b>
        <ol>
          <li>No Supabase, abra o projeto <b>radar-obras</b> → <b>Authentication</b> → <b>Users</b> → <b>Add user</b> → <b>Create new user</b>.</li>
          <li>Coloque o e-mail do vendedor e uma senha provisória, marque <b>Auto Confirm User</b> e crie.</li>
          <li>Recarregue esta página: a pessoa aparece aqui como vendedor. Envie a ela o endereço do site, o e-mail e a senha provisória.</li>
          <li>No primeiro acesso, ela troca a senha em <b>Trocar senha</b>, no topo da tela.</li>
        </ol>
        <p>Desmarcar <b>ativo</b> bloqueia o acesso sem apagar o histórico.</p>
      </div>`;
  }
  async function alterarPerfil(id, mudanca) {
    const { error } = await E.sb.from("perfis").update(mudanca).eq("id", id);
    if (error) { falha(error, "Não foi possível alterar"); return renderEquipe(); }
    Object.assign(E.perfis.find((p) => p.id === id), mudanca);
    toast("Equipe atualizada");
  }

  // ------------------------------------------------------------ eventos da área principal
  const conteudo = $("conteudo");
  let tBusca;
  conteudo.addEventListener("input", (ev) => {
    if (ev.target.id === "f-busca") { E.filtros[E.vista].busca = ev.target.value; clearTimeout(tBusca); tBusca = setTimeout(E.vista === "construtoras" ? aplicarConstrutoras : aplicar, 180); }
  });
  conteudo.addEventListener("change", (ev) => {
    const t = ev.target, f = E.filtros[E.vista];
    const mapa = { "f-mun": "mun", "f-dest": "dest", "f-enc": "enc", "f-ordem": "ordem", "f-papel": "papel", "f-area": "area" };
    if (E.vista === "insights") return mudouInsights(t);
    if (t.id === "f-salvas") { f.salvas = t.checked; return E.vista === "construtoras" ? aplicarConstrutoras() : aplicar(); }
    if (mapa[t.id] && E.vista === "construtoras") { f[mapa[t.id]] = t.value; return aplicarConstrutoras(); }
    if (mapa[t.id]) { f[mapa[t.id]] = t.value; return aplicar(); }
    if (t.dataset.encaminhar && t.value) return encaminhar(t.dataset.encaminhar, t.value);
    if (t.dataset.statusObra) return salvarAcomp(t.dataset.statusObra, { status: t.value });
    if (t.dataset.proxima !== undefined && t.matches("[data-proxima]")) return salvarAcomp(t.dataset.proxima, { proxima_acao: t.value || null });
    if (t.dataset.papel) return alterarPerfil(t.dataset.papel, { papel: t.value });
    if (t.dataset.ativo) return alterarPerfil(t.dataset.ativo, { ativo: t.checked });
  });
  conteudo.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest("[data-tirar-especial]")) { E.filtros[E.vista].especial = ""; return aplicar(); }
    if (E.vista === "insights" && cliqueInsights(t)) return;
    const chipJ = t.closest("[data-filtro-janela]"); if (chipJ) { E.filtros[E.vista].janela = chipJ.dataset.filtroJanela; return aplicar(); }
    const chipS = t.closest("[data-filtro-status]"); if (chipS) { E.filtros[E.vista].status = chipS.dataset.filtroStatus; return aplicar(); }
    const det = t.closest("[data-detalhe]"); if (det) return abrirDetalhe(det.dataset.detalhe);
    const est = t.closest("[data-estrela]"); if (est) return alternarSalva(est.dataset.estrela);
    if (t.closest("[data-tirar-sojanela]")) { E.filtros.construtoras.soJanela = false; return aplicarConstrutoras(); }
    const chipC = t.closest("[data-filtro-salvas]"); if (chipC) { E.filtros.construtoras.salvas = chipC.dataset.filtroSalvas === "1"; return aplicarConstrutoras(); }
    const emp = t.closest(".linha-emp"); if (emp && !t.closest("select, button, a, input, label")) return abrirEmpresa(emp.dataset.basico);
    const rem = t.closest("[data-remover]"); if (rem) return remover(rem.dataset.remover, rem.dataset.vendedor);
    const cop = t.closest("[data-copiar]"); if (cop) return copiar(cop);
    if (t.id === "mais") return E.vista === "construtoras" ? desenharMaisEmpresas() : desenharMais();
    const modo = t.closest("[data-modo]");
    if (modo) { E.modo = modo.dataset.modo; gravarModo(E.modo); return renderVista(); }
    const ord = t.closest("[data-ordenar]");
    if (ord) { E.filtros[E.vista].ordem = ord.dataset.ordenar; const s = $("f-ordem"); if (s) s.value = ord.dataset.ordenar; return E.vista === "construtoras" ? aplicarConstrutoras() : aplicar(); }
    const lin = t.closest(".linha-obra");
    if (lin && !t.closest("select, button, a, input, label")) return abrirDetalhe(lin.dataset.cno);
    const card = t.closest(".card-q"); if (card) return abrirDetalhe(card.dataset.cno);
    const eq = t.closest("[data-eq]"); if (eq && E.eqGrupos) { const g = E.eqGrupos.get(eq.dataset.eq); if (g) return abrirListaObras(g.titulo, g.sub, g.obras); }
    const eqq = t.closest("[data-eq-quadro]");
    if (eqq) {
      const f = (E.filtros.todas = E.filtros.todas || filtrosPadrao("todas"));
      f.enc = eqq.dataset.eqQuadro; E.modo = "quadro"; gravarModo(E.modo);
      location.hash = "#todas"; return;
    }
  });
  conteudo.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && (ev.target.classList.contains("linha-obra") || ev.target.classList.contains("card-q"))) { ev.preventDefault(); abrirDetalhe(ev.target.dataset.cno); }
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("linha-emp")) { ev.preventDefault(); abrirEmpresa(ev.target.dataset.basico); }
  });
  // encaminhar e tirar também pelo painel de detalhes
  $("detalhe").addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset.encaminhar && t.value) { await encaminhar(t.dataset.encaminhar, t.value); reabrir(); }
  });
  $("detalhe").addEventListener("click", async (ev) => {
    const r = ev.target.closest("[data-remover]");
    if (r) { await remover(r.dataset.remover, r.dataset.vendedor); return reabrir(); }
    const ab = ev.target.closest("[data-abrir-empresa]"); if (ab) return abrirEmpresa(ab.dataset.abrirEmpresa);
    const ao = ev.target.closest("[data-abrir-obra]"); if (ao && !ev.target.closest("select, input")) return abrirDetalhe(ao.dataset.abrirObra, ao.dataset.voltarLista ? "lista" : $("detalhe").dataset.basico || null);
    if (ev.target.closest("[data-voltar-lista]") && I.ultimaLista) { const l = I.ultimaLista; return abrirListaObras(l.titulo, l.sub, l.obras, l.dataDe); }
    const es = ev.target.closest("[data-estrela]"); if (es) return alternarSalva(es.dataset.estrela);
  });
  // andamento também pode ser alterado dentro do painel de detalhes
  $("detalhe").addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.statusObra) salvarAcomp(t.dataset.statusObra, { status: t.value }).then(reabrir);
    else if (t.matches("[data-proxima]")) salvarAcomp(t.dataset.proxima, { proxima_acao: t.value || null });
  });
  $("detalhe").addEventListener("close", () => {
    document.body.classList.remove("com-painel");
    const cno = $("detalhe").dataset.cno;
    if (cno) atualizarFicha(cno);
    const bas = $("detalhe").dataset.basico;
    if (bas) atualizarLinhaEmpresa(bas);
    marcarSelecionada(null);
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && $("detalhe").open && !$("detalhe").matches(":modal")) $("detalhe").close(); });
  // ao virar o tablet com o painel aberto, troca entre lado a lado e sobreposto
  TELA_LARGA.addEventListener("change", () => { const d = $("detalhe"); if (d.open) { const c = d.dataset.cno, b = d.dataset.basico, v = d.dataset.voltar; d.close(); if (c) abrirDetalhe(c, v || null); else if (b) abrirEmpresa(b); } });
  window.addEventListener("resize", medirTopo);
  $("detalhe").addEventListener("click", (ev) => { const c = ev.target.closest("[data-copiar]"); if (c) copiar(c); });

  iniciar().catch((e) => { console.error(e); msg("Erro ao iniciar: " + (e.message || e)); });
})();
