"use strict";
/* radar de obras — app (admin e vendedores)
   Dados no Supabase; as regras de quem vê o quê estão no banco (Row Level Security).
   Telas: #todas (admin), #minhas (todos), #equipe (admin). */
(function () {
  // ------------------------------------------------------------ regras (espelho de pipeline/regras.py)
  const JANELAS = [
    { nome: "Apresentação / especificação", curto: "Apresentação", ini: 0, fim: 30, cor: "var(--marca-texto)" },
    { nome: "Cabos elétricos", curto: "Cabos", ini: 30, fim: 65, cor: "var(--cabos)" },
    { nome: "Pisos e revestimentos", curto: "Pisos e revestimentos", ini: 50, fim: 85, cor: "var(--pisos)" },
    { nome: "ASSA ABLOY", curto: "ASSA ABLOY", ini: 70, fim: 100, cor: "var(--assa)" },
  ];
  const FASES = [[15, "Início / fundação"], [45, "Estrutura"], [70, "Alvenaria e instalações"], [95, "Acabamento"],
    [115, "Finalização"], [Infinity, "Provavelmente concluída"]];
  const RECORTE = { situacao: "02", inicioMin: "2023-01-01", areaMin: 800 }; // o que o admin vê em "Todas as obras"
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
  const JANELA_CURTA = { "Apresentação / especificação": "Apresentação", "Cabos elétricos": "Cabos", "Pisos e revestimentos": "Pisos", "ASSA ABLOY": "ASSA" };
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
  };
  const ehAdmin = () => E.eu && E.eu.papel === "admin";
  const nomeDe = (id) => { const p = E.perfis.find((x) => x.id === id); return p ? p.nome || p.email : "—"; };
  const encDe = (cno) => E.enc.filter((e) => e.cno === cno);
  const minha = (cno) => E.enc.some((e) => e.cno === cno && e.vendedor_id === E.eu.id);
  const acompDe = (cno, vid) => E.acomp.get(cno + "|" + vid);

  // ------------------------------------------------------------ telas
  function mostrar(qual) {
    $("tela-entrada").hidden = qual !== "entrada";
    $("tela-msg").hidden = qual !== "msg";
    $("tela-app").hidden = qual !== "app";
  }
  function msg(texto, acao) {
    $("msg-texto").innerHTML = esc(texto) + (acao ? `<br><br><button class="btn" type="button" id="msg-acao">${esc(acao.rotulo)}</button>` : "");
    if (acao) $("msg-acao").onclick = acao.fn;
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
    o.tNome = titulo(o.nome); o.tResp = titulo(o.responsavel); o.tBairro = titulo(o.bairro);
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
      obras = await paginar(() => sb.from("obras").select(COLS).eq("situacao", RECORTE.situacao)
        .gte("data_inicio", RECORTE.inicioMin).gte("area_principal", RECORTE.areaMin).is("motivo_infra", null).order("cno"));
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
    // "nova" = entrou na base depois da primeira carga, nos últimos 14 dias
    const datas = obras.map((o) => o.primeira_vez_em).filter(Boolean).sort();
    const base = datas.length ? new Date(datas[0]).getTime() + 86400000 : Infinity;
    const limite = Date.now() - 14 * 86400000;
    obras.forEach((o) => { const t = new Date(o.primeira_vez_em).getTime(); o.nova = t > base && t > limite; });
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
    if (!["todas", "minhas", "equipe"].includes(v) || (!ehAdmin() && v !== "minhas")) v = ehAdmin() ? "todas" : "minhas";
    E.vista = v;
    renderAbas();
    renderVista();
  }
  window.addEventListener("hashchange", rota);
  function renderAbas() {
    const minhas = new Set(E.enc.filter((e) => e.vendedor_id === E.eu.id).map((e) => e.cno)).size;
    const abas = [];
    if (ehAdmin()) abas.push(["todas", "Todas as obras", [...E.obras.values()].filter((o) => o.recorte).length]);
    abas.push(["minhas", "Minhas obras", minhas]);
    if (ehAdmin()) abas.push(["equipe", "Equipe", E.perfis.length]);
    $("abas").innerHTML = abas.map(([id, rot, n]) =>
      `<a href="#${id}" ${E.vista === id ? 'aria-current="page"' : ""}>${esc(rot)} <span class="cont">${nf.format(n)}</span></a>`).join("");
  }

  // ------------------------------------------------------------ listas de obras
  function filtrosPadrao(v) {
    return { busca: "", mun: "", dest: "", janela: "", enc: "", status: "", ordem: v === "minhas" ? "proxima" : "prioridade" };
  }
  function baseDaVista() {
    const todas = [...E.obras.values()];
    if (E.vista === "todas") return todas;
    return todas.filter((o) => minha(o.cno));
  }
  function renderVista() {
    const c = $("conteudo");
    if (E.vista === "equipe") return renderEquipe();
    const f = (E.filtros[E.vista] = E.filtros[E.vista] || filtrosPadrao(E.vista));
    const base = baseDaVista();
    const porMun = {}, porDest = {};
    base.forEach((o) => { porMun[o.municipio] = (porMun[o.municipio] || 0) + 1; porDest[o.destinacao || "Não informado"] = (porDest[o.destinacao || "Não informado"] || 0) + 1; });
    const opt = (obj, sel, fmt) => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(fmt ? fmt(k) : k)} (${n})</option>`).join("");
    const vendedores = E.perfis.filter((p) => p.ativo);
    const filtroEnc = E.vista === "todas" ? `
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
          ${filtroEnc}
          <div class="campo"><label for="f-ordem">Ordenar por</label><select id="f-ordem">${ordens.map(([k, r]) => `<option value="${k}" ${f.ordem === k ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        </div>
        <div class="chips" id="chips" role="group" aria-label="${E.vista === "minhas" ? "Andamento" : "Momento da obra"}"></div>
      </section>
      <div class="resumo">
        <span><strong id="qtd">0</strong> <span id="qtd-rot">obras</span> <small class="hoje-rot">· fase calculada para hoje, ${HOJE.toLocaleDateString("pt-BR")}</small></span>
        <div class="modos" role="group" aria-label="Forma de ver as obras">
          <button type="button" data-modo="lista" aria-pressed="${E.modo === "lista"}">${ico("lista")}Lista</button>
          <button type="button" data-modo="fichas" aria-pressed="${E.modo === "fichas"}">${ico("fichas")}Fichas</button>
        </div>
      </div>
      <div class="${E.modo === "lista" ? "lista" : "grade"}" id="grade"></div>
      <button class="btn mais" id="mais" type="button" hidden>Mostrar mais</button>`;
    aplicar();
  }
  function baseFiltrada() {
    const f = E.filtros[E.vista];
    const q = sem(f.busca.trim());
    return baseDaVista().filter((o) => (!q || o.busca.includes(q)) && (!f.mun || o.municipio === f.mun) &&
      (!f.dest || (o.destinacao || "Não informado") === f.dest) &&
      (!f.enc || (f.enc === "sem" ? !encDe(o.cno).length : f.enc === "com" ? encDe(o.cno).length > 0 : encDe(o.cno).some((e) => e.vendedor_id === f.enc))));
  }
  // desenha os botões de filtro com as contagens atuais; devolve o teste do botão escolhido
  function renderChips(base) {
    const f = E.filtros[E.vista];
    let chips, passa;
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
    E.lista = base.filter(passa).sort(ORDENS[f.ordem] || ORDENS.prioridade);
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
    if (o.nova) alertas.push(`<span class="novo">Nova na base</span>`);
    if (o.susp) alertas.push(`<span class="alerta">área provavelmente digitada errada</span>`);
    if (!o.cnpj) alertas.push(`<span class="alerta">pessoa física</span>`);
    if (o.situacao && o.situacao !== "02") alertas.push(`<span class="alerta">situação no CNO: ${esc({ "01": "nula", "03": "suspensa", "14": "paralisada", "15": "encerrada" }[o.situacao] || o.situacao)}</span>`);
    return {
      cidade: `<div class="cidade">${ico("pin")}<div class="lugar"><span class="mun">${esc(o.municipio)}</span>${o.bairro ? `<span class="bairro">${esc(o.tBairro)}</span>` : ""}</div>
        <div class="area"><b>${o.area ? nf.format(Math.round(o.area)) : "–"}</b><small>m²</small></div></div>`,
      tipos: `<div class="tipos"><span class="tipo">${ico(ICONE[o.destinacao] || "predio")}${esc(o.destinacao || "Tipo não informado")}</span>${o.categoria ? `<span class="cat">${esc(o.categoria)}</span>` : ""}${alertas.join("")}</div>`,
      resp: `<div class="resp">${o.responsavel && o.responsavel !== o.nome ? `<span class="nome">${esc(o.tResp)}</span>` : ""}${o.cnpj ? `<span class="cnpj"><span class="mono">${esc(o.cnpjF)}</span><button type="button" class="copiar" data-copiar="${esc(o.cnpjF)}">Copiar CNPJ</button></span>` : ""}<span>${esc(QUALIF[o.qualificacao] || "")}</span></div>`,
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
    const el = document.querySelector(`#grade [data-cno="${CSS.escape(cno)}"]`);
    const o = E.obras.get(cno);
    if (el && o) el.outerHTML = el.classList.contains("linha-obra") ? linha(o) : ficha(o);
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
    const avisos = [o.nova ? `<span class="novo">Nova</span>` : "", !o.cnpj ? `<span class="alerta">pessoa física</span>` : "",
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
      <div class="c-cidade"><span class="mun">${esc(o.municipio)}</span><span class="bairro">${esc(o.tBairro)}</span></div>
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
    if (E.vista === "minhas" && $("chips")) renderChips(baseFiltrada());
    toast(mudanca.status ? "Andamento: " + STATUS_NOME[mudanca.status] : "Próxima ação salva");
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

  // ------------------------------------------------------------ painel de detalhes e anotações
  function controleEncaminhar(o) {
    const encs = encDe(o.cno), ja = new Set(encs.map((e) => e.vendedor_id));
    const tirar = encs.map((e) => `<button class="btn discreto" type="button" data-remover="${esc(o.cno)}" data-vendedor="${esc(e.vendedor_id)}">Tirar de ${esc(nomeDe(e.vendedor_id))}</button>`).join("");
    const opcoes = E.perfis.filter((p) => p.ativo && !ja.has(p.id));
    return `<div class="linha">${opcoes.length ? `<select data-encaminhar="${esc(o.cno)}" aria-label="Encaminhar obra"><option value="">Encaminhar para…</option>${opcoes.map((p) => `<option value="${esc(p.id)}">${esc(p.nome || p.email)}</option>`).join("")}</select>` : ""}${tirar}</div>`;
  }
  async function abrirDetalhe(cno) {
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
      ${h.cidade}
      <div class="conteudo">
        ${h.tipos}${h.resp}${h.local}${blocoTempo(o)}
        ${minha(cno) ? `<section><h4>Meu andamento</h4>${(E.vistaDialog = true, seletorStatus(o))}</section>` : ""}
        <section><h4>Andamento da equipe</h4><div class="atribuidos">${andamento}</div>${ehAdmin() ? controleEncaminhar(o) : ""}</section>
        ${o.tVinc ? `<section><h4>Empresas ligadas à obra</h4><p style="margin:0">${esc(o.tVinc)}</p></section>` : ""}
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
    if (!dlg.open) dlg.showModal();
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
    if (ev.target === $("detalhe") || ev.target.closest("[data-fechar]")) return $("detalhe").close();
    const ap = ev.target.closest("[data-apagar-nota]");
    if (ap) {
      if (ap.dataset.confirmar !== "1") { ap.dataset.confirmar = "1"; ap.textContent = "toque de novo para apagar"; return; }
      const { error } = await E.sb.from("anotacoes").delete().eq("id", Number(ap.dataset.apagarNota));
      if (error) return falha(error, "Não foi possível apagar");
      const cno = $("detalhe").dataset.cno;
      await carregarNotas(cno); atualizarFicha(cno);
    }
  });

  // ------------------------------------------------------------ equipe (admin)
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
    if (ev.target.id === "f-busca") { E.filtros[E.vista].busca = ev.target.value; clearTimeout(tBusca); tBusca = setTimeout(aplicar, 180); }
  });
  conteudo.addEventListener("change", (ev) => {
    const t = ev.target, f = E.filtros[E.vista];
    const mapa = { "f-mun": "mun", "f-dest": "dest", "f-enc": "enc", "f-ordem": "ordem" };
    if (mapa[t.id]) { f[mapa[t.id]] = t.value; return aplicar(); }
    if (t.dataset.encaminhar && t.value) return encaminhar(t.dataset.encaminhar, t.value);
    if (t.dataset.statusObra) return salvarAcomp(t.dataset.statusObra, { status: t.value });
    if (t.dataset.proxima !== undefined && t.matches("[data-proxima]")) return salvarAcomp(t.dataset.proxima, { proxima_acao: t.value || null });
    if (t.dataset.papel) return alterarPerfil(t.dataset.papel, { papel: t.value });
    if (t.dataset.ativo) return alterarPerfil(t.dataset.ativo, { ativo: t.checked });
  });
  conteudo.addEventListener("click", (ev) => {
    const t = ev.target;
    const chipJ = t.closest("[data-filtro-janela]"); if (chipJ) { E.filtros[E.vista].janela = chipJ.dataset.filtroJanela; return aplicar(); }
    const chipS = t.closest("[data-filtro-status]"); if (chipS) { E.filtros[E.vista].status = chipS.dataset.filtroStatus; return aplicar(); }
    const det = t.closest("[data-detalhe]"); if (det) return abrirDetalhe(det.dataset.detalhe);
    const rem = t.closest("[data-remover]"); if (rem) return remover(rem.dataset.remover, rem.dataset.vendedor);
    const cop = t.closest("[data-copiar]"); if (cop) return copiar(cop);
    if (t.id === "mais") return desenharMais();
    const modo = t.closest("[data-modo]");
    if (modo) { E.modo = modo.dataset.modo; gravarModo(E.modo); return renderVista(); }
    const ord = t.closest("[data-ordenar]");
    if (ord) { E.filtros[E.vista].ordem = ord.dataset.ordenar; const s = $("f-ordem"); if (s) s.value = ord.dataset.ordenar; return aplicar(); }
    const lin = t.closest(".linha-obra");
    if (lin && !t.closest("select, button, a, input, label")) return abrirDetalhe(lin.dataset.cno);
  });
  conteudo.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("linha-obra")) { ev.preventDefault(); abrirDetalhe(ev.target.dataset.cno); }
  });
  // encaminhar e tirar também pelo painel de detalhes
  $("detalhe").addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset.encaminhar && t.value) { await encaminhar(t.dataset.encaminhar, t.value); abrirDetalhe(t.dataset.encaminhar); }
  });
  $("detalhe").addEventListener("click", async (ev) => {
    const r = ev.target.closest("[data-remover]");
    if (r) { await remover(r.dataset.remover, r.dataset.vendedor); abrirDetalhe(r.dataset.remover); }
  });
  // andamento também pode ser alterado dentro do painel de detalhes
  $("detalhe").addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.statusObra) salvarAcomp(t.dataset.statusObra, { status: t.value }).then(() => abrirDetalhe(t.dataset.statusObra));
    else if (t.matches("[data-proxima]")) salvarAcomp(t.dataset.proxima, { proxima_acao: t.value || null });
  });
  $("detalhe").addEventListener("close", () => { const cno = $("detalhe").dataset.cno; if (cno) atualizarFicha(cno); });
  $("detalhe").addEventListener("click", (ev) => { const c = ev.target.closest("[data-copiar]"); if (c) copiar(c); });

  iniciar().catch((e) => { console.error(e); msg("Erro ao iniciar: " + (e.message || e)); });
})();
