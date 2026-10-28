"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MB = 1024 * 1024;
const CATS = ["Jogos", "Humor", "Música", "Esportes", "Curiosidades", "Outras"];
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTam = b => b >= MB * 1024 ? (b / MB / 1024).toFixed(2) + " GB" : (b / MB).toFixed(1) + " MB";
const fmtDur = s => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");

/* ---------- Configurações (salvas no navegador) ---------- */
const padrao = { qualidade: "media", limiteMB: 500, maxShorts: 50, wifi: true, movel: false };
const cfg = Object.assign({}, padrao, JSON.parse(localStorage.getItem("op_cfg") || "{}"));
const salvarCfg = () => { localStorage.setItem("op_cfg", JSON.stringify(cfg)); render(); };

/* ---------- Banco local (IndexedDB) ---------- */
const abrirDB = () => new Promise((ok, erro) => {
  const r = indexedDB.open("offlineplus", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("videos", { keyPath: "id", autoIncrement: true });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => erro(r.error);
});
async function banco(modo, fn) {
  const d = await abrirDB();
  return new Promise((ok, erro) => {
    const t = d.transaction("videos", modo);
    const req = fn(t.objectStore("videos"));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = t.onabort = () => erro(t.error);
  });
}
const todos = () => banco("readonly", s => s.getAll());
const gravar = v => banco("readwrite", s => s.put(v));
const apagar = id => banco("readwrite", s => s.delete(id));

/* ---------- Estado e navegação ---------- */
let videos = [], urls = [], modo = "short", cat = "Todas", aba = "fila";

function ir(tela) {
  if (tela === "biblioteca-tab") { aba = "biblioteca"; tela = "downloads"; }
  $$(".tela").forEach(t => t.classList.toggle("ativa", t.id === tela));
  $$("nav button").forEach(b => b.classList.toggle("on", b.dataset.ir === tela));
  render();
}
$$("[data-ir]").forEach(b => b.onclick = () => ir(b.dataset.ir));

/* ---------- Importar vídeos reais do celular ---------- */
function lerMeta(file) {
  return new Promise((ok, erro) => {
    const u = URL.createObjectURL(file), v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { ok({ dur: v.duration, w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(u); };
    v.onerror = () => { URL.revokeObjectURL(u); erro(new Error("formato não suportado")); };
    v.src = u;
  });
}
async function importar(files) {
  const aviso = $("#aviso"); aviso.className = "aviso"; aviso.textContent = "";
  const msgs = [];
  for (const f of files) {
    const usado = (await todos()).reduce((a, v) => a + v.size, 0);
    if (usado + f.size > cfg.limiteMB * MB) { msgs.push(`"${f.name}": sem espaço no limite de ${cfg.limiteMB} MB. Nada foi apagado; aumente o limite em Mais ou exclua manualmente.`); continue; }
    if (videos.some(v => v.name === f.name && v.size === f.size)) { msgs.push(`"${f.name}": já está na biblioteca.`); continue; }
    try {
      const m = await lerMeta(f);
      await gravar({ name: f.name, blob: f, size: f.size, duracao: m.dur, kind: (m.h > m.w && m.dur <= 90) ? "short" : "full", categoria: $("#catImport").value, assistido: false, exemplo: false, em: Date.now() });
      msgs.push(`"${f.name}": salvo.`);
    } catch (e) { msgs.push(`"${f.name}": não foi salvo (${e.message}).`); }
  }
  aviso.textContent = msgs.join(" ");
  if (msgs.some(m => m.includes("não foi") || m.includes("sem espaço"))) aviso.className = "aviso erro";
  await carregar();
}

/* ---------- Telas ---------- */
async function carregar() { videos = await todos(); render(); }

function render() {
  const usado = videos.reduce((a, v) => a + v.size, 0), pct = Math.min(100, usado / (cfg.limiteMB * MB) * 100);
  ["in", "d"].forEach(p => {
    $("#" + p + "Uso").textContent = fmtTam(usado);
    $("#" + p + "Limite").textContent = cfg.limiteMB + " MB";
    $("#" + p + "Barra").style.width = pct + "%";
  });
  const ns = videos.filter(v => v.kind === "short").length;
  $("#inContagem").textContent = videos.length ? `${ns} Shorts e ${videos.length - ns} completos salvos.` : "Nenhum vídeo salvo ainda.";
  $("#cfgQualidade").value = cfg.qualidade; $("#cfgLimite").value = cfg.limiteMB;
  $("#cfgMax").value = cfg.maxShorts; $("#cfgWifi").checked = cfg.wifi; $("#cfgMovel").checked = cfg.movel;
  $("#painelFila").hidden = aba !== "fila"; $("#painelBib").hidden = aba !== "biblioteca";
  $$("#segDown button").forEach(b => b.classList.toggle("on", b.dataset.k === aba));
  if ($("#videos").classList.contains("ativa")) renderVideos();
  if ($("#downloads").classList.contains("ativa") && aba === "biblioteca") renderBib();
}

function limparUrls() { urls.forEach(URL.revokeObjectURL); urls = []; }
const url = v => { const u = URL.createObjectURL(v.blob); urls.push(u); return u; };

function renderVideos() {
  limparUrls();
  $("#videos").classList.toggle("modo-short", modo === "short");
  $$("#segVideos button").forEach(b => b.classList.toggle("on", b.dataset.k === modo));
  $("#chips").innerHTML = ["Todas", ...CATS].map(c => `<button class="${c === cat ? "on" : ""}" data-c="${c}">${c}</button>`).join("");
  const q = $("#buscaVideos").value.trim().toLowerCase();
  const lista = videos.filter(v => v.kind === modo && (cat === "Todas" || v.categoria === cat) && v.name.toLowerCase().includes(q));
  const box = $("#listaVideos");
  if (!lista.length) { box.className = ""; box.innerHTML = `<p class="vazio">Nenhum ${modo === "short" ? "Short" : "vídeo completo"} aqui ainda.<br>Importe vídeos em Downloads › Biblioteca.</p>`; return; }
  if (modo === "short") {
    box.className = "shorts";
    box.innerHTML = lista.map((v, i) => `<div class="short"><video data-i="${i}" src="${url(v)}" loop playsinline preload="metadata"></video><span>${esc(v.name)}</span></div>`).join("");
    const obs = new IntersectionObserver(es => es.forEach(e => {
      const vid = e.target;
      if (e.isIntersecting) { vid.play().catch(() => {}); const v = lista[vid.dataset.i]; if (!v.assistido) { v.assistido = true; gravar(v); } } else vid.pause();
    }), { threshold: .7 });
    $$(".short video").forEach(vd => { obs.observe(vd); vd.onclick = () => vd.paused ? vd.play() : vd.pause(); });
  } else {
    box.className = "";
    box.innerHTML = lista.map(v => `<div class="item"><div class="info"><b>${esc(v.name)}</b><small>${fmtDur(v.duracao)} · ${v.categoria}</small></div><div class="acoes"><button data-play="${v.id}">Assistir</button></div></div>`).join("");
  }
}

function renderBib() {
  const q = $("#buscaBib").value.trim().toLowerCase();
  const lista = videos.filter(v => v.name.toLowerCase().includes(q));
  $("#listaBib").innerHTML = lista.length ? lista.map(v => `<div class="item"><div class="info"><b>${esc(v.name)}</b><small>${v.kind === "short" ? "Short" : "Completo"} · ${fmtDur(v.duracao)} · ${fmtTam(v.size)} · ${v.assistido ? "assistido" : "novo"} · salvo</small></div><div class="acoes"><button data-play="${v.id}">Ver</button><button data-vis="${v.id}">${v.assistido ? "Novo" : "Visto"}</button><button class="del" data-del="${v.id}">Apagar</button></div></div>`).join("") : `<p class="vazio">Biblioteca vazia.</p>`;
}

/* ---------- Player em tela cheia ---------- */
let urlPlayer = null;
function abrirPlayer(v) {
  urlPlayer = URL.createObjectURL(v.blob);
  $("#pv").src = urlPlayer; $("#player").hidden = false; $("#pv").play().catch(() => {});
  if (!v.assistido) { v.assistido = true; gravar(v).then(carregar); }
}
function fecharPlayer() { $("#pv").pause(); $("#pv").removeAttribute("src"); $("#pv").load(); $("#player").hidden = true; if (urlPlayer) URL.revokeObjectURL(urlPlayer); }
$("#pFecha").onclick = fecharPlayer;
$("#pVolta").onclick = () => $("#pv").currentTime -= 10;
$("#pAvanca").onclick = () => $("#pv").currentTime += 10;

/* ---------- Eventos ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  const get = id => videos.find(v => v.id === Number(id));
  if (b.dataset.play) abrirPlayer(get(b.dataset.play));
  if (b.dataset.del && confirm("Apagar este vídeo do celular?")) { await apagar(Number(b.dataset.del)); carregar(); }
  if (b.dataset.vis) { const v = get(b.dataset.vis); v.assistido = !v.assistido; await gravar(v); carregar(); }
  if (b.dataset.c) { cat = b.dataset.c; renderVideos(); }
  if (b.closest("#segVideos")) { modo = b.dataset.k; renderVideos(); }
  if (b.closest("#segDown")) { aba = b.dataset.k; render(); }
});
$("#arquivo").onchange = e => { importar([...e.target.files]); e.target.value = ""; };
$("#buscaVideos").oninput = renderVideos;
$("#buscaBib").oninput = renderBib;
$("#catImport").innerHTML = CATS.map(c => `<option>${c}</option>`).join("");
$("#cfgQualidade").onchange = e => { cfg.qualidade = e.target.value; salvarCfg(); };
$("#cfgLimite").onchange = e => { cfg.limiteMB = Number(e.target.value); salvarCfg(); };
$("#cfgMax").onchange = e => { cfg.maxShorts = Math.max(1, Math.min(50, Number(e.target.value) || 50)); salvarCfg(); };
$("#cfgWifi").onchange = e => { cfg.wifi = e.target.checked; salvarCfg(); };
$("#cfgMovel").onchange = e => { cfg.movel = e.target.checked; salvarCfg(); };

carregar().catch(() => { $("#inContagem").textContent = "Não consegui abrir o armazenamento local deste navegador."; });
