/* Fiscalização de Obras · app (campo + gestão) */
'use strict';
const CFG = window.FISC_CONFIG || { divisoes: {} };
const VERSAO_APP = '1.13.0';
const LIB = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfw: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  pdflib: './pdf-lib.min.js'
};
const ALTERACOES = ['Poste deslocado', 'Estrutura diferente', 'Altura/esforço do poste diferente', 'Condutor/vão diferente', 'Equipamento diferente', 'Aterramento diferente', 'Outro'];
const MOTIVOS_REP = ['Estrutura divergente do projeto', 'Poste fora de posição', 'Falta material ou acabamento', 'Segurança / aterramento', 'Foto não comprova', 'Outro'];
const PENDENCIAS = ['Falta material', 'Impedimento do proprietário', 'Roçada/supressão pendente', 'Interferência (outra rede, via)', 'Condição de terreno/clima', 'Outro'];
const PRMAP = window.PRMAP;

/* ================= estado ================= */
const S = {
  sess: lsGet('fisc.sess', []), obras: [], regs: [], emps: {}, raw: {}, hist: null, histLista: null, ultimaTentativa: 0, fila: [], idx: {}, carregado: false, carregando: false, ultimaSync: null,
  mode: null, view: 'painel', obraId: null, nome: lsGet('fisc.nome', ''), verTodas: lsGet('fisc.todas', false), mapZoom: 'obras', divFiltro: ''
};
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } }
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmt1 = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
const dBR = s => { if (!s) return '—'; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s };
const dtBR = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) };
const diasAte = s => { if (!s) return null; const a = new Date(s + 'T12:00:00'), b = new Date(hoje() + 'T12:00:00'); return Math.round((a - b) / 864e5) };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));
function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), err ? 5200 : 2600) }
const driveImg = (id, w) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w || 1600}`;
const driveImg2 = (id, w) => `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${w || 1600}`;
const driveVer = id => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
function fotoSrc(f, w) { if (!f) return ''; if (f.local) return f.local; return driveImg(f.id, w) }
function imgFallback(el) { el.onerror = () => { if (el.dataset.fb || !el.dataset.id) return; el.dataset.fb = 1; el.src = driveImg2(el.dataset.id, el.dataset.w) } }

/* ================= sessões / perfis ================= */
const sessDe = pref => S.sess.find(s => s.pref === pref);
const sessObra = o => sessDe(o.pref);
const papelObra = o => (sessObra(o) || {}).papel;
const souGestor = () => S.sess.some(s => s.papel === 'gestor');
const souCopel = () => S.sess.some(s => s.papel !== 'empreiteira');
const podeEditarObra = o => papelObra(o) === 'gestor';
const podeInvalidar = o => ['gestor', 'fiscal'].includes(papelObra(o));
function empresaCampo(o) { const s = sessObra(o); return s && s.papel === 'empreiteira' ? s.empresa : 'Copel (fiscalização)' }
function salvarSess() { lsSet('fisc.sess', S.sess.map(s => ({ pref: s.pref, div: s.div, url: s.url, chave: s.chave, papel: s.papel, empresa: s.empresa, responsavel: s.responsavel }))) }
function divisaoDoCodigo(c) {
  const pref = String(c || '').trim().toUpperCase().split('-')[0];
  const d = (CFG.divisoes || {})[pref];
  return d ? { pref, sigla: d.sigla, url: d.url } : null;
}

/* ================= armazenamento local (IndexedDB) ================= */
const IDB = {
  db: null,
  open() { if (this.db) return Promise.resolve(this.db); return new Promise((ok, ko) => { const r = indexedDB.open('fiscalizacao', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; ok(r.result) }; r.onerror = () => ko(r.error) }) },
  async tx(mode, fn) { const db = await this.open(); return new Promise((ok, ko) => { const t = db.transaction('kv', mode); const st = t.objectStore('kv'); const q = fn(st); t.oncomplete = () => ok(q && q.result); t.onerror = () => ko(t.error) }) },
  get(k) { return this.tx('readonly', s => s.get(k)) },
  set(k, v) { return this.tx('readwrite', s => s.put(v, k)) },
  del(k) { return this.tx('readwrite', s => s.delete(k)) },
  async keys(p) { const all = await this.tx('readonly', s => s.getAllKeys()); return (all || []).filter(k => String(k).startsWith(p)) }
};

/* ================= servidor (Apps Script da divisão) ================= */
async function api(sess, acao, dados = {}) {
  let r;
  try {
    r = await fetch(sess.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ acao, chave: sess.chave }, dados)) });
  } catch (e) { const er = new Error('sem conexão'); er.rede = true; throw er }
  if (!r.ok) { const er = new Error('servidor respondeu ' + r.status); er.rede = r.status >= 500; throw er }
  let j; try { j = await r.json() } catch (e) { const er = new Error('resposta inválida do servidor'); er.rede = true; throw er }
  if (!j.ok) { const er = new Error(j.erro || 'erro no servidor'); er.codigo = j.codigo; throw er }
  return j;
}
function blobB64(b) { return new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => ko(fr.error); fr.readAsDataURL(b) }) }

function normalizar(pref, d) {
  const obras = (d.obras || []).map(o => Object.assign({}, o, {
    pref, postes: Array.isArray(o.postes) ? o.postes : [], us: Number(o.us) || 0,
    lat: o.lat === '' || o.lat == null ? null : Number(o.lat), lon: o.lon === '' || o.lon == null ? null : Number(o.lon),
    planta: { id: o.plantaId, w: Number(o.plantaW) || 2000, h: Number(o.plantaH) || 1400 }, pdf: o.pdfId ? { id: o.pdfId, nome: o.pdfNome } : null
  }));
  obras.forEach(o => { o.folhas = [o.planta].concat((Array.isArray(o.folhas) ? o.folhas : []).map(f => ({ id: f.id, w: Number(f.w) || 2000, h: Number(f.h) || 1400 }))) });
  const regs = (d.registros || []).map(r => Object.assign({}, r, {
    pref, em: r.marcadoEm || r.recebidoEm, equipe: r.nome, foto: r.fotoId ? { id: r.fotoId } : null,
    x: r.x === '' ? null : r.x, y: r.y === '' ? null : r.y, poste: r.poste || null, folha: Number(r.folha) || 0
  }));
  return { obras, regs };
}

/* cópia local por divisão: obras e registros por id + data da última sincronização */
function cacheVazio() { return { obras: {}, registros: {}, desde: null, empreiteiras: null, qtdHistorico: 0 } }
function converterCache(c) {
  if (!c) return cacheVazio();
  if (Array.isArray(c.obras)) return { obras: Object.fromEntries(c.obras.map(o => [o.id, o])), registros: Object.fromEntries((c.registros || []).map(r => [r.id, r])), desde: null, empreiteiras: c.empreiteiras || null, qtdHistorico: 0 };
  return Object.assign(cacheVazio(), c);
}
async function carregarRaw(pref) {
  if (!S.raw[pref]) { const c = await IDB.get('cache:' + pref).catch(() => null); S.raw[pref] = converterCache(c) }
  return S.raw[pref];
}
function aplicar(raw, d) {
  if (d.semMudanca) { raw.desde = d.agora; return false }
  if (!d.incremental) { raw.obras = {}; raw.registros = {} }
  (d.obras || []).forEach(o => raw.obras[o.id] = o);
  (d.registros || []).forEach(r => raw.registros[r.id] = r);
  if (Array.isArray(d.idsObras)) {
    const vale = new Set(d.idsObras);
    for (const id in raw.obras) if (!vale.has(id)) delete raw.obras[id];
    for (const id in raw.registros) if (!vale.has(raw.registros[id].obra)) delete raw.registros[id];
  }
  if (Array.isArray(d.empreiteiras)) raw.empreiteiras = d.empreiteiras;
  if (Array.isArray(d.aes)) raw.aes = d.aes;
  if (d.qtdHistorico != null) raw.qtdHistorico = d.qtdHistorico;
  raw.desde = d.incremental !== undefined ? d.agora : null; // servidor antigo: sempre completo
  return true;
}
function montar() {
  const obras = [], regs = [];
  for (const s of S.sess) {
    const raw = S.raw[s.pref]; if (!raw) continue;
    const n = normalizar(s.pref, { obras: Object.values(raw.obras), registros: Object.values(raw.registros) });
    obras.push(...n.obras); regs.push(...n.regs);
    if (Array.isArray(raw.empreiteiras)) S.emps[s.pref] = raw.empreiteiras;
  }
  S.obras = obras; S.regs = regs;
}
const qtdHistorico = () => S.sess.filter(s => !S.divFiltro || s.pref === S.divFiltro).reduce((n, s) => n + ((S.raw[s.pref] || {}).qtdHistorico || 0), 0);

async function sincronizar(op) {
  if (!S.sess.length) return;
  if (S.carregando) { S.denovo = true; return }
  const completo = !!(op && op.completo);
  S.carregando = true; setSt('sincronizando…');
  let falhou = 0, mudou = !S.carregado;
  for (const s of [...S.sess]) {
    const raw = await carregarRaw(s.pref);
    try {
      const d = await api(s, 'dados', raw.desde && !completo ? { desde: raw.desde } : {});
      if (d.docs && JSON.stringify(d.docs) !== JSON.stringify(raw.docs)) { raw.docs = d.docs; mudou = true }
      if (d.pde && JSON.stringify(d.pde) !== JSON.stringify(raw.pde)) { raw.pde = d.pde; mudou = true }
      if (Array.isArray(d.fiscais)) raw.fiscais = d.fiscais;
      if (aplicar(raw, d)) mudou = true;
      IDB.set('cache:' + s.pref, raw).catch(() => { });
    } catch (e) {
      if (e.codigo === 'chave') { toast(`O código da ${s.div} foi bloqueado ou removido.`, 1); S.sess = S.sess.filter(x => x !== s); salvarSess(); delete S.raw[s.pref]; mudou = true; continue }
      falhou++;
    }
  }
  S.ultimaTentativa = Date.now();
  if (mudou) montar();
  S.carregado = true; S.carregando = false;
  if (!falhou) S.ultimaSync = new Date();
  await carregarFila();
  reindex();
  setSt(falhou ? 'sem conexão · dados salvos no aparelho' : '', !!falhou);
  if (!S.sess.length) { route(); return }
  if (mudou) render(true);
  if (S.denovo) { S.denovo = false; setTimeout(() => sincronizar(), 300) }
}

/* ---------- fila de envio (offline) ---------- */
async function carregarFila() {
  try {
    const ks = await IDB.keys('fila:');
    const itens = [];
    for (const k of ks) { const v = await IDB.get(k); if (v) itens.push(v) }
    S.fila = itens.sort((a, b) => (a.registro.marcadoEm || '').localeCompare(b.registro.marcadoEm || ''));
  } catch (e) { S.fila = [] }
}
let enviando = false;
async function enviarFila() {
  if (enviando || !S.fila.length) return;
  enviando = true; let enviados = 0;
  for (const it of [...S.fila]) {
    const s = sessDe(it.pref); if (!s) continue;
    try {
      await api(s, 'registrar', { registro: it.registro, foto: it.fotoB64 ? { b64: it.fotoB64 } : null });
      await IDB.del('fila:' + it.registro.id); enviados++;
    } catch (e) {
      if (e.rede) break;
      toast('Registro recusado pelo servidor: ' + e.message, 1);
      await IDB.del('fila:' + it.registro.id);
    }
  }
  enviando = false;
  await carregarFila();
  if (enviados) { toast(enviados + ' registro(s) pendente(s) enviado(s)'); sincronizar() } else { reindex(); render(true) }
}
addEventListener('online', () => { enviarFila(); sincronizar() });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { enviarFila(); if (Date.now() - S.ultimaTentativa > 30000) sincronizar() } });
// campo atualiza a cada 4 min e gestão a cada 2 min (o envio de registros é sempre imediato)
setInterval(() => { if (document.visibilityState !== 'visible') return; enviarFila(); const int = S.mode === 'campo' ? 240000 : 120000; if (Date.now() - S.ultimaTentativa >= int) sincronizar() }, 30000);

/* ================= índice derivado ================= */
const EXEC = new Set(['conforme', 'alterado', 'novo']);
const FISC = new Set(['aprovado', 'reprovado']);
function todosRegs() {
  const pend = S.fila.map(it => Object.assign({}, it.registro, { pref: it.pref, em: it.registro.marcadoEm, equipe: it.registro.nome, pendente: true, foto: it.fotoLocal ? { local: it.fotoLocal } : null }));
  const ids = new Set(S.regs.map(r => r.id));
  return S.regs.concat(pend.filter(p => !ids.has(p.id)));
}
function novoIdx() { return { postes: new Map(), novos: [], regs: [], ultimo: null, porDia: {} } }
function acumular(I, r) {
  I.regs.push(r);
  if (r.invalido) return;
  if (r.tipo === 'novo' && !I.novos.find(n => n.key === 'N:' + r.id)) I.novos.push({ key: 'N:' + r.id, x: Number(r.x), y: Number(r.y), desc: r.obs, id: r.id, f: Number(r.folha) || 0 });
  const key = r.tipo === 'novo' ? 'N:' + r.id : r.poste;
  const st = I.postes.get(key) || { hist: [], first: null };
  st.hist.push(r);
  if (FISC.has(r.tipo)) st.fisc = r;
  else { st.last = r; if (EXEC.has(r.tipo) && !st.first) st.first = r.dataExec || (r.em || '').slice(0, 10) }
  I.postes.set(key, st);
  if (!I.ultimo || r.em > I.ultimo) I.ultimo = r.em;
}
function fechar(o, I) {
  const tot = (o.postes || []).length; let ok = 0, alt = 0, bad = 0;
  for (const p of (o.postes || [])) {
    const st = I.postes.get('P' + p.n); if (!st || !st.last) continue;
    const t = st.last.tipo; if (t === 'conforme') ok++; else if (t === 'alterado') alt++; else if (t === 'nao') bad++;
  }
  for (const [, st] of I.postes) if (st.first) I.porDia[st.first] = (I.porDia[st.first] || 0) + 1;
  I.tot = tot; I.ok = ok; I.alt = alt; I.bad = bad; I.exec = ok + alt; I.pct = tot ? (ok + alt) / tot : 0;
  I.usExec = (o.us || 0) * I.pct;
  // fiscalização: vale a aprovação posterior à última execução do poste
  let fis = 0, rep = 0;
  for (const p of (o.postes || [])) { const f = fiscPoste(I, 'P' + p.n); if (f === 'aprovado') fis++; else if (f === 'reprovado') rep++ }
  for (const n of I.novos) { const f = fiscPoste(I, n.key); if (f === 'reprovado') rep++ }
  I.fis = fis; I.rep = rep; I.pctFis = tot ? fis / tot : 0; I.usMed = (o.us || 0) * I.pctFis;
  I.etapa = I.exec === 0 ? 'empenhada' : I.exec < tot ? 'execucao' : (tot && fis >= tot ? 'medida' : 'executada');
  I.pend = I.regs.filter(r => r.pendente).length;
  const gps = I.regs.filter(r => r.gps && !r.invalido && r.gps.lat != null);
  I.gps = gps.length ? { lat: gps.reduce((s, r) => s + Number(r.gps.lat), 0) / gps.length, lon: gps.reduce((s, r) => s + Number(r.gps.lon), 0) / gps.length } : null;
}
const porData = (a, b) => (a.em || '').localeCompare(b.em || '');
function reindex() {
  const idx = {};
  for (const o of S.obras) idx[o.id] = novoIdx();
  for (const r of todosRegs().sort(porData)) { const I = idx[r.obra]; if (I) acumular(I, r) }
  for (const o of S.obras) fechar(o, idx[o.id]);
  if (S.hist) { const I = novoIdx(); [...S.hist.regs].sort(porData).forEach(r => acumular(I, r)); fechar(S.hist.obra, I); idx[S.hist.obra.id] = I }
  S.idx = idx;
}
const getObra = id => S.obras.find(x => x.id === id) || (S.hist && S.hist.obra.id === id ? S.hist.obra : null);
function posObra(o) { if (o.lat != null && o.lon != null) return { lat: o.lat, lon: o.lon }; const I = S.idx[o.id]; return I && I.gps ? I.gps : null }
function fiscPoste(I, key) {
  const st = I && I.postes.get(key); if (!st || !st.fisc || !st.last || !EXEC.has(st.last.tipo)) return '';
  return (st.fisc.em || '') >= (st.last.em || '') ? st.fisc.tipo : '';
}
const ETAPA_TX = { empenhada: 'Empenhada', execucao: 'Em execução', executada: 'Executada · aguardando fiscalização', medida: 'Medida · aguardando FF' };
const ETAPA_CH = { empenhada: '', execucao: 'or', executada: 'alt', medida: 'ok' };
const etapaChip = I => `<span class="chip ${ETAPA_CH[I.etapa]}">${ETAPA_TX[I.etapa]}</span>`;
function statusPoste(o, key) {
  const I = S.idx[o.id]; const st = I && I.postes.get(key); if (!st || !st.last) return '';
  const t = st.last.tipo; const c = t === 'conforme' ? 'ok' : t === 'alterado' ? 'alt' : t === 'nao' ? 'bad' : t === 'novo' ? 'novo' : '';
  const f = fiscPoste(S.idx[o.id], key);
  return c + (f === 'aprovado' ? ' fis' : f === 'reprovado' ? ' rep' : '') + (st.last.pendente || (st.fisc && st.fisc.pendente) ? ' pend' : '');
}
const TIPO_TX = { conforme: 'Executado conforme projeto', alterado: 'Executado com alteração', nao: 'Não executado', novo: 'Poste não previsto', aprovado: 'Aprovado pelo fiscal (medido)', reprovado: 'Reprovado pelo fiscal' };
const TIPO_CH = { conforme: 'ok', alterado: 'alt', nao: 'bad', novo: 'novo', aprovado: 'ok', reprovado: 'bad' };
const TIPO_RET = { conforme: 'Retirado conforme projeto', alterado: 'Retirado com alteração', nao: 'Não retirado' };
function tipoTx(o, r) {
  const p = r.poste && String(r.poste).startsWith('P') ? (o.postes || []).find(x => 'P' + x.n === r.poste) : null;
  return (p && p.acao === 'retirar' && TIPO_RET[r.tipo]) || TIPO_TX[r.tipo] || r.tipo;
}
const obrasVisiveis = () => S.divFiltro ? S.obras.filter(o => o.pref === S.divFiltro) : S.obras;

function setSt(t, err) {
  const el = $('#dbst'); if (!el) return;
  const pend = S.fila.length ? ` · ${S.fila.length} a enviar` : '';
  el.textContent = (t || (S.ultimaSync ? 'atualizado ' + S.ultimaSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')) + pend;
  el.className = 'dbst' + (err ? ' err' : '');
}

/* ================= login ================= */
function vLogin(app, adicionando) {
  document.body.classList.remove('campo');
  app.innerHTML = `<div class="login"><div class="card">
    <div class="logo">Fiscalização <span>de Obras</span></div>
    <p class="muted">${adicionando ? 'Digite o código de acesso de outra divisão.' : 'Digite o código de acesso que você recebeu da fiscalização.'}</p>
    <label class="f">Código de acesso</label>
    <input class="i" id="cod" placeholder="Ex.: CEP-AB12-CD34" autocapitalize="characters" autocomplete="off" spellcheck="false" style="font-size:18px;letter-spacing:.06em;text-transform:uppercase">
    <button class="btn pri" id="entrar" style="width:100%;margin-top:14px;padding:13px;font-size:15px">Entrar</button>
    ${adicionando ? '<button class="btn ghost" id="canc" style="width:100%;margin-top:8px">Cancelar</button>' : ''}
    <div class="small muted" id="lmsg" style="margin-top:10px;min-height:18px"></div>
  </div><div class="small muted" style="text-align:center;margin-top:12px">v${VERSAO_APP}</div></div>`;
  const go_ = async () => {
    const c = $('#cod').value.trim().toUpperCase(); const msg = $('#lmsg');
    const d = divisaoDoCodigo(c);
    if (!d) { msg.textContent = 'Código não reconhecido. Confira as letras do início.'; return }
    if (!d.url) { msg.textContent = `A divisão ${d.sigla} ainda não está ligada ao app.`; return }
    if (sessDe(d.pref)) { msg.textContent = `Você já está conectado à ${d.sigla}.`; return }
    $('#entrar').disabled = true; msg.textContent = 'Verificando…';
    try {
      const j = await api({ url: d.url, chave: c }, 'login');
      S.sess.push({ pref: d.pref, div: j.perfil.divisao || d.sigla, url: d.url, chave: c, papel: j.perfil.papel, empresa: j.perfil.empresa, responsavel: j.perfil.responsavel });
      salvarSess();
      if (j.perfil.papel === 'empreiteira' && !S.nome) S.nome = '';
      location.hash = (j.perfil.papel === 'empreiteira' || innerWidth < 760) ? 'campo' : 'painel';
      await sincronizar(); route();
    } catch (e) { $('#entrar').disabled = false; msg.textContent = e.rede ? 'Sem conexão com o servidor. Tente de novo com sinal.' : e.message }
  };
  $('#entrar').onclick = go_;
  $('#cod').onkeydown = e => { if (e.key === 'Enter') go_() };
  $('#canc') && ($('#canc').onclick = () => { location.hash = 'painel'; route() });
  setTimeout(() => $('#cod').focus(), 50);
}
function vConta(app) {
  app.innerHTML = `<div class="card" style="max-width:560px;margin:0 auto"><h2>Acesso</h2>
   ${S.sess.map(s => `<div class="acc"><div><b>${esc(s.div)}</b> <span class="chip ${s.papel === 'gestor' ? 'or' : s.papel === 'fiscal' ? 'novo' : ''}">${esc(s.papel)}</span><div class="small muted">${esc(s.empresa)}${s.responsavel ? ' · ' + esc(s.responsavel) : ''}</div></div><button class="btn sm ghost" data-sair="${esc(s.pref)}">Sair</button></div>`).join('')}
   ${souCopel() ? '<button class="btn ghost" id="maisdiv" style="margin-top:12px">+ Conectar outra divisão</button>' : ''}
   <label class="f" style="margin-top:18px">Seu nome (vai junto com os registros de campo)</label><input class="i" id="nm" value="${esc(S.nome)}">
   <div style="margin-top:16px" class="small muted">Registros aguardando envio: <b>${S.fila.length}</b>${S.fila.length ? ' <button class="btn sm" id="envf">Enviar agora</button>' : ''}</div>
   <div class="small muted" style="margin-top:6px">Versão do app ${VERSAO_APP}</div></div>`;
  $$('[data-sair]', app).forEach(b => b.onclick = () => {
    const s = sessDe(b.dataset.sair); if (S.fila.some(f => f.pref === s.pref) && !b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Há registros não enviados. Sair mesmo?'; return }
    S.sess = S.sess.filter(x => x !== s); salvarSess(); IDB.del('cache:' + s.pref).catch(() => { }); delete S.raw[s.pref];
    S.obras = S.obras.filter(o => o.pref !== s.pref); S.regs = S.regs.filter(r => r.pref !== s.pref); reindex(); route();
  });
  $('#maisdiv') && ($('#maisdiv').onclick = () => vLogin(app, true));
  $('#nm').onchange = e => { S.nome = e.target.value.trim(); lsSet('fisc.nome', S.nome); toast('Nome salvo') };
  $('#envf') && ($('#envf').onclick = () => enviarFila());
}

/* ================= roteamento ================= */
function route() {
  const h = (location.hash || '').slice(1);
  const soCampo = S.sess.length && !souCopel();
  let m = h.match(/^(campo)(?:-(.+))?$/);
  if (!S.sess.length) { S.view = 'login' }
  else if (h === 'conta') { S.view = 'conta'; S.mode = S.mode || (soCampo ? 'campo' : 'gestao') }
  else if (h === 'assinar' || /^doc-/.test(h)) { S.mode = soCampo ? 'campo' : (h === 'assinar' ? 'campo' : (S.mode || 'gestao')); S.view = h === 'assinar' ? 'assinar' : 'doc'; S.docId = h.slice(4) }
  else if (h === 'docs' && !soCampo) { S.mode = 'gestao'; S.view = 'docs' }
  else if (h === 'assinatura') { S.mode = 'campo'; S.view = 'assinatura' }
  else if (h === 'pdes') { S.mode = soCampo ? 'campo' : (S.mode || 'gestao'); S.view = 'pdes' }
  else if (h === 'fluxo') { S.mode = soCampo ? 'campo' : (S.mode || 'gestao'); S.view = 'fluxo' }
  else if (m || soCampo) { S.mode = 'campo'; S.view = m && m[2] ? 'fobra' : 'flist'; S.obraId = m && m[2] ? m[2] : null }
  else {
    m = h.match(/^obra-(.+)$/); const mh = h.match(/^hist-(.+)$/);
    if (m) { S.mode = 'gestao'; S.view = 'obra'; S.obraId = m[1] }
    else if (mh) { S.mode = 'gestao'; S.view = 'hobra'; S.obraId = mh[1] }
    else if (['painel', 'obras', 'nova', 'historico'].includes(h)) { S.mode = 'gestao'; S.view = h }
    else { S.mode = lsGet('fisc.modo', innerWidth < 760 ? 'campo' : 'gestao'); S.view = S.mode === 'campo' ? 'flist' : 'painel' }
  }
  if (S.view !== 'hobra' && S.hist) { S.hist = null; reindex() }
  if (S.mode) lsSet('fisc.modo', S.mode);
  document.body.classList.toggle('campo', S.mode === 'campo' && S.view !== 'login');
  $('#topo').classList.toggle('hidden', S.view === 'login');
  $('.modesw').classList.toggle('hidden', !!soCampo);
  $$('.modesw button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
  $('#nav').classList.toggle('hidden', S.mode === 'campo' || S.view === 'conta');
  $('#navnova').classList.toggle('hidden', !souGestor());
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === S.view || (S.view === 'obra' && a.dataset.v === 'obras') || (S.view === 'hobra' && a.dataset.v === 'historico') || (S.view === 'doc' && a.dataset.v === 'docs')));
  closeLayer(); render();
}
function go(h) { if (location.hash === '#' + h) route(); else location.hash = h }
$$('.modesw button').forEach(b => b.onclick = () => { lsSet('fisc.modo', b.dataset.m); go(b.dataset.m === 'campo' ? 'campo' : 'painel') });
addEventListener('hashchange', route);

/* ================= render ================= */
let VIEWER = null;
function render(fromData) {
  const app = $('#app');
  if (S.view === 'login') { vLogin(app); return }
  if (fromData && (S.view === 'nova' || S.view === 'conta' || S.view === 'historico' || S.view === 'hobra' || S.view === 'docs' || S.view === 'doc' || S.view === 'assinar' || S.view === 'assinatura' || S.view === 'fluxo' || S.view === 'pdes')) return;
  if (fromData && S.view === 'fobra' && VIEWER && VIEWER.obraId === S.obraId) { VIEWER.refresh(); updFbot(); return }
  if (fromData && S.view === 'obra' && VIEWER && VIEWER.obraId === S.obraId) { VIEWER.refresh(); renderObraSide(); return }
  if (S.view === 'conta') { VIEWER = null; vConta(app); return }
  if (!S.carregado) { app.innerHTML = `<div class="empty">Carregando…</div>`; return }
  VIEWER = null;
  ({ painel: vPainel, obras: vObras, nova: vNova, obra: vObra, flist: vFlist, fobra: vFobra, historico: vHistorico, hobra: vHObra, docs: vDocs, doc: vDoc, assinar: vAssinar, assinatura: vAssinatura, fluxo: vFluxo, pdes: vPdes }[S.view] || vPainel)(app);
}
function filtroDivHtml() {
  if (S.sess.length < 2) return '';
  return `<select class="i" id="fdiv" style="width:auto"><option value="">Todas as divisões</option>${S.sess.map(s => `<option value="${esc(s.pref)}" ${S.divFiltro === s.pref ? 'selected' : ''}>${esc(s.div)}</option>`).join('')}</select>`;
}
function ligarFiltroDiv() { $('#fdiv') && ($('#fdiv').onchange = e => { S.divFiltro = e.target.value; render() }) }

/* ---------- painel ---------- */
function vPainel(app) {
  const base = obrasVisiveis();
  const ativas = base.filter(o => o.status !== 'concluida' && o.status !== 'cancelada');
  let us = 0, usE = 0, usM = 0, pt = 0, pe = 0, pf = 0, hojeN = 0, alt = 0, bad = 0, rep = 0; const h = hoje(); const et = { empenhada: 0, execucao: 0, executada: 0, medida: 0 }; const usEt = { empenhada: 0, execucao: 0, executada: 0, medida: 0 };
  for (const o of ativas) { const I = S.idx[o.id]; us += o.us || 0; usE += I.usExec; usM += I.usMed; pt += I.tot; pe += I.exec; pf += I.fis; alt += I.alt; bad += I.bad; rep += I.rep; et[I.etapa]++; usEt[I.etapa] += o.us || 0 }
  const ids = new Set(base.map(o => o.id));
  for (const r of todosRegs()) if (!r.invalido && r.dataExec === h && ids.has(r.obra)) hojeN++;
  app.innerHTML = `
  ${S.sess.length > 1 ? `<div class="toolbar">${filtroDivHtml()}</div>` : ''}
  <div class="grid k4">
    <div class="kpi"><b>${ativas.length}</b><span>obras em andamento</span><small><a href="#historico" style="color:#8b97aa">${qtdHistorico()} encerradas no histórico</a></small></div>
    <div class="kpi"><b>${fmt(us)}</b><span>US empenhadas</span><small>obras em andamento</small></div>
    <div class="kpi"><b>${fmt(usE)}</b><span>US executadas</span><small>${us ? fmt1(usE / us * 100) + '%' : '—'} · ${fmt(pe)} de ${fmt(pt)} postes · ${alt} com alteração</small></div>
    <div class="kpi"><b>${fmt(usM)}</b><span>US medidas (fiscalizadas)</span><small>${us ? fmt1(usM / us * 100) + '%' : '—'} · ${fmt(pf)} postes aprovados${rep ? ` · ${rep} reprovados` : ''}</small></div>
    <div class="kpi"><b>${hojeN}</b><span>registros hoje</span><small>${dBR(h)}</small></div>
  </div>
  <div class="card etapas" style="margin-top:14px">${[['empenhada', 'Empenhadas', 'sem registro em campo'], ['execucao', 'Em execução', 'empreiteira registrando'], ['executada', 'Executadas em campo', 'aguardando fiscalização'], ['medida', 'Medidas', 'todos os postes aprovados · aguardando FF']].map(([k, t, sub]) => `<div><b>${et[k]}</b><span>${t}</span><small>${fmt(usEt[k])} US · ${sub}</small></div>`).join('<i>›</i>')}<i>›</i><a href="#historico"><b>${qtdHistorico()}</b><span>Encerradas</span><small>FF emitida · no histórico</small></a></div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Onde estão as obras</h2>
      <div class="legend"><span style="--c:var(--pend)">sem início</span><span style="--c:var(--or)">em execução</span><span style="--c:var(--ok)">executada em campo</span></div></div>
      <div class="mapbox" id="mapa" style="margin-top:8px"></div></div>
    <div class="grid" style="align-content:start">
      <div class="card chart"><h2>Avanço diário · postes executados</h2><div id="graf"></div></div>
      <div class="card"><h2>Pontos de atenção</h2><div id="aten"></div></div>
    </div>
  </div>
  ${S.sess.length > 1 && !S.divFiltro ? '<div class="card" style="margin-top:14px"><h2>Por divisão</h2><div id="pdiv"></div></div>' : ''}
  <div class="card" style="margin-top:14px"><h2>Por empreiteira</h2><div id="emp"></div></div>`;
  ligarFiltroDiv();
  alertaArmazenamento(app);
  { const r = pdeResumo(); if (r.sol) { const d = document.createElement('a'); d.href = '#pdes'; d.className = 'note'; d.style.cssText = 'display:block;margin-bottom:12px;background:#fff7ed;border-color:#fed7aa;color:#9a3412;text-decoration:none'; d.innerHTML = `📋 <b>${r.sol}</b> pedido(s) de PDE/PLV aguardando análise do fiscal. Toque para ver.`; app.prepend(d) } }
  desenharMapa($('#mapa'), ativas.length ? ativas : base);
  desenharGrafico($('#graf'), ativas);
  const at = [];
  for (const o of ativas) {
    const I = S.idx[o.id]; const d = diasAte(o.prazo);
    if (d != null && d < 0 && I.pct < 1) at.push([0, o, `<span class="chip bad">prazo vencido há ${-d} d</span>`]);
    else if (d != null && d <= 10 && I.pct < 1) at.push([1, o, `<span class="chip alt">prazo em ${d} d · ${fmt1(I.pct * 100)}%</span>`]);
    if (I.bad) at.push([2, o, `<span class="chip bad">${I.bad} poste(s) não executado(s)</span>`]);
    const sem = I.ultimo ? Math.floor((Date.now() - new Date(I.ultimo)) / 864e5) : null;
    if (sem != null && sem >= 3 && I.pct < 1) at.push([3, o, `<span class="chip">sem registro há ${sem} d</span>`]);
    if (!I.ultimo) at.push([4, o, `<span class="chip">ainda sem registro em campo</span>`]);
    if (I.rep) at.push([2, o, `<span class="chip bad">${I.rep} poste(s) reprovado(s) pelo fiscal</span>`]);
    if (I.etapa === 'executada') at.push([1, o, `<span class="chip alt">executada · falta fiscalizar ${I.tot - I.fis} poste(s)</span>`]);
    if (I.etapa === 'medida') at.push([1, o, `<span class="chip ok">todos os postes aprovados · emitir a FF</span>`]);
  }
  at.sort((a, b) => a[0] - b[0]);
  $('#aten').innerHTML = at.length ? `<table>${at.slice(0, 8).map(([, o, c]) => `<tr class="cl" data-o="${esc(o.id)}"><td><b>${esc(o.projeto)}</b><div class="small muted">${esc(o.empreiteira || '—')}${S.sess.length > 1 ? ' · ' + esc((sessObra(o) || {}).div || '') : ''}</div></td><td class="n">${c}</td></tr>`).join('')}</table>` : `<div class="muted small">Nada pendente.</div>`;
  const agrupar = (fk) => {
    const E = {};
    for (const o of ativas) {
      const I = S.idx[o.id]; const k = fk(o); const e = E[k] || (E[k] = { n: 0, us: 0, usE: 0, tot: 0, exec: 0, alt: 0, bad: 0, ult: null });
      e.n++; e.us += o.us || 0; e.usE += I.usExec; e.usM = (e.usM || 0) + I.usMed; e.tot += I.tot; e.exec += I.exec; e.alt += I.alt; e.bad += I.bad; if (I.ultimo && (!e.ult || I.ultimo > e.ult)) e.ult = I.ultimo
    }
    const ks = Object.keys(E).sort((a, b) => E[b].us - E[a].us);
    return ks.length ? `<table><thead><tr><th></th><th class="n">Obras</th><th class="n">US</th><th class="n">US exec.</th><th class="n">US medidas</th><th class="n">Postes</th><th>Avanço</th><th class="n">Alter.</th><th class="n">Não exec.</th><th>Último registro</th></tr></thead><tbody>${ks.map(k => { const e = E[k]; const p = e.tot ? e.exec / e.tot : 0; return `<tr><td><b>${esc(k)}</b></td><td class="n">${e.n}</td><td class="n">${fmt(e.us)}</td><td class="n">${fmt(e.usE)}</td><td class="n">${fmt(e.usM)}</td><td class="n">${e.exec}/${e.tot}</td><td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i class="b-ok" style="width:${p * 100}%"></i></div><span class="pct">${fmt1(p * 100)}%</span></div></td><td class="n">${e.alt}</td><td class="n">${e.bad}</td><td>${e.ult ? dtBR(e.ult) : '—'}</td></tr>` }).join('')}</tbody></table>` : `<div class="empty">Nenhuma obra em andamento.${souGestor() ? ' <a href="#nova">Empenhar a primeira obra</a>.' : ''}</div>`;
  };
  $('#emp').innerHTML = agrupar(o => o.empreiteira || '(sem empreiteira)');
  $('#pdiv') && ($('#pdiv').innerHTML = agrupar(o => (sessObra(o) || {}).div || o.pref));
  $$('[data-o]', app).forEach(el => el.onclick = () => go('obra-' + el.dataset.o));
}
function desenharMapa(el,obras){
  const M=PRMAP;const [x0,x1,y0,y1]=M.b;
  const P=(lat,lon)=>[(lon-x0)*M.k*M.sc,(y1-lat)*M.sc];
  const pts=obras.map(o=>({o,p:posObra(o)})).filter(x=>x.p);
  let vb=[0,0,M.W,M.H];
  if(S.mapZoom==='obras'&&pts.length){
    const xy=pts.map(x=>P(x.p.lat,x.p.lon));
    let a=Math.min(...xy.map(v=>v[0])),b=Math.max(...xy.map(v=>v[0])),c=Math.min(...xy.map(v=>v[1])),d=Math.max(...xy.map(v=>v[1]));
    const w=Math.max(b-a,170),h=Math.max(d-c,110);const cx=(a+b)/2,cy=(c+d)/2;const W=w*1.6,H=Math.max(h*1.6,W*M.H/M.W);const W2=H*M.W/M.H;
    vb=[cx-W2/2,cy-H/2,W2,H];
  }
  const sc=vb[2]/M.W;
  const maxUS=Math.max(1,...pts.map(x=>x.o.us||0));
  const circ=pts.map(({o,p})=>{const [x,y]=P(p.lat,p.lon);const I=S.idx[o.id];const r=(5+9*Math.sqrt((o.us||0)/maxUS))*sc;
    const c=I.pct>=1?'var(--ok)':I.exec>0?'var(--or)':'var(--pend)';
    return `<circle class="pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${c}" style="stroke-width:${1.5*sc}" data-o="${esc(o.id)}" data-t="${esc(o.projeto+' · '+(o.empreiteira||'')+' · '+fmt(o.us)+' US · '+fmt1(I.pct*100)+'%')}"/>`}).join('');
  // nomes dos municípios das obras
  const muns=[...new Set(obras.map(o=>o.municipio).filter(Boolean))];
  const lbl=muns.map(n=>{const c=M.c.find(z=>z[0]===n);if(!c)return '';const [x,y]=P(c[1],c[2]);return `<text x="${x}" y="${y-12*sc}" text-anchor="middle" font-size="${11*sc}" fill="#5d6676" font-weight="600">${esc(n)}</text>`}).join('');
  const sem=obras.length-pts.length;
  el.innerHTML=`<svg viewBox="${vb.join(' ')}"><path class="mun" d="${M.mun}" style="stroke-width:${.5*sc}"/><path class="st" d="${M.st}" style="stroke-width:${1.2*sc}"/>${lbl}${circ}</svg>
   <div class="mapctl"><button class="btn sm ${S.mapZoom==='obras'?'dk':'ghost'}" data-z="obras">Obras</button><button class="btn sm ${S.mapZoom==='pr'?'dk':'ghost'}" data-z="pr">Paraná</button></div>
   ${sem?`<div class="small muted" style="margin-top:6px">${sem} obra(s) sem localização (sem município, coordenada ou foto com GPS).</div>`:''}`;
  $$('[data-z]',el).forEach(b=>b.onclick=()=>{S.mapZoom=b.dataset.z;desenharMapa(el,obras)});
  let tip=null;
  $$('circle.pt',el).forEach(c=>{c.onclick=()=>go('obra-'+c.dataset.o);
    c.onmouseenter=()=>{tip=document.createElement('div');tip.className='maptip';tip.textContent=c.dataset.t;el.appendChild(tip);const r=c.getBoundingClientRect(),q=el.getBoundingClientRect();tip.style.left=(r.left+r.width/2-q.left)+'px';tip.style.top=(r.top-q.top)+'px'};
    c.onmouseleave=()=>{tip&&tip.remove()}});
}
function desenharGrafico(el,obras){
  const N=21;const dias=[];const d0=new Date(hoje()+'T12:00:00');
  for(let i=N-1;i>=0;i--){const d=new Date(d0-i*864e5);dias.push(d.toISOString().slice(0,10))}
  const v=dias.map(d=>obras.reduce((s,o)=>s+(S.idx[o.id].porDia[d]||0),0));
  const mx=Math.max(4,...v);const W=520,H=170,pl=26,pb=22,bw=(W-pl)/N;
  let acc=0;const tot=obras.reduce((s,o)=>s+S.idx[o.id].tot,0);
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}">
   ${[0,.5,1].map(f=>`<line x1="${pl}" x2="${W}" y1="${(H-pb)-(H-pb-8)*f}" y2="${(H-pb)-(H-pb-8)*f}" stroke="#e7eaf0"/><text x="${pl-5}" y="${(H-pb)-(H-pb-8)*f+4}" font-size="10" text-anchor="end" fill="#8b95a5">${Math.round(mx*f)}</text>`).join('')}
   ${v.map((x,i)=>{const h=(H-pb-8)*x/mx;return `<rect x="${pl+i*bw+2}" y="${H-pb-h}" width="${bw-4}" height="${h}" rx="2" fill="${dias[i]===hoje()?'var(--or)':'#1c2738'}"><title>${dBR(dias[i])}: ${x} poste(s)</title></rect>${x?`<text x="${pl+i*bw+bw/2}" y="${H-pb-h-3}" font-size="9.5" text-anchor="middle" fill="#14181f" font-weight="700">${x}</text>`:''}`}).join('')}
   ${dias.map((d,i)=>i%3===0||i===N-1?`<text x="${pl+i*bw+bw/2}" y="${H-6}" font-size="9.5" text-anchor="middle" fill="#8b95a5">${d.slice(8,10)}/${d.slice(5,7)}</text>`:'').join('')}
  </svg><div class="small muted">Últimos ${N} dias · data de execução informada em campo · ${v.reduce((a,b)=>a+b,0)} postes no período${tot?` (de ${tot} empenhados)`:''}</div>`;
}

/* ---------- lista de obras ---------- */
let FILT = { q: '', emp: '', st: 'ativa' };
function vObras(app) {
  const base = obrasVisiveis();
  const emps = [...new Set(base.map(o => o.empreiteira).filter(Boolean))].sort();
  app.innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0 12px 0 0">Obras</h2>
    <input class="i" id="fq" placeholder="Buscar projeto, cliente, município…" value="${esc(FILT.q)}" style="min-width:240px">
    ${filtroDivHtml()}
    <select class="i" id="fe"><option value="">Todas as empreiteiras</option>${emps.map(e => `<option ${FILT.emp === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
    <a class="btn ghost sm" href="#historico" style="text-decoration:none">Ver concluídas (histórico)</a>
    <span style="flex:1"></span>${souGestor() ? `<a class="btn pri" href="#nova" style="text-decoration:none">+ Empenhar obra</a>` : ''}</div><div id="tb"></div></div>`;
  ligarFiltroDiv();
  const draw = () => {
    const q = FILT.q.toLowerCase();
    const L = base.filter(o => (!FILT.emp || o.empreiteira === FILT.emp) && (!FILT.st || (FILT.st === 'ativa' ? (o.status !== 'concluida' && o.status !== 'cancelada') : o.status === FILT.st)) && (!q || [o.projeto, o.pep, o.cliente, o.descricao, o.municipio, o.local, o.aes].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    $('#tb').innerHTML = L.length ? `<div style="overflow:auto"><table><thead><tr><th>Projeto</th><th>Obra / cliente</th>${S.sess.length > 1 ? '<th>Divisão</th>' : ''}<th>Município</th><th>Empreiteira</th><th class="n">US</th><th>Etapa</th><th class="n">Postes</th><th style="width:150px">Avanço</th><th class="n">Medido</th><th>Prazo</th><th>Último registro</th></tr></thead><tbody>${L.map(o => {
      const I = S.idx[o.id]; const d = diasAte(o.prazo);
      return `<tr class="cl" data-o="${esc(o.id)}"><td><b>${esc(o.projeto)}</b>${o.pep ? `<div class="small muted">PEP ${esc(o.pep)}</div>` : ''}</td><td>${esc(o.descricao || '')}<div class="small muted">${esc(o.cliente || '')}</div></td>${S.sess.length > 1 ? `<td>${esc((sessObra(o) || {}).div || '')}</td>` : ''}<td>${esc(o.municipio || '—')}</td><td>${esc(o.empreiteira || '—')}</td><td class="n">${fmt(o.us)}</td><td>${etapaChip(I)}</td><td class="n">${I.exec}/${I.tot}</td>
      <td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div><span class="pct">${fmt1(I.pct * 100)}%</span></div></td><td class="n"><b>${fmt1(I.pctFis * 100)}%</b><div class="small muted">${fmt(I.usMed)} US</div></td>
      <td>${dBR(o.prazo)}${d != null && I.pct < 1 && o.status !== 'concluida' ? (d < 0 ? ` <span class="chip bad">${-d} d atrasada</span>` : d <= 10 ? ` <span class="chip alt">${d} d</span>` : '') : ''}</td><td>${I.ultimo ? dtBR(I.ultimo) : '<span class="muted">—</span>'}</td></tr>`
    }).join('')}</tbody></table></div>`
      : `<div class="empty">${base.length ? 'Nenhuma obra com esses filtros.' : 'Nenhuma obra cadastrada ainda.'}${souGestor() && !base.length ? ' <a href="#nova">Empenhar a primeira obra</a>.' : ''}</div>`;
    $$('[data-o]', app).forEach(el => el.onclick = () => go('obra-' + el.dataset.o));
  };
  $('#fq').oninput = e => { FILT.q = e.target.value; draw() }; $('#fe').onchange = e => { FILT.emp = e.target.value; draw() };
  draw();
}

/* ================= visualizador da planta ================= */
function Viewer(host,{img,imgAlt,iw,ih,getMarkers,onMarker,onPlace,editable,onMove,fitMarkers}){
  host.classList.add('viewer');
  host.innerHTML=`<div class="stage"><img alt="planta"><div class="mks"></div></div><div class="zbtns"><button data-z="+">+</button><button data-z="-">−</button><button data-z="f">⤢</button></div>`;
  const stage=$('.stage',host),im=$('img',stage),mks=$('.mks',stage);
  im.onerror=()=>{if(imgAlt&&im.src!==imgAlt)im.src=imgAlt};im.src=img;im.width=iw;im.height=ih;stage.style.width=iw+'px';stage.style.height=ih+'px';
  let z=1,tx=0,ty=0,minZ=.05;const ptrs=new Map();let pinch=null,drag=null,moved=0,placing=false,mdrag=null;
  const apply=()=>{stage.style.transform=`translate(${tx}px,${ty}px) scale(${z})`;stage.style.setProperty('--inv',1/z)};
  function fit(){const r=host.getBoundingClientRect();if(!r.width)return;let bx=0,by=0,bw=1,bh=1;
    const M=fitMarkers?getMarkers():[];
    if(M.length){let a=Math.min(...M.map(m=>m.x)),b=Math.max(...M.map(m=>m.x)),c=Math.min(...M.map(m=>m.y)),d=Math.max(...M.map(m=>m.y));
      const cx=(a+b)/2,cy=(c+d)/2;bw=Math.max((b-a)*1.3,.22);bh=Math.max((d-c)*1.3,.22*iw/ih);bx=cx-bw/2;by=cy-bh/2}
    const zf=Math.min(r.width/iw,r.height/ih);z=Math.min(r.width/(bw*iw),r.height/(bh*ih))*.96;z=Math.max(z,zf*.98);minZ=zf*.6;
    tx=r.width/2-(bx+bw/2)*iw*z;ty=r.height/2-(by+bh/2)*ih*z;apply()}
  function zoomAt(f,cx,cy){const nz=Math.max(minZ,Math.min(z*f,8));tx=cx-(cx-tx)*nz/z;ty=cy-(cy-ty)*nz/z;z=nz;apply()}
  function focus(x,y,zz){const r=host.getBoundingClientRect();z=Math.max(z,zz||z);tx=r.width/2-x*iw*z;ty=r.height/2-y*ih*z;apply()}
  const toImg=(cx,cy)=>{const r=host.getBoundingClientRect();return {x:((cx-r.left)-tx)/z/iw,y:((cy-r.top)-ty)/z/ih}};
  function draw(){
    mks.innerHTML='';
    for(const m of getMarkers()){
      const d=document.createElement('div');d.className='mk '+(m.cls||'');d.textContent=m.label;d.style.left=(m.x*iw)+'px';d.style.top=(m.y*ih)+'px';d.dataset.k=m.key;
      d.addEventListener('pointerdown',e=>{ e.stopPropagation(); if(editable){mdrag={k:m.key,el:d,sx:e.clientX,sy:e.clientY,mv:0};d.setPointerCapture(e.pointerId)} });
      d.addEventListener('pointermove',e=>{ if(mdrag&&mdrag.el===d){mdrag.mv+=Math.abs(e.movementX)+Math.abs(e.movementY);if(mdrag.mv>4){const p=toImg(e.clientX,e.clientY);d.style.left=(p.x*iw)+'px';d.style.top=(p.y*ih)+'px';mdrag.p=p}} });
      d.addEventListener('pointerup',e=>{ if(mdrag&&mdrag.el===d){const md=mdrag;mdrag=null;if(md.mv>4&&md.p){onMove&&onMove(md.k,md.p)}else onMarker&&onMarker(m.key)} });
      d.addEventListener('click',e=>{ e.stopPropagation(); if(!editable) onMarker&&onMarker(m.key) });
      mks.appendChild(d);
    }
  }
  host.addEventListener('pointerdown',e=>{if(e.target.closest('.zbtns')||e.target.closest('.mk'))return;host.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=0;
    if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),z,tx,ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2}}else drag={x:e.clientX,y:e.clientY,tx,ty}});
  host.addEventListener('pointermove',e=>{if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});const r=host.getBoundingClientRect();
    if(ptrs.size===2&&pinch){const [a,b]=[...ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);const nz=Math.max(minZ,Math.min(pinch.z*d/pinch.d,8));const cx=pinch.cx-r.left,cy=pinch.cy-r.top;tx=cx-(cx-pinch.tx)*nz/pinch.z;ty=cy-(cy-pinch.ty)*nz/pinch.z;z=nz;moved=99;apply()}
    else if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved=Math.max(moved,Math.abs(dx)+Math.abs(dy));tx=drag.tx+dx;ty=drag.ty+dy;apply()}});
  const up=e=>{const was=ptrs.has(e.pointerId);ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;if(ptrs.size===0){
      if(was&&drag&&moved<6&&placing&&onPlace){const p=toImg(e.clientX,e.clientY);if(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)onPlace(p)}
      drag=null}else{const v=[...ptrs.values()][0];drag={x:v.x,y:v.y,tx,ty}}};
  host.addEventListener('pointerup',up);host.addEventListener('pointercancel',up);
  host.addEventListener('wheel',e=>{e.preventDefault();const r=host.getBoundingClientRect();zoomAt(e.deltaY<0?1.15:1/1.15,e.clientX-r.left,e.clientY-r.top)},{passive:false});
  $$('.zbtns button',host).forEach(b=>b.onclick=e=>{e.stopPropagation();const r=host.getBoundingClientRect();if(b.dataset.z==='f')fit();else zoomAt(b.dataset.z==='+'?1.4:1/1.4,r.width/2,r.height/2)});
  const ro=new ResizeObserver(()=>{if(!host._fitted){fit();host._fitted=1}});ro.observe(host);
  im.onload=()=>{fit()};
  draw();
  return {refresh:draw,fit,focus,setPlacing(v,hint){placing=v;host.classList.toggle('placing',v);$('.hint',host)?.remove();if(v&&hint){const h=document.createElement('div');h.className='hint';h.textContent=hint;host.appendChild(h)}},get placing(){return placing}};
}
function estHtml(p) {
  const e = p.estruturas || []; if (!e.length) return '';
  const ins = e.filter(x => !x.r), ret = e.filter(x => x.r);
  return `<div class="est">${ins.length ? `<div><span class="lbl ok">Instalar</span>${ins.map(x => `<span class="tag">${esc(x.t)}</span>`).join('')}</div>` : ''}${ret.length ? `<div><span class="lbl bad">Retirar</span>${ret.map(x => `<span class="tag r">${esc(x.t)}</span>`).join('')}</div>` : ''}</div>`;
}
function markersObra(o, sel, f) {
  const L = (o.postes || []).filter(p => f == null || (p.f || 0) === f).map(p => ({ key: 'P' + p.n, label: String(p.n), x: p.x, y: p.y, cls: statusPoste(o, 'P' + p.n) + (p.acao === 'retirar' ? ' ret' : '') + (sel === 'P' + p.n ? ' sel' : '') }));
  const I = S.idx[o.id]; (I ? I.novos : []).forEach((n, i) => (f == null || (n.f || 0) === f) && L.push({ key: n.key, label: '+' + (i + 1), x: n.x, y: n.y, cls: statusPoste(o, n.key) + (sel === n.key ? ' sel' : '') }));
  return L;
}
function rotuloPoste(o, key) { if (key && key.startsWith('P')) return 'Poste ' + key.slice(1); const I = S.idx[o.id]; const i = I.novos.findIndex(n => n.key === key); return 'Poste não previsto +' + (i + 1) }
function plantaSrc(o) { return { src: driveImg(o.planta.id, Math.max(o.planta.w, o.planta.h)), alt: driveImg2(o.planta.id, Math.max(o.planta.w, o.planta.h)) } }

/* ---------- planta com várias folhas ---------- */
let FOLHA = 0;
function folhaDe(o, key) {
  if (!key) return FOLHA;
  if (key.startsWith('P')) { const p = (o.postes || []).find(p => 'P' + p.n === key); return p ? (p.f || 0) : 0 }
  const I = S.idx[o.id]; const n = I && I.novos.find(n => n.key === key); return n ? (n.f || 0) : 0;
}
/** Abas "Folha 1 · Folha 2" por cima da planta. */
function abasFolhas(host, n, atual, rot, onPick) {
  if (n < 2) return;
  const t = document.createElement('div'); t.className = 'ftabs';
  t.innerHTML = Array.from({ length: n }, (_, i) => `<button data-f="${i}" class="${i === atual ? 'on' : ''}">${esc(rot(i))}</button>`).join('');
  t.addEventListener('pointerdown', e => e.stopPropagation());
  $$('button', t).forEach(b => b.onclick = e => { e.stopPropagation(); onPick(+b.dataset.f) });
  host.appendChild(t);
}
/** Recria o visualizador num elemento novo (evita eventos duplicados ao trocar de folha). */
function hostLimpo(sel) { const old = $(sel); const nw = document.createElement('div'); nw.id = old.id; if (old.dataset.h) { nw.dataset.h = old.dataset.h; nw.style.height = old.dataset.h } old.replaceWith(nw); return nw }
function montarPlanta(o, opts) {
  if (FOLHA >= o.folhas.length) FOLHA = 0;
  const fo = o.folhas[FOLHA], W = Math.max(fo.w, fo.h);
  const host = hostLimpo('#vw');
  const v = Viewer(host, { img: driveImg(fo.id, W), imgAlt: driveImg2(fo.id, W), iw: fo.w, ih: fo.h, fitMarkers: true, getMarkers: () => { const L = markersObra(o, opts.getSel ? opts.getSel() : null, FOLHA); return opts.decorar ? opts.decorar(L) : L }, onMarker: opts.onMarker, onPlace: opts.onPlace });
  v.obraId = o.id;
  abasFolhas(host, o.folhas.length, FOLHA, i => `Folha ${i + 1} · ${markersObra(o, null, i).length}`, i => { FOLHA = i; VIEWER = montarPlanta(o, opts) });
  return v;
}
/** Leva a planta até o poste (troca de folha se precisar). */
function irParaPoste(o, key, opts) {
  const f = folhaDe(o, key);
  if (f !== FOLHA) { FOLHA = f; VIEWER = montarPlanta(o, opts) }
  const m = markersObra(o, null, FOLHA).find(m => m.key === key); m && VIEWER.focus(m.x, m.y); VIEWER.refresh();
}

/* ---------- detalhe da obra (gestão) ---------- */
let SEL = null;
const OPTS_OBRA = { getSel: () => SEL, onMarker: k => { SEL = k; VIEWER.refresh(); renderObraSide() } };
function vObra(app) {
  const o = getObra(S.obraId); const hist = S.view === 'hobra';
  if (!o) { app.innerHTML = `<div class="card empty">Obra não encontrada. <a href="#obras">Voltar</a></div>`; return }
  SEL = null;
  app.innerHTML = `<div class="toolbar"><a href="#${hist ? 'historico' : 'obras'}" class="btn ghost sm" style="text-decoration:none">← ${hist ? 'Histórico' : 'Obras'}</a><h2 style="margin:0">Projeto ${esc(o.projeto)}</h2>${hist ? `<span class="chip ok">concluída ${dBR((o.concluidaEm || '').slice(0, 10))}</span>` : ''}<span class="muted">${esc(o.descricao || '')}</span><span style="flex:1"></span>
    <div class="legend"><span style="--c:var(--pend)">a executar</span><span style="--c:var(--ok)">conforme</span><span style="--c:var(--alt)">com alteração</span><span style="--c:var(--bad)">não executado</span><span style="--c:var(--novo)">não previsto</span><span class="small">✓ = aprovado pelo fiscal</span><span class="small">▢ quadrado = retirar</span></div></div>
   <div class="det"><div id="vw"></div><div class="grid" id="side"></div></div>`;
  FOLHA = 0;
  VIEWER = montarPlanta(o, OPTS_OBRA);
  renderObraSide();
}
function renderObraSide() {
  const o = getObra(S.obraId); if (!o) return; const I = S.idx[o.id]; const side = $('#side'); if (!side) return; const hist = S.view === 'hobra';
  const regs = [...I.regs].filter(r => !SEL || (r.tipo === 'novo' ? 'N:' + r.id : r.poste) === SEL).reverse();
  const d = diasAte(o.prazo);
  side.innerHTML = `
   <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">Avanço</h3><b class="pct" style="font-size:22px;color:var(--or)">${fmt1(I.pct * 100)}%</b></div>
    <div class="bar" style="height:12px;margin:8px 0"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>
    <div class="small">${I.exec} de ${I.tot} postes · ${I.ok} conforme · ${I.alt} com alteração · ${I.bad} não executado(s)${I.novos.length ? ` · ${I.novos.length} não previsto(s)` : ''}</div>
    <div class="small muted" style="margin-top:4px">US executadas: ${fmt(I.usExec)} de ${fmt(o.us)} (proporção de postes)</div>
    ${hist ? '' : `<div style="margin-top:10px">${etapaChip(I)}</div>`}
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:12px"><h3 style="margin:0">Fiscalização</h3><b class="pct" style="font-size:18px;color:var(--ok)">${fmt1(I.pctFis * 100)}%</b></div>
    <div class="bar" style="height:8px;margin:6px 0"><i class="b-ok" style="width:${I.pctFis * 100}%"></i><i class="b-bad" style="width:${I.rep / (I.tot || 1) * 100}%"></i></div>
    <div class="small">${I.fis} de ${I.tot} postes aprovados (medidos)${I.rep ? ` · <b style="color:var(--bad)">${I.rep} reprovado(s)</b>` : ''} · US medidas: ${fmt(I.usMed)}</div>
    ${!hist && podeFiscalizar(o) && aFiscalizar(o).length ? `<button class="btn sm" id="flote" style="margin-top:10px;background:var(--ok);color:#fff">✔️ Aprovar todos os executados (${aFiscalizar(o).length})</button><div class="small muted" style="margin-top:4px">Ou clique num poste da planta para aprovar ou reprovar um por um.</div>` : ''}
    ${hist && o.encerramento ? `<div class="small muted" style="margin-top:6px">Encerramento: ${esc(o.encerramento)}</div>` : ''}</div>
   <div class="card"><h3>Dados do empenho</h3><div class="kv">
    ${S.sess.length > 1 ? `<b>Divisão</b><span>${esc((sessObra(o) || {}).div || '')}</span>` : ''}
    <b>PEP</b><span>${esc(o.pep || '—')}</span><b>Empreiteira</b><span>${esc(o.empreiteira || '—')}</span><b>AES</b><span>${esc(o.aes || '—')}</span><b>US</b><span>${fmt(o.us)}</span>
    <b>Empenho</b><span>${dBR(o.empenhoEm)}</span><b>Prazo</b><span>${dBR(o.prazo)}${d != null && I.pct < 1 ? ` <span class="chip ${d < 0 ? 'bad' : d <= 10 ? 'alt' : ''}">${d < 0 ? -d + ' d atrasada' : d + ' d'}</span>` : ''}</span>
    <b>Cliente</b><span>${esc(o.cliente || '—')}</span><b>Local</b><span>${esc(o.local || '—')}</span><b>Município</b><span>${esc(o.municipio || '—')}</span>
    <b>OSE</b><span>${esc(o.ose || '—')}</span><b>Projetista</b><span>${esc(o.projetista || '—')}</span><b>Status</b><span>${o.status === 'concluida' ? '<span class="chip ok">concluída</span>' : '<span class="chip or">em andamento</span>'}</span>
   </div>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${o.pdf ? `<a class="btn sm ghost" href="${esc(driveVer(o.pdf.id))}" target="_blank" rel="noopener" style="text-decoration:none">Abrir PDF do projeto</a>` : ''}
    ${podeEditarObra(o) ? (hist ? `<button class="btn sm dk" id="reab">Reabrir obra</button>` : `<button class="btn sm ghost" id="edob">Editar dados</button><button class="btn sm ghost" id="addf">+ Adicionar folha</button><button class="btn sm dk" id="conc">Encerrar obra (manual)</button>`) : ''}</div></div>
   <div class="card" ${SEL ? 'style="order:-1"' : ''}><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${SEL ? esc(rotuloPoste(o, SEL)) : 'Registros de campo'}</h3>${SEL ? `<button class="btn sm ghost" id="clr">Ver todos</button>` : ''}</div>
   ${SEL && SEL.startsWith('P') ? (() => { const p = o.postes.find(p => 'P' + p.n === SEL); return p && (p.estruturas || []).length ? `<div style="margin:8px 0">${estHtml(p)}</div>` : p && p.nota ? `<div class="small muted" style="margin:6px 0">Previsto: ${esc(p.nota)}</div>` : '' })() : ''}
   ${fiscalWebHtml(o)}
   <div class="feed" style="margin-top:8px">${regs.length ? regs.map(r => regHtml(o, r)).join('') : `<div class="muted small">${SEL ? 'Nenhum registro para este poste.' : 'Nenhum registro em campo ainda.'}</div>`}</div></div>`;
  $('#clr') && ($('#clr').onclick = () => { SEL = null; VIEWER.refresh(); renderObraSide() });
  $('#edob') && ($('#edob').onclick = () => editarObra(o));
  $('#conc') && ($('#conc').onclick = async e => {
    const b = e.currentTarget;
    if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar: encerrar e mover para o Histórico'; b.style.background = 'var(--bad)'; return }
    b.disabled = true; b.textContent = 'Concluindo…';
    try { await api(sessObra(o), 'concluir', { id: o.id }); toast('Obra encerrada e movida para o Histórico'); await sincronizar(); go('historico') } catch (err) { b.disabled = false; b.textContent = 'Encerrar obra (manual)'; delete b.dataset.conf; toast('Não foi possível concluir: ' + err.message, 1) }
  });
  $('#reab') && ($('#reab').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Reabrindo…';
    try { await api(sessObra(o), 'reabrir', { id: o.id }); toast('Obra reaberta'); S.hist = null; await sincronizar(); go('obra-' + o.id) } catch (err) { b.disabled = false; b.textContent = 'Reabrir obra'; toast('Não foi possível reabrir: ' + err.message, 1) }
  });
  $$('.reg img', side).forEach(im => { imgFallback(im); im.onclick = () => lightbox(im.dataset.full, im.dataset.id) });
  $$('[data-inv]', side).forEach(b => b.onclick = async () => {
    const r = S.regs.find(x => x.id === b.dataset.inv); if (!r) return; b.disabled = true;
    try { await api(sessObra(o), 'invalidar', { id: r.id, invalido: !r.invalido }); toast(r.invalido ? 'Registro restaurado' : 'Registro desconsiderado'); sincronizar() } catch (e) { b.disabled = false; toast('Não foi possível salvar: ' + e.message, 1) }
  });
  $$('[data-pk]', side).forEach(el => el.onclick = () => { SEL = el.dataset.pk; irParaPoste(o, SEL, OPTS_OBRA); renderObraSide() });
  ligarFiscalWeb(o, side);
  { const c = document.createElement('div'); c.className = 'card'; c.id = 'docsobra'; side.insertBefore(c, side.children[1] || null); cardDocsObra(o) }
  $('#addf') && ($('#addf').onclick = () => escolherPdf(f => processarPdf(f, o)));
}
function regHtml(o, r) {
  const key = r.tipo === 'novo' ? 'N:' + r.id : r.poste;
  const gm = r.gps && r.gps.lat != null ? `<a href="https://www.google.com/maps?q=${r.gps.lat},${r.gps.lon}" target="_blank" rel="noopener">GPS${r.gps.origem === 'foto' ? ' (foto)' : ''}</a>` : '<span title="Sem localização">sem GPS</span>';
  const img = r.foto ? (r.foto.local ? `<img src="${esc(r.foto.local)}" data-full="${esc(r.foto.local)}">` : `<img src="${esc(driveImg(r.foto.id, 200))}" data-id="${esc(r.foto.id)}" data-w="200" data-full="${esc(driveImg(r.foto.id, 1600))}" loading="lazy">`) : `<div class="nf">sem foto</div>`;
  return `<div class="reg ${r.invalido ? 'inv' : ''}">${img}
   <div style="flex:1;min-width:0"><div><b data-pk="${esc(key)}" style="cursor:pointer">${esc(rotuloPoste(o, key))}</b> <span class="chip ${TIPO_CH[r.tipo] || ''}">${esc(tipoTx(o, r))}</span>${r.invalido ? ' <span class="chip">desconsiderado</span>' : ''}${r.pendente ? ' <span class="chip">aguardando envio</span>' : ''}</div>
   ${r.alt && r.alt.length ? `<div class="small" style="margin-top:3px">${esc(r.alt.join(' · '))}</div>` : ''}
   ${r.obs ? `<div class="small" style="margin-top:3px">“${esc(r.obs)}”</div>` : ''}
   <div class="small muted" style="margin-top:3px">Execução ${dBR(r.dataExec)} · ${esc(r.equipe || '')}${r.empresa ? ' (' + esc(r.empresa) + ')' : ''} · lançado ${dtBR(r.em)} · ${gm}</div>
   ${podeInvalidar(o) && !r.pendente && S.view !== 'hobra' ? `<button class="btn sm ghost" style="margin-top:6px" data-inv="${esc(r.id)}">${r.invalido ? 'Restaurar' : 'Desconsiderar'}</button>` : ''}</div></div>`;
}
function lightbox(src, id) {
  openLayer(`<div class="ov" id="lb"><img class="big" src="${esc(src)}" ${id ? `data-id="${esc(id)}" data-w="1600"` : ''}></div>`);
  const im = $('#lb img'); imgFallback(im); $('#lb').onclick = closeLayer;
}
function openLayer(h) { $('#layer').innerHTML = h }
function closeLayer() { $('#layer').innerHTML = '' }


/* lista de empreiteiras: vem da aba "chaves" da divisão; sem ela, campo de texto */
function empCampoHtml(pref, atual, emps) {
  const lista = S.emps[pref];
  if (!Array.isArray(lista)) return `<input class="i" name="empreiteira" list="dlemp" value="${esc(atual || '')}" placeholder="Igual ao nome da empresa na aba chaves"><datalist id="dlemp">${(emps || []).map(e => `<option value="${esc(e)}">`).join('')}</datalist>`;
  const ops = [...lista]; if (atual && !ops.includes(atual)) ops.unshift(atual);
  if (!ops.length) return `<select class="i" name="empreiteira" disabled><option value="">Nenhuma empreiteira cadastrada</option></select><div class="small muted" style="margin-top:4px">Cadastre na aba <b>chaves</b> da planilha (papel = empreiteira) e sincronize.</div>`;
  return `<select class="i" name="empreiteira"><option value="">Selecione…</option>${ops.map(e => `<option ${e === atual ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>`;
}
function ligarTrocaDivisao(root) {
  const sel = $('[name=pref]', root); if (!sel) return;
  sel.onchange = () => { const box = $('#empbox', root); if (box) box.innerHTML = empCampoHtml(sel.value, '', []) };
}
function formCampos(o, emps, divs) {
  return `${divs && divs.length > 1 ? `<label class="f">Divisão</label><select class="i" name="pref">${divs.map(s => `<option value="${esc(s.pref)}" ${o.pref === s.pref ? 'selected' : ''}>${esc(s.div)}</option>`).join('')}</select>` : ''}
   <div class="row2"><div><label class="f">Projeto</label><input class="i" name="projeto" value="${esc(o.projeto || '')}"></div><div><label class="f">OSE</label><input class="i" name="ose" value="${esc(o.ose || '')}"></div></div>
   <label class="f">Obra</label><input class="i" name="descricao" value="${esc(o.descricao || '')}">
   <label class="f">Cliente</label><input class="i" name="cliente" value="${esc(o.cliente || '')}">
   <label class="f">Local</label><input class="i" name="local" value="${esc(o.local || '')}">
   <div class="row2"><div><label class="f">Município</label><input class="i" name="municipio" list="dlmun" value="${esc(o.municipio || '')}"></div><div><label class="f">Projetista</label><input class="i" name="projetista" value="${esc(o.projetista || '')}"></div></div>
   <datalist id="dlmun">${PRMAP.c.map(c => `<option value="${esc(c[0])}">`).join('')}</datalist>
   <div style="border-top:1px solid var(--ln);margin:14px 0 2px"></div>
   <label class="f">Empreiteira *</label><div id="empbox">${empCampoHtml(o.pref || (divs && divs[0] && divs[0].pref), o.empreiteira, emps)}</div>
   <label class="f">PEP</label><input class="i" name="pep" value="${esc(o.pep || '')}" placeholder="Elemento PEP do projeto no SAP" autocapitalize="characters">
   <div class="row2"><div><label class="f">AES</label><input class="i" name="aes" value="${esc(o.aes || '')}"></div><div><label class="f">US *</label><input class="i" name="us" type="number" min="0" step="any" value="${o.us ?? ''}"></div></div>
   <div class="row2"><div><label class="f">Data do empenho</label><input class="i" name="empenhoEm" type="date" value="${esc(o.empenhoEm || hoje())}"></div><div><label class="f">Prazo de execução</label><input class="i" name="prazo" type="date" value="${esc(o.prazo || '')}"></div></div>`;
}
function lerForm(root){const v={};$$('[name]',root).forEach(i=>{v[i.name]=i.type==='number'?(i.value===''?null:Number(i.value)):i.value.trim()});return v}
function editarObra(o) {
  const emps = [...new Set(S.obras.map(x => x.empreiteira).filter(Boolean))];
  openLayer(`<div class="ov"><div class="box" style="max-width:560px"><h2>Editar dados · ${esc(o.projeto)}</h2><div id="ef">${formCampos(o, emps)}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="x">Cancelar</button><button class="btn pri" id="ok">Salvar</button></div></div></div>`);
  $('#x').onclick = closeLayer;
  $('#ok').onclick = async () => {
    const v = lerForm($('#ef')); delete v.projeto;
    if (v.municipio && v.municipio !== o.municipio && o.locOrigem !== 'utm') { const c = PRMAP.c.find(z => z[0] === v.municipio); if (c) { v.lat = c[1]; v.lon = c[2]; v.locOrigem = 'municipio' } }
    try { $('#ok').disabled = true; await api(sessObra(o), 'atualizarObra', { id: o.id, campos: v }); closeLayer(); toast('Dados salvos'); sincronizar() } catch (e) { $('#ok').disabled = false; toast('Não foi possível salvar: ' + e.message, 1) }
  };
}

/* ================= histórico (obras concluídas) ================= */
async function vHistorico(app) {
  app.innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0 12px 0 0">Histórico · obras encerradas</h2>
    <input class="i" id="hq" placeholder="Buscar projeto, cliente, município…" style="min-width:240px">${filtroDivHtml()}</div><div id="htb"><div class="empty">Carregando…</div></div></div>`;
  ligarFiltroDiv();
  const L = []; let erro = '';
  for (const s of S.sess) {
    if (S.divFiltro && s.pref !== S.divFiltro) continue;
    try { const j = await api(s, 'historico'); (j.obras || []).forEach(o => L.push(Object.assign({}, o, { pref: s.pref }))) }
    catch (e) { erro = e.rede ? 'Sem conexão: o histórico precisa de internet.' : e.message }
  }
  if (S.view !== 'historico') return;
  S.histLista = L;
  const draw = () => {
    const q = ($('#hq').value || '').toLowerCase();
    const V = L.filter(o => !q || [o.projeto, o.pep, o.cliente, o.descricao, o.municipio, o.empreiteira, o.aes].join(' ').toLowerCase().includes(q)).sort((a, b) => String(b.concluidaEm).localeCompare(String(a.concluidaEm)));
    $('#htb').innerHTML = erro && !L.length ? `<div class="empty">${esc(erro)}</div>` : V.length ? `<div style="overflow:auto"><table><thead><tr><th>Projeto</th><th>Obra / cliente</th>${S.sess.length > 1 ? '<th>Divisão</th>' : ''}<th>Município</th><th>Empreiteira</th><th class="n">US</th><th class="n">US exec.</th><th class="n">US medidas</th><th class="n">Postes</th><th class="n">Alter.</th><th>Encerramento</th></tr></thead><tbody>${V.map(o => {
      const r = o.resumo || {}; return `<tr class="cl" data-h="${esc(o.id)}"><td><b>${esc(o.projeto)}</b>${o.pep ? `<div class="small muted">PEP ${esc(o.pep)}</div>` : ''}</td><td>${esc(o.descricao || '')}<div class="small muted">${esc(o.cliente || '')}</div></td>${S.sess.length > 1 ? `<td>${esc((sessDe(o.pref) || {}).div || '')}</td>` : ''}<td>${esc(o.municipio || '—')}</td><td>${esc(o.empreiteira || '—')}</td><td class="n">${fmt(o.us)}</td><td class="n">${fmt(r.usExec)}</td><td class="n">${fmt(r.usMedida)}</td><td class="n">${r.exec ?? '—'}/${r.tot ?? '—'}</td><td class="n">${r.alt ?? '—'}</td><td>${dBR(String(o.concluidaEm || '').slice(0, 10))}<div class="small muted">${esc(String(o.encerramento || '').split(' · ')[0])}</div></td></tr>`
    }).join('')}</tbody></table></div>` : `<div class="empty">Nenhuma obra encerrada${q ? ' com essa busca' : ' ainda'}.</div>`;
    $$('[data-h]', app).forEach(el => el.onclick = () => go('hist-' + el.dataset.h));
  };
  $('#hq').oninput = draw; draw();
}
async function vHObra(app) {
  app.innerHTML = `<div class="empty">Carregando obra do histórico…</div>`;
  const id = S.obraId; const item = (S.histLista || []).find(x => x.id === id);
  const lista = item && sessDe(item.pref) ? [sessDe(item.pref)] : S.sess;
  let got = null, erro = '';
  for (const s of lista) { try { const j = await api(s, 'obraHistorico', { id }); got = { pref: s.pref, j }; break } catch (e) { erro = e.rede ? 'Sem conexão: o histórico precisa de internet.' : e.message } }
  if (S.view !== 'hobra' || S.obraId !== id) return;
  if (!got) { app.innerHTML = `<div class="card empty">${esc(erro || 'Obra não encontrada no histórico.')} <a href="#historico">Voltar</a></div>`; return }
  const n = normalizar(got.pref, { obras: [got.j.obra], registros: got.j.registros });
  S.hist = { obra: n.obras[0], regs: n.regs }; reindex(); vObra(app);
}

/* ================= empenhar obra ================= */
let NOVA = null;
const fmtUs = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/* ================= AES: autorização para execução (vários projetos por empreiteira) ================= */
const numBR = t => { if (t == null || t === '') return null; const v = Number(String(t).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : null };
const dataISO = t => { const m = String(t || '').match(/(\d{2})[./](\d{2})[./](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' };
const normEmp = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\b(ltda|me|epp|eireli|s ?a|cia|engenharia|construcoes|construtora|servicos|eletricos?|comercio)\b/g, ' ').replace(/\s+/g, ' ').trim();
function casarEmpreiteira(nomeAes, lista) {
  const a = normEmp(nomeAes); if (!a) return '';
  return (lista || []).find(e => normEmp(e) === a) || (lista || []).find(e => { const b = normEmp(e); return b && (a.includes(b) || b.includes(a)) }) || '';
}
/** Lê o PDF da AES (gerado pelo SAP): cabeçalho e itens (projeto, PEP, US, prazo, custo). */
async function lerAes(file) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const linhas = [];
  for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
    const pg = await doc.getPage(i); const tc = await pg.getTextContent();
    const its = tc.items.filter(t => t.str.trim()).map(t => ({ s: t.str, x: t.transform[4], y: Math.round(t.transform[5]), w: t.width }));
    const grupos = [];
    its.sort((a, b) => b.y - a.y || a.x - b.x).forEach(t => { const g = grupos.find(g => Math.abs(g.y - t.y) <= 2); g ? g.its.push(t) : grupos.push({ y: t.y, its: [t] }) });
    grupos.forEach(g => { g.its.sort((a, b) => a.x - b.x); let txt = '', fim = null; g.its.forEach(t => { if (fim != null) txt += t.x - fim > 8 ? '   ' : (t.x - fim > 1.5 ? ' ' : ''); txt += t.s; fim = t.x + t.w }); linhas.push(txt.replace(/\s+$/, '')) });
  }
  const tudo = linhas.join('\n');
  if (!/AES|AUTORIZA/i.test(tudo)) throw new Error('este PDF não parece uma AES');
  const A = { itens: [] };
  const mN = tudo.match(/\b(\d{5,7})\s+(\d{2}\.\d{2}\.\d{4})\b/); if (mN) { A.numero = mN[1]; A.data = dataISO(mN[2]) }
  const idx = (re) => linhas.findIndex(l => re.test(l));
  let k = idx(/ÓRGÃO EMITENTE|ORGAO EMITENTE/i); if (k >= 0 && linhas[k + 1]) A.orgao = linhas[k + 1].trim();
  k = idx(/^\s*EMPREITEIRO\b.*CIDADE/i); if (k >= 0 && linhas[k + 1]) A.empreiteiraAes = linhas[k + 1].split(/\s{3,}/)[0].trim();
  const cnpjs = (tudo.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) || []).filter(c => c !== '04.368.898/0001-06'); A.cnpj = cnpjs[0] || '';
  k = idx(/^\s*CONTRATO\b.*TIPO CONTRATO/i); if (k >= 0) { const m = (linhas[k + 1] || '').match(/\b(\d{8,12})\b/); if (m) A.contrato = m[1] }
  linhas.forEach(l => {
    const m = l.match(/^\s*(\d{1,3})\s+(\S+)\s+([A-Z]-\d{2}-\d{5,})(?:\s+([A-Z]-\d{2}-\d{5,}))?\s+(.*?)\s*(\d{2}\/\d{2}\/\d{4})\s+([\d.,]+)\s+R\$\s*([\d.,]+)\s+(\d{5,9})\s*$/);
    if (m) A.itens.push({ item: m[1], progOrc: m[2], pep: m[3], pepOdd: m[4] || '', tipoObra: m[5].replace(/\s{2,}/g, ' ').trim(), prazo: dataISO(m[6]), us: numBR(m[7]), custo: numBR(m[8]), projeto: m[9] });
  });
  const mt = tudo.match(/TOTAL:\s*([\d.,]+)\s+R\$\s*([\d.,]+)/); if (mt) { A.totalUs = numBR(mt[1]); A.totalCusto = numBR(mt[2]) }
  if (!A.numero || !A.itens.length) throw new Error('não encontrei o número da AES ou os itens (projetos)');
  return A;
}
const aesPendentes = pref => ((S.raw[pref] || {}).aes || []);
function aesDoProjeto(proj, pref) {
  const p = String(proj || '').replace(/\D/g, ''); if (p.length < 5) return null;
  for (const s of S.sess.filter(s => s.papel === 'gestor' && (!pref || s.pref === pref))) { const a = aesPendentes(s.pref).find(x => String(x.projeto).replace(/\D/g, '') === p); if (a) return Object.assign({ pref: s.pref }, a) }
  return null;
}
async function processarAes(file) {
  const prog = $('#prog'); prog.textContent = 'Lendo a AES…';
  let A; try { A = await lerAes(file) } catch (e) { console.error(e); prog.textContent = 'Não consegui ler a AES: ' + (e.message || e); return }
  prog.textContent = '';
  const divs = S.sess.filter(s => s.papel === 'gestor'); let pref = (S.divFiltro && divs.some(s => s.pref === S.divFiltro)) ? S.divFiltro : divs[0].pref;
  const empSel = () => { const lista = S.emps[pref] || []; const casa = casarEmpreiteira(A.empreiteiraAes, lista); return `<select class="i" id="aemp"><option value="">Selecione…</option>${lista.map(e => `<option ${e === casa ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>${casa ? '' : `<div class="small" style="color:var(--bad);margin-top:4px">Não achei “${esc(A.empreiteiraAes || '?')}” na aba chaves. Escolha a empresa correspondente ou cadastre um código para ela.</div>`}` };
  const ja = aesPendentes(pref).filter(x => x.aes === A.numero).length;
  openLayer(`<div class="ov"><div class="box" style="max-width:820px"><h2>AES ${esc(A.numero)} · ${esc(A.empreiteiraAes || '')}</h2>
    <div class="small muted">Emitida em ${A.data ? dBR(A.data) : '—'} · ${esc(A.orgao || '')} · contrato ${esc(A.contrato || '—')} · CNPJ ${esc(A.cnpj || '—')}</div>
    ${divs.length > 1 ? `<label class="f">Divisão</label><select class="i" id="adiv">${divs.map(s => `<option value="${esc(s.pref)}" ${s.pref === pref ? 'selected' : ''}>${esc(s.div)}</option>`).join('')}</select>` : ''}
    <label class="f">Empreiteira no app</label><div id="aempbox">${empSel()}</div>
    <div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Item</th><th>Projeto</th><th>PEP</th><th>Tipo</th><th>Prazo</th><th style="text-align:right">US</th><th style="text-align:right">Custo</th></tr></thead><tbody>
    ${A.itens.map(it => `<tr><td>${esc(it.item)}</td><td><b>${esc(it.projeto)}</b></td><td>${esc(it.pep)}${it.pepOdd ? `<div class="small muted">${esc(it.pepOdd)}</div>` : ''}</td><td class="small">${esc(it.tipoObra)}</td><td>${it.prazo ? dBR(it.prazo) : '—'}</td><td style="text-align:right">${fmtUs(it.us)}</td><td style="text-align:right">${it.custo != null ? 'R$ ' + it.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}</td></tr>`).join('')}
    </tbody>${A.totalUs != null ? `<tfoot><tr><td colspan="5"><b>Total</b></td><td style="text-align:right"><b>${fmtUs(A.totalUs)}</b></td><td style="text-align:right"><b>R$ ${(A.totalCusto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b></td></tr></tfoot>` : ''}</table></div>
    ${ja ? `<div class="note" style="margin-top:10px">Esta AES já foi registrada. Registrar de novo atualiza os itens (sem duplicar).</div>` : ''}
    <label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13.5px"><input type="checkbox" id="aass" checked style="width:20px;height:20px"> Enviar a AES para a empreiteira assinar no app</label>
    <div class="note ok-note" style="margin-top:10px">Depois de registrar, suba os PDFs dos projetos: o app reconhece cada um pelo número e já preenche empreiteira, AES, PEP, US e prazo.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="ax">Cancelar</button><button class="btn pri" id="aok">Registrar AES (${A.itens.length} projeto${A.itens.length > 1 ? 's' : ''})</button></div></div></div>`);
  $('#adiv') && ($('#adiv').onchange = e => { pref = e.target.value; $('#aempbox').innerHTML = empSel() });
  $('#ax').onclick = closeLayer;
  $('#aok').onclick = async e => {
    const emp = $('#aemp').value; if (!emp) return toast('Escolha a empreiteira', 1);
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Registrando…';
    try {
      const j = await api(sessDe(pref), 'registrarAes', { aes: Object.assign({}, A, { empreiteira: emp }), assinar: $('#aass').checked, pdf: file.size < 15e6 ? { b64: await blobB64(file) } : null });
      closeLayer(); toast(`AES ${A.numero} registrada: ${j.novos} novo(s)${j.atualizados ? ', ' + j.atualizados + ' atualizado(s)' : ''}${j.vinculados ? ', ' + j.vinculados + ' ligado(s) a obras já empenhadas' : ''}${j.docAes ? ' · enviada para a empreiteira assinar' : ''}`);
      await sincronizar(); if (S.view === 'nova') vNova($('#app'));
    } catch (err) { toast(msgServidor(err), 1); b.disabled = false; b.textContent = 'Registrar AES' }
  };
}
function listaAesHtml() {
  const L = []; S.sess.filter(s => s.papel === 'gestor').forEach(s => aesPendentes(s.pref).forEach(a => L.push(Object.assign({ pref: s.pref, div: s.div }, a))));
  if (!L.length) return `<div class="small muted">Nenhum projeto aguardando PDF. Suba uma AES para começar.</div>`;
  const porAes = {}; L.forEach(a => (porAes[a.pref + '|' + a.aes] = porAes[a.pref + '|' + a.aes] || []).push(a));
  return Object.values(porAes).map(G => `<div style="border-top:1px solid var(--ln);padding:8px 0"><div style="display:flex;align-items:center;gap:8px"><b style="flex:1">AES ${esc(G[0].aes)} · ${esc(G[0].empreiteira)}</b><span class="small muted">${G[0].emitidaEm ? dBR(G[0].emitidaEm) : ''}</span><button class="btn sm ghost" data-rmaes="${esc(G[0].aes)}" data-pref="${esc(G[0].pref)}">Remover</button></div>
    <div class="small" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">${G.map(a => `<span class="chip alt" title="PEP ${esc(a.pep)} · prazo ${a.prazo ? dBR(a.prazo) : '—'}">${esc(a.projeto)} · ${fmtUs(a.us)} US</span>`).join('')}</div></div>`).join('');
}
function vNova(app) {
  if (!souGestor()) { app.innerHTML = `<div class="card empty">Só o gestor pode empenhar obras.</div>`; return }
  if (NOVA && NOVA.modo === 'add') { editorNova(); return }
  NOVA = null;
  app.innerHTML = `<div style="max-width:820px;margin:0 auto;display:grid;gap:14px">
   <div class="card"><h2 style="margin-top:0">1 · Subir a AES</h2>
    <p class="muted" style="margin-top:0">O PDF da AES gerada no empenho. O app lê a empreiteira, o contrato e cada projeto com PEP, US e prazo.</p>
    <label class="drop" id="dropa" style="display:block;cursor:pointer;padding:18px"><input type="file" accept="application/pdf" id="faes" class="hidden"><div style="font-weight:700">Escolher o PDF da AES</div><div class="small muted">ou arraste para cá</div></label>
    <div style="margin-top:12px"><b class="small">Projetos aguardando o PDF</b><div id="aesl" style="margin-top:4px">${listaAesHtml()}</div></div></div>
   <div class="card"><h2 style="margin-top:0">2 · Subir os PDFs dos projetos</h2>
    <p class="muted" style="margin-top:0">Pode selecionar vários de uma vez. Cada um é reconhecido pelo número do projeto e já vem com os dados da AES; você só confere os postes da planta e empenha. Projeto sem AES também funciona: aí os dados são preenchidos à mão.</p>
    <label class="drop" id="drop" style="display:block;cursor:pointer"><input type="file" accept="application/pdf" id="fpdf" class="hidden" multiple><div style="font-size:15px;font-weight:700">Escolher os PDFs dos projetos</div><div class="small muted" style="margin-top:4px">ou arraste os arquivos para cá</div></label>
   </div><div id="prog" class="small muted"></div></div>`;
  const ligar = (drop, inp, fn) => {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over') }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over') }));
    drop.addEventListener('drop', e => fn([...e.dataTransfer.files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf')));
    inp.onchange = e => fn([...e.target.files]);
  };
  ligar($('#dropa'), $('#faes'), fs => fs[0] && processarAes(fs[0]));
  ligar($('#drop'), $('#fpdf'), fs => { if (!fs.length) return; FILA_PDF = fs.slice(1); processarPdf(fs[0]) });
  $$('[data-rmaes]', app).forEach(b => b.onclick = async () => { if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar remoção'; return } b.disabled = true; try { await api(sessDe(b.dataset.pref), 'removerAes', { aes: b.dataset.rmaes }); toast('AES removida'); await sincronizar(); vNova(app) } catch (e) { toast(msgServidor(e), 1); b.disabled = false } });
}
let FILA_PDF = [];
function loadScript(src){return new Promise((ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('não carregou '+src));document.head.appendChild(s)})}
async function pdfLib() { if (window.pdfjsLib) return window.pdfjsLib; await loadScript(LIB.pdfw); await loadScript(LIB.pdf); return window.pdfjsLib }
function escolherPdf(cb) { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/pdf'; i.onchange = () => { const f = i.files[0]; f && cb(f) }; i.click() }
const MAX_FOLHAS = 10;
/** Lê cada página do PDF: texto, postes, estruturas e a imagem da folha. */
async function lerPaginas(file, st) {
  st('Carregando leitor de PDF…'); const lib = await pdfLib();
  st('Lendo o projeto…');
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, disableFontFace: true }).promise;
  const n = Math.min(doc.numPages, MAX_FOLHAS); const pags = [];
  for (let i = 1; i <= n; i++) {
    const pre = n > 1 ? `Folha ${i} de ${n}: ` : '';
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.map(i => { const [a, b, , , e, g] = i.transform; const [x, y] = vp1.convertToViewportPoint(e, g); const L = Math.hypot(a, b) || 1; const [x2] = vp1.convertToViewportPoint(e + i.width * a / L, g + i.width * b / L); return { str: i.str, x: Math.min(x, x2), y, w: Math.abs(x2 - x) || i.width, h: L } });
    st(pre + 'procurando os postes no desenho…');
    let geo = null; try { geo = geometriaPdf(await page.getOperatorList(), vp1, lib.OPS) } catch (e) { console.warn('geometria', e) }
    const R = analisarTexto(items, vp1.width, vp1.height, PRMAP.c.map(c => c[0]), geo);
    st(pre + 'gerando a imagem da planta…');
    const scale = Math.min(3, 2600 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale }); const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const png = await new Promise(r => cv.toBlob(r, 'image/jpeg', .86));
    cv.width = cv.height = 1; try { page.cleanup() } catch (e) { }
    pags.push({ R, png, url: URL.createObjectURL(png), w: Math.round(vp.width), h: Math.round(vp.height) });
  }
  return { pags, total: doc.numPages };
}
/** Junta os postes das folhas; número repetido em outra folha fica só na primeira. */
function juntarPostes(pags, usados, base) {
  const vistos = new Set(usados || []); const postes = []; const rep = [];
  pags.forEach((pg, i) => pg.R.postes.forEach(p => {
    if (vistos.has(p.n)) { rep.push(p.n); return }
    vistos.add(p.n); postes.push({ ...p, nota: p.nota || '', acao: p.acao || '', estruturas: p.estruturas || [], f: (base || 0) + i });
  }));
  return { postes, rep };
}
async function processarPdf(file, obraAdd) {
  let prog = $('#prog');
  if (obraAdd || !prog) { openLayer(`<div class="ov"><div class="box"><h2>Lendo o PDF…</h2><div id="prog" class="small muted"></div></div></div>`); prog = $('#prog') }
  const st = t => { if (prog) prog.textContent = t };
  try {
    let { pags, total } = await lerPaginas(file, st);
    const usados = obraAdd ? (obraAdd.postes || []).map(p => p.n) : [];
    let ignoradas = 0;
    if (obraAdd) {   // folha que já está na obra (todos os postes dela já existem) é ignorada
      const fora = pags.filter(pg => pg.R.postes.length && pg.R.postes.every(p => usados.includes(p.n)));
      ignoradas = fora.length; if (fora.length < pags.length) pags = pags.filter(pg => !fora.includes(pg));
    }
    const J = juntarPostes(pags, usados, 0);
    const campos = {}; pags.forEach(pg => Object.entries(pg.R.campos || {}).forEach(([k, v]) => { if (v && !campos[k]) campos[k] = v }));
    const R0 = pags.find(pg => pg.R.utm) || pags.find(pg => pg.R.ll) || pags.find(pg => pg.R.municipio) || pags[0];
    const municipio = (pags.find(pg => pg.R.municipio) || {}).R?.municipio || '';
    let loc = null; const utm = R0.R.utm || null;
    if (utm) { const ll = utmToLatLon(utm.e, utm.n); if (ll.lat < -22 && ll.lat > -27 && ll.lon < -48 && ll.lon > -55) loc = { lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6), src: 'utm' } }
    if (!loc && R0.R.ll) loc = { lat: +R0.R.ll.lat.toFixed(6), lon: +R0.R.ll.lon.toFixed(6), src: 'coordenada' };
    if (!loc && municipio) { const c = PRMAP.c.find(z => z[0] === municipio); loc = { lat: c[1], lon: c[2], src: 'municipio' } }
    const divs = S.sess.filter(s => s.papel === 'gestor');
    NOVA = {
      modo: obraAdd ? 'add' : 'novo', obra: obraAdd || null, file, folhas: pags.map(pg => ({ png: pg.png, url: pg.url, w: pg.w, h: pg.h })), f: 0,
      postes: J.postes, rep: J.rep, total, ignoradas,
      campos: { ...campos, municipio, empenhoEm: hoje(), pref: obraAdd ? obraAdd.pref : (S.divFiltro && divs.some(s => s.pref === S.divFiltro) ? S.divFiltro : (divs[0] || {}).pref) }, loc, utm, sel: null, divs
    };
    if (!obraAdd) aplicarAes(NOVA);
    closeLayer();
    if (obraAdd) go('nova'); else editorNova();
  } catch (e) { console.error(e); st('Não consegui ler este PDF: ' + (e.message || e)); toast('Erro ao ler o PDF', 1); if (obraAdd) setTimeout(closeLayer, 3500) }
}
/** Completa o empenho com o item da AES do mesmo projeto. */
function aplicarAes(N) {
  const a = aesDoProjeto(N.campos.projeto); if (!a) return;
  N.aesItem = a;
  Object.assign(N.campos, { projeto: String(a.projeto), pref: a.pref, empreiteira: a.empreiteira, aes: a.aes, pep: a.pep || N.campos.pep, us: a.us, prazo: a.prazo || N.campos.prazo, empenhoEm: a.emitidaEm || N.campos.empenhoEm });
}
function aesNotaHtml(N) {
  const a = N.aesItem;
  if (a) return `<div class="note ok-note" style="margin-top:10px">✔ Dados puxados da <b>AES ${esc(a.aes)}</b> (item ${esc(a.item)}): ${esc(a.empreiteira)} · PEP ${esc(a.pep || '—')} · ${fmtUs(a.us)} US · prazo ${a.prazo ? dBR(a.prazo) : '—'}. É só conferir os postes e empenhar.</div>`;
  return `<div class="note" style="margin-top:10px">O projeto ${esc(N.campos.projeto || '(sem número)')} não está em nenhuma AES registrada. Preencha os dados abaixo ou volte e suba a AES primeiro.</div>`;
}
function editorNova() {
  const app = $('#app'); const N = NOVA; const add = N.modo === 'add';
  const emps = [...new Set(S.obras.map(x => x.empreiteira).filter(Boolean))];
  const ja = add ? null : S.obras.find(o => o.projeto === N.campos.projeto);
  const usadosObra = add ? (N.obra.postes || []).map(p => p.n) : [];
  app.innerHTML = `<div class="toolbar"><button class="btn ghost sm" id="vol">← ${add ? 'Voltar à obra' : 'Outro PDF'}</button><h2 style="margin:0">${add ? 'Adicionar folha à obra ' + esc(N.obra.projeto) : 'Conferir projeto ' + esc(N.campos.projeto || '')}</h2><span style="flex:1"></span>
   <button class="btn sm ghost" id="add">+ Adicionar poste</button>${add ? '' : '<button class="btn sm ghost" id="ren">Renumerar</button>'}<button class="btn sm ghost" id="maisf">+ Folha de outro PDF</button><button class="btn sm ghost hidden" id="remf">Remover esta folha</button></div>
   <div class="edlay"><div id="vw"></div>
   <div class="card" style="max-height:calc(100vh - 170px);overflow:auto">
    <div class="note ${N.postes.length ? 'ok-note' : ''}" id="pnote"></div>
    <div class="plist" id="plist"></div>
    <div id="psel"></div>
    ${ja ? `<div class="note" style="margin-top:10px">Já existe uma obra com o projeto ${esc(ja.projeto)}. Salvar vai criar outra obra separada. Para incluir folhas numa obra que já existe, abra a obra e use “+ Adicionar folha”.</div>` : ''}
    ${add ? `<div class="note" style="margin-top:10px;background:#f4f6f9;border-color:var(--ln);color:var(--tx)">As folhas e os postes daqui vão ser acrescentados à obra ${esc(N.obra.projeto)} (hoje com ${N.obra.folhas.length} folha${N.obra.folhas.length > 1 ? 's' : ''} e ${(N.obra.postes || []).length} postes). Número de poste que já existe na obra não é repetido.${N.ignoradas ? ` ${N.ignoradas} folha(s) do PDF já estavam na obra e foram ignoradas.` : ''}</div>`
      : `<div class="note" style="margin-top:10px;background:#f4f6f9;border-color:var(--ln);color:var(--tx)">Localização: ${N.loc ? (N.loc.src === 'utm' ? `coordenada UTM do desenho (${fmt1(N.utm.e)}, ${fmt1(N.utm.n)})` : N.loc.src === 'coordenada' ? `coordenada do desenho (${N.loc.lat}, ${N.loc.lon})` : `centro do município de ${esc(N.campos.municipio)}`) : 'não encontrada no PDF. Informe o município ou ela virá do GPS dos registros.'}</div>`}
    ${add ? '' : `<div id="aesnote">${aesNotaHtml(N)}</div>`}
    <div id="nf" class="${add ? 'hidden' : ''}">${add ? '' : formCampos(N.campos, emps, N.divs)}</div>
    <button class="btn pri" id="salvar" style="width:100%;margin-top:16px;padding:12px">${add ? 'Adicionar à obra' : 'Empenhar obra'}</button>
    <div class="small muted" id="sst" style="margin-top:8px"></div>
   </div></div>`;
  const numUsado = (v, p) => N.postes.some(x => x !== p && x.n === v) || usadosObra.includes(v);
  let ed;
  function mount() {
    if (N.f >= N.folhas.length) N.f = 0;
    const fo = N.folhas[N.f]; const host = hostLimpo('#vw');
    ed = Viewer(host, {
      img: fo.url, iw: fo.w, ih: fo.h, editable: true,
      getMarkers: () => N.postes.filter(p => (p.f || 0) === N.f).map(p => ({ key: String(p.n), label: String(p.n), x: p.x, y: p.y, cls: 'ed' + (p.acao === 'retirar' ? ' ret' : '') + (N.sel === p.n ? ' sel' : '') })),
      onMarker: k => { N.sel = +k; ed.refresh(); side() },
      onMove: (k, p) => { const q = N.postes.find(x => x.n === +k); q.x = +p.x.toFixed(5); q.y = +p.y.toFixed(5); N.sel = +k; ed.refresh(); side() },
      onPlace: p => { const n = Math.max(0, ...N.postes.map(x => x.n), ...usadosObra) + 1; N.postes.push({ n, x: +p.x.toFixed(5), y: +p.y.toFixed(5), nota: '', acao: '', estruturas: [], f: N.f }); N.sel = n; ed.setPlacing(false); ed.refresh(); side() }
    });
    abasFolhas(host, N.folhas.length, N.f, i => `Folha ${i + 1} · ${N.postes.filter(p => (p.f || 0) === i).length}`, i => { N.f = i; N.sel = null; mount(); side() });
    $('#remf').classList.toggle('hidden', N.folhas.length < 2);
  }
  function side() {
    N.postes.sort((a, b) => a.n - b.n);
    const nf = N.folhas.length;
    $('#pnote').innerHTML = (N.postes.length ? `<b>${N.postes.length} postes</b> marcados${nf > 1 ? ` em <b>${nf} folhas</b>` : ' na planta'}${N.postes.some(p => p.acao === 'retirar') ? ` (${N.postes.filter(p => p.acao === 'retirar').length} a retirar, em quadrado)` : ''}. Confira: arraste um número para corrigir a posição, clique para editar ou excluir, e use “+ Adicionar poste” para algum que faltou.` : `<b>Nenhum poste numerado foi encontrado.</b> Use “+ Adicionar poste” e clique na planta sobre cada poste a executar.`)
      + (N.total > MAX_FOLHAS ? `<br>O PDF tem ${N.total} páginas; foram lidas as ${MAX_FOLHAS} primeiras.` : '')
      + (N.rep && N.rep.length ? `<br><span class="small">Poste(s) ${[...new Set(N.rep)].join(', ')} aparece(m) em mais de uma folha (ou já existe(m) na obra): ficou só a primeira marcação.</span>` : '');
    $('#plist').innerHTML = N.postes.map(p => `<span data-n="${p.n}" class="${N.sel === p.n ? 'sel' : ''}" title="${esc((nf > 1 ? 'Folha ' + ((p.f || 0) + 1) + ' · ' : '') + (p.nota || ''))}">${p.n}${p.acao === 'retirar' ? ' ✕' : p.acao === 'modificar' ? ' ±' : p.nota ? ' •' : ''}</span>`).join('');
    $$('#plist span').forEach(s => s.onclick = () => { N.sel = +s.dataset.n; const p = N.postes.find(x => x.n === N.sel); if ((p.f || 0) !== N.f) { N.f = p.f || 0; mount() } ed.focus(p.x, p.y); ed.refresh(); side() });
    const p = N.postes.find(x => x.n === N.sel);
    $('#psel').innerHTML = p ? `<div style="background:#f4f6f9;border-radius:10px;padding:10px;margin-top:10px"><div class="row2"><div><label class="f" style="margin-top:0">Número${nf > 1 ? ` <span class="muted">· folha ${(p.f || 0) + 1}</span>` : ''}</label><input class="i" id="pn" type="number" value="${p.n}"></div><div style="display:flex;align-items:flex-end;justify-content:flex-end"><button class="btn sm" id="pdel" style="background:#fee2e2;color:#991b1b">Excluir poste</button></div></div>
      ${(p.estruturas || []).length ? `<label class="f">Estruturas lidas do PDF</label>${estHtml(p)}` : ''}
      <label class="f">Ação no poste</label><select class="i" id="pacao">${[['', '—'], ['instalar', 'Instalar'], ['retirar', 'Retirar'], ['modificar', 'Modificar (instalar e retirar)']].map(([v, t]) => `<option value="${v}" ${(p.acao || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="f">O que deve ser feito</label><input class="i" id="pnota" value="${esc(p.nota || '')}" placeholder="Ex.: Instalar: B1 · SI-3"></div>` : '';
    if (p) {
      $('#pn').onchange = e => { const v = parseInt(e.target.value, 10); if (!v || numUsado(v, p)) { toast('Número inválido ou repetido', 1); e.target.value = p.n; return } p.n = v; N.sel = v; ed.refresh(); side() };
      $('#pnota').oninput = e => { p.nota = e.target.value };
      $('#pacao').onchange = e => { p.acao = e.target.value; ed.refresh(); side() };
      $('#pdel').onclick = () => { N.postes = N.postes.filter(x => x !== p); N.sel = null; ed.refresh(); side() }
    }
  }
  mount(); side();
  $('#vol').onclick = () => { if (add) { const id = N.obra.id; NOVA = null; go('obra-' + id) } else { FILA_PDF = []; vNova(app) } };
  $('#add').onclick = () => ed.setPlacing(!ed.placing, 'Clique na planta onde fica o novo poste');
  $('#ren') && ($('#ren').onclick = () => { N.postes.sort((a, b) => (a.f || 0) - (b.f || 0) || a.n - b.n).forEach((p, i) => p.n = i + 1); N.rep = []; N.sel = null; ed.refresh(); side(); toast('Postes renumerados de 1 a ' + N.postes.length) });
  $('#maisf').onclick = () => escolherPdf(async f => {
    const sst = $('#sst'); const b = $('#maisf'); b.disabled = true;
    try {
      const r = await lerPaginas(f, t => sst.textContent = t);
      const base = N.folhas.length;
      const J = juntarPostes(r.pags, N.postes.map(p => p.n).concat(usadosObra), base);
      r.pags.forEach(pg => N.folhas.push({ png: pg.png, url: pg.url, w: pg.w, h: pg.h }));
      N.postes.push(...J.postes); N.rep = (N.rep || []).concat(J.rep); N.f = base; N.sel = null;
      sst.textContent = ''; mount(); side(); toast(`${r.pags.length} folha(s) incluída(s) · ${J.postes.length} poste(s) lido(s)`);
    } catch (e) { console.error(e); sst.textContent = ''; toast('Não consegui ler este PDF: ' + (e.message || e), 1) }
    b.disabled = false;
  });
  $('#remf').onclick = e => {
    const b = e.currentTarget;
    if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = `Confirmar: remover a folha ${N.f + 1} e os postes dela`; b.style.background = '#fee2e2'; setTimeout(() => { if (b.isConnected) { delete b.dataset.conf; b.textContent = 'Remover esta folha'; b.style.background = '' } }, 4000); return }
    delete b.dataset.conf; b.textContent = 'Remover esta folha'; b.style.background = '';
    const f = N.f; N.folhas.splice(f, 1);
    N.postes = N.postes.filter(p => (p.f || 0) !== f).map(p => (p.f || 0) > f ? { ...p, f: p.f - 1 } : p);
    N.f = Math.max(0, f - 1); N.sel = null; mount(); side();
  };
  if (!add) {
    ligarTrocaDivisao($('#nf'));
    const pj = $('[name=projeto]', $('#nf'));
    pj && (pj.onchange = () => { Object.assign(N.campos, lerForm($('#nf'))); delete N.aesItem; aplicarAes(N); $('#nf').innerHTML = formCampos(N.campos, emps, N.divs); $('#aesnote').innerHTML = aesNotaHtml(N); ligarTrocaDivisao($('#nf')); editorNova() });
  }
  if (FILA_PDF.length && !add) $('#sst').textContent = `Depois deste, ${FILA_PDF.length} PDF(s) na fila.`;
  $('#salvar').onclick = add ? salvarFolhasObra : salvarNova;
}
async function salvarNova() {
  const N = NOVA; const v = lerForm($('#nf')); const sst = $('#sst');
  if (!v.projeto) { toast('Informe o número do projeto', 1); return }
  if (!v.empreiteira) { toast('Informe a empreiteira', 1); return }
  if (v.us == null) { toast('Informe as US da obra', 1); return }
  if (!N.postes.length) { toast('Marque pelo menos um poste na planta', 1); return }
  const s = sessDe(v.pref || N.campos.pref); delete v.pref;
  if (!s || s.papel !== 'gestor') { toast('Escolha uma divisão em que você é gestor', 1); return }
  const btn = $('#salvar'); btn.disabled = true;
  try {
    let loc = N.loc;
    if (v.municipio && (!loc || loc.src === 'municipio') && v.municipio !== N.campos.municipio) { const c = PRMAP.c.find(z => z[0] === v.municipio); if (c) loc = { lat: c[1], lon: c[2], src: 'municipio' } }
    sst.textContent = 'Preparando arquivos…';
    const plantaB64 = await blobB64(N.folhas[0].png);
    const folhas = []; for (const fo of N.folhas.slice(1)) folhas.push({ b64: await blobB64(fo.png), w: fo.w, h: fo.h });
    const pdfB64 = N.file.size < 25e6 ? await blobB64(N.file) : null;
    sst.textContent = `Enviando para a ${s.div}… (pode levar alguns segundos${folhas.length ? ', são ' + N.folhas.length + ' folhas' : ''})`;
    const obra = Object.assign({}, v, { postes: N.postes.map(p => ({ n: p.n, x: p.x, y: p.y, nota: p.nota || '', acao: p.acao || '', estruturas: p.estruturas || [], f: p.f || 0 })), lat: loc ? loc.lat : '', lon: loc ? loc.lon : '', locOrigem: loc ? loc.src : '' });
    const j = await api(s, 'empenhar', { aesItem: N.aesItem && N.aesItem.pref === s.pref ? N.aesItem.id : null, obra, planta: { b64: plantaB64, w: N.folhas[0].w, h: N.folhas[0].h }, folhas, pdf: pdfB64 ? { b64: pdfB64, nome: N.file.name } : null });
    toast('Obra ' + v.projeto + ' empenhada'); NOVA = null;
    await sincronizar();
    if (FILA_PDF.length) { const f = FILA_PDF.shift(); processarPdf(f) } else go('obra-' + j.id);
  } catch (e) { console.error(e); btn.disabled = false; sst.textContent = ''; toast(msgServidor(e), 1) }
}
async function salvarFolhasObra() {
  const N = NOVA; const o = N.obra; const sst = $('#sst'); const btn = $('#salvar');
  if (!N.folhas.length) { toast('Nenhuma folha para adicionar', 1); return }
  btn.disabled = true;
  try {
    sst.textContent = 'Preparando arquivos…';
    const folhas = []; for (const fo of N.folhas) folhas.push({ b64: await blobB64(fo.png), w: fo.w, h: fo.h });
    sst.textContent = 'Enviando…';
    const j = await api(sessObra(o), 'adicionarFolhas', { id: o.id, folhas, postes: N.postes.map(p => ({ n: p.n, x: p.x, y: p.y, nota: p.nota || '', acao: p.acao || '', estruturas: p.estruturas || [], f: p.f || 0 })) });
    toast(`${j.folhas} folha(s) e ${j.postes} poste(s) adicionados à obra`); NOVA = null;
    await sincronizar(); go('obra-' + o.id);
  } catch (e) { console.error(e); btn.disabled = false; sst.textContent = ''; toast(msgServidor(e), 1) }
}
function msgServidor(e) {
  const m = (e && e.message) || '';
  if (/tipo inválido|ação desconhecida/.test(m)) return 'O script da planilha está desatualizado: publique o Codigo.gs novo (Implantar → Gerenciar implantações → ✏️ → Nova versão).';
  return e && e.rede ? 'Sem conexão. Tente de novo.' : 'Não foi possível salvar: ' + m;
}

/* ---------- fiscalização pela tela da obra (gestão) ---------- */
const podeFiscalizar = o => ['gestor', 'fiscal'].includes(papelObra(o));
/** Postes executados que ainda não têm aprovação nem reprovação válida. */
function aFiscalizar(o) { const I = S.idx[o.id]; const L = []; for (const [k, st] of I.postes) if (st.last && EXEC.has(st.last.tipo) && !st.last.pendente && !fiscPoste(I, k)) L.push(k); return L }
function fiscalWebHtml(o) {
  if (!SEL || S.view === 'hobra' || !podeFiscalizar(o)) return '';
  const I = S.idx[o.id]; const st = I.postes.get(SEL); const f = fiscPoste(I, SEL);
  if (!st || !st.last || !EXEC.has(st.last.tipo)) return `<div class="note" style="margin-top:8px">A aprovação deste poste aparece depois que a equipe registrar a execução em campo.</div>`;
  return `<div class="fiscbox" id="fwb"><div class="lbl">Fiscalização deste poste${f ? ` · <span class="chip ${TIPO_CH[f]}">${esc(TIPO_TX[f])}</span>` : ''}</div>
    <div class="bigbtns"><button class="b1" data-ft="aprovado">✔️ ${f === 'aprovado' ? 'Aprovado' : 'Aprovar · medido'}</button><button class="b3" data-ft="reprovado">✖️ Reprovar</button></div><div id="frep"></div></div>`;
}
async function enviarFisc(o, keys, tipo, alt, obs) {
  const s = sessObra(o); const agora = new Date().toISOString();
  const regs = keys.map(k => ({ id: uid(), obra: o.id, poste: k, tipo, alt: alt || [], obs: obs || '', dataExec: hoje(), marcadoEm: agora, nome: S.nome || s.responsavel || '', empresa: 'Copel (fiscalização)' }));
  const j = keys.length === 1 ? await api(s, 'registrar', { registro: regs[0], foto: null }) : await api(s, 'fiscalizarLote', { registros: regs });
  if (j.fiscalizada) { toast('Todos os postes aprovados: a obra está medida e aguardando a FF'); await sincronizar(); return }
  toast(tipo === 'reprovado' ? 'Poste reprovado' : keys.length > 1 ? keys.length + ' postes aprovados' : 'Poste aprovado');
  await sincronizar();
}
function ligarFiscalWeb(o, side) {
  const box = $('#fwb', side);
  if (box) {
    $('[data-ft=aprovado]', box).onclick = async e => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Salvando…'; try { await enviarFisc(o, [SEL], 'aprovado') } catch (err) { toast(msgServidor(err), 1); renderObraSide() } };
    $('[data-ft=reprovado]', box).onclick = () => {
      const alt = [];
      $('#frep').innerHTML = `<label class="f">Motivo da reprovação</label><div class="chips">${MOTIVOS_REP.map(a => `<button data-a="${esc(a)}">${esc(a)}</button>`).join('')}</div><label class="f">Observação</label><textarea class="i" id="frobs"></textarea><button class="btn sm" id="frok" style="margin-top:8px;background:var(--bad);color:#fff" disabled>Confirmar reprovação</button>`;
      $$('#frep [data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a; const i = alt.indexOf(a); i < 0 ? alt.push(a) : alt.splice(i, 1); b.classList.toggle('on'); $('#frok').disabled = !alt.length });
      $('#frok').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Salvando…'; try { await enviarFisc(o, [SEL], 'reprovado', alt, $('#frobs').value.trim()) } catch (err) { toast(msgServidor(err), 1); renderObraSide() } };
    };
  }
  const lote = $('#flote', side);
  lote && (lote.onclick = async e => {
    const b = e.currentTarget; const L = aFiscalizar(o); if (!L.length) return;
    if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = `Confirmar: aprovar ${L.length} poste(s) como medidos`; return }
    b.disabled = true; b.textContent = 'Salvando…';
    try { await enviarFisc(o, L, 'aprovado') } catch (err) { toast(msgServidor(err), 1); renderObraSide() }
  });
}

/* ================= CAMPO ================= */
function pedirNome(cb) {
  openLayer(`<div class="ov"><div class="box"><h2>Quem está lançando?</h2><p class="small muted" style="margin-top:0">Seu nome fica salvo neste celular e vai junto com cada registro.</p>
   <label class="f">Seu nome / encarregado</label><input class="i" id="eqn" value="${esc(S.nome || '')}">
   <button class="btn pri" id="eqok" style="width:100%;margin-top:16px;padding:12px">Continuar</button></div></div>`);
  setTimeout(() => $('#eqn') && $('#eqn').focus(), 50);
  $('#eqok').onclick = () => { const nome = $('#eqn').value.trim(); if (!nome) { toast('Informe seu nome', 1); return } S.nome = nome; lsSet('fisc.nome', nome); closeLayer(); cb && cb() };
}
function vFlist(app) {
  if (!S.nome) { app.innerHTML = ''; pedirNome(() => render()); return }
  const copel = souCopel();
  const ativas = obrasVisiveis().filter(o => o.status !== 'concluida' && o.status !== 'cancelada');
  const L = (copel || S.verTodas) ? ativas : ativas.filter(o => o.empreiteira === empresaCampo(o));
  const s0 = S.sess[0];
  app.innerHTML = `<div class="fhead"><div class="who"><div><b>${esc(S.nome)}</b><div class="small muted">${copel ? 'Copel · fiscalização' : esc(s0.empresa)} · ${esc(S.sess.map(s => s.div).join(', '))}</div></div><a class="btn sm ghost" href="#conta" style="text-decoration:none">Conta</a></div>
   ${S.fila.length ? `<div class="note" style="margin-top:10px">${S.fila.length} registro(s) aguardando sinal para enviar. <button class="btn sm" id="envf">Tentar agora</button></div>` : ''}
   ${!copel && docsTotal() ? `<a class="fcard" href="#assinar" style="display:block;margin-top:10px;text-decoration:none;color:inherit;${docsPend() ? 'background:#fff7ed;border:1px solid #fed7aa' : ''}"><b>📄 ${docsPend() ? docsPend() + ' documento(s) aguardando sua assinatura' : 'Documentos assinados'}</b><div class="small muted">AES, BMD, FF e vistoria enviados pela Copel${docsPend() ? ' · toque para assinar' : ' · toque para baixar'}</div></a>` : ''}
   ${!copel && pdeResumo().tot ? `<a class="fcard" href="#pdes" style="display:block;margin-top:10px;text-decoration:none;color:inherit;${pdeResumo().dev ? 'background:#fee2e2;border:1px solid #fecaca' : ''}"><b>📋 PDE / PLV${pdeResumo().dev ? ` · ${pdeResumo().dev} devolvido(s) para corrigir` : ''}</b><div class="small muted">${pdeResumo().sol} aguardando o fiscal · toque para ver seus pedidos</div></a>` : ''}
   ${!copel && !assTotal() ? `<a class="fcard" href="#assinatura" style="display:block;margin-top:10px;text-decoration:none;color:inherit;background:#eff6ff;border:1px solid #bfdbfe"><b>✍️ Cadastre a assinatura da empresa</b><div class="small muted">O responsável (dono ou supervisor) desenha a assinatura e cria um PIN uma vez; depois assina BMD e FF com um toque.</div></a>` : ''}
   <div id="inst"></div></div>
   <div class="flist">${L.length ? L.map(o => {
    const I = S.idx[o.id]; const d = diasAte(o.prazo); return `<div class="fcard" data-o="${esc(o.id)}"><div class="t"><b>${esc(o.projeto)}</b><span class="pct" style="color:var(--or)">${fmt1(I.pct * 100)}%</span></div>
     <div class="s">${esc(o.descricao || '')}${o.municipio ? ' · ' + esc(o.municipio) : ''}<br>${esc(o.empreiteira || '')}${o.prazo ? ` · prazo ${dBR(o.prazo)}${d != null && d < 0 && I.pct < 1 ? ' (vencido)' : ''}` : ''}</div>
     <div class="bar" style="height:10px"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>
     <div class="small muted" style="margin-top:6px">${I.exec} de ${I.tot} executados · ${I.fis} fiscalizados${I.rep ? ` · <b style="color:var(--bad)">${I.rep} reprovado(s)</b>` : ''}${I.pend ? ` · ${I.pend} aguardando envio` : ''}</div><div style="margin-top:6px">${etapaChip(I)}</div></div>`
  }).join('')
      : `<div class="fcard empty">Nenhuma obra em andamento${copel ? '' : ' para ' + esc(s0.empresa)}.</div>`}</div>`;
  $('#envf') && ($('#envf').onclick = () => enviarFila());
  $$('[data-o]', app).forEach(el => el.onclick = () => go('campo-' + el.dataset.o));
  mostrarInstalar($('#inst'));
}
function vFobra(app) {
  const o = S.obras.find(x => x.id === S.obraId);
  if (!o) { app.innerHTML = `<div class="fcard empty" style="margin:16px">Obra não encontrada. <a href="#campo">Voltar</a></div>`; return }
  if (!S.nome) { pedirNome(() => render()); return }
  app.innerHTML = `<div class="fobra"><div class="fbar"><a href="#campo" class="btn sm ghost" style="text-decoration:none">←</a><div style="flex:1;min-width:0"><b>${esc(o.projeto)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.descricao || '')} · ${esc(o.empreiteira || '')}</div></div>${o.pdf ? `<a class="btn sm ghost" href="${esc(driveVer(o.pdf.id))}" target="_blank" rel="noopener" style="text-decoration:none">PDF</a>` : ''}</div>
   <div id="vw"></div><div class="fbot"><div style="flex:1" id="fsum"></div>${souCopel() ? '' : '<button class="btn sm ghost" id="pdebt">PDE/PLV</button>'}<button class="btn sm dk" id="novo">+ Poste não previsto</button></div></div>`;
  FOLHA = 0;
  VIEWER = montarPlanta(o, { onMarker: k => abrirPoste(o, k), onPlace: p => { VIEWER.setPlacing(false); abrirPoste(o, null, p) } });
  $('#novo').onclick = () => { VIEWER.setPlacing(!VIEWER.placing, 'Toque na planta onde ficou o poste novo') };
  $('#pdebt') && ($('#pdebt').onclick = () => iniciarPde(o));
  updFbot();
  if (PDE_CORRIGIR && PDE_CORRIGIR.obra === o.id) { const b = PDE_CORRIGIR; PDE_CORRIGIR = null; iniciarPde(o, b); return }
  const rasc = lsGet('fisc.rascunho', null);
  if (rasc && rasc.obra === o.id && Date.now() - rasc.t < 20 * 60000) setTimeout(() => { if (rasc.folha != null) FOLHA = rasc.folha; abrirPoste(o, rasc.key, rasc.novoPos, rasc) }, 300);
}
function updFbot() {
  const o = S.obras.find(x => x.id === S.obraId); const el = $('#fsum'); if (!o || !el) return; const I = S.idx[o.id];
  el.innerHTML = `<b>${I.exec}/${I.tot}</b> exec. · <b style="color:var(--ok)">${I.fis}</b> fisc. · <b style="color:var(--or)">${fmt1(I.pct * 100)}%</b>${I.pend ? ` · <span class="small muted">${I.pend} a enviar</span>` : ''}<div class="bar" style="margin-top:4px"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>`
}

/* ---------- câmera dentro do app ---------- */
function cameraInterna() {
  return new Promise(async (ok, ko) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return ko(new Error('sem câmera'));
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }) }
    catch (e) { return ko(e) }
    const ov = document.createElement('div'); ov.className = 'camov';
    ov.innerHTML = `<video playsinline autoplay muted></video><div class="cambar"><button class="btn ghost" data-c="x">Cancelar</button><button class="shutter" data-c="ok" aria-label="Tirar foto"></button><span style="width:86px"></span></div>`;
    document.body.appendChild(ov);
    const v = ov.querySelector('video'); v.srcObject = stream;
    const fim = r => { stream.getTracks().forEach(t => t.stop()); ov.remove(); ok(r) };
    ov.querySelector('[data-c=x]').onclick = () => fim(null);
    ov.querySelector('[data-c=ok]').onclick = () => {
      const w = v.videoWidth, h = v.videoHeight; if (!w) return;
      const s = Math.min(1, 1280 / Math.max(w, h)); const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      cv.toBlob(b => fim({ blob: b, gps: null, data: null }), 'image/jpeg', .78);
    };
  });
}

/* ---------- GPS do celular ---------- */
function pegarGps() {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    let feito = false; const fim = v => { if (!feito) { feito = true; ok(v) } };
    setTimeout(() => fim(null), 20000);
    navigator.geolocation.getCurrentPosition(p => fim({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), precisao: Math.round(p.coords.accuracy), origem: 'celular' }), () => fim(null), { enableHighAccuracy: true, timeout: 18000, maximumAge: 60000 });
  });
}

function abrirPoste(o, key, novoPos, rasc) {
  const novo = !key;
  const I = S.idx[o.id]; const st = key ? I.postes.get(key) : null;
  const pp = key && key.startsWith('P') ? (o.postes.find(p => 'P' + p.n === key) || {}) : {};
  const fiscal = papelObra(o) !== 'empreiteira'; const executado = !!(st && st.last && EXEC.has(st.last.tipo)); const fAtual = fiscPoste(I, key);
  const prev = pp.nota || ''; const ret = pp.acao === 'retirar';
  const F = { tipo: novo ? 'novo' : null, alt: [], obs: '', foto: null, dataExec: hoje(), gps: null };
  if (rasc) { F.tipo = rasc.tipo || F.tipo; F.alt = rasc.alt || []; F.obs = rasc.obs || ''; F.dataExec = rasc.dataExec || F.dataExec }
  // rascunho: se o Android fechar o app enquanto a câmera do celular está aberta, o registro volta preenchido
  const folhaNovo = rasc && rasc.folha != null ? rasc.folha : FOLHA;
  const guardar = () => lsSet('fisc.rascunho', { obra: o.id, key: key || null, novoPos: novoPos || null, folha: folhaNovo, tipo: F.tipo, alt: F.alt, obs: F.obs, dataExec: F.dataExec, t: Date.now() });
  const descartar = () => { try { localStorage.removeItem('fisc.rascunho') } catch (e) { } };
  const gpsP = pegarGps().then(g => { F.gps = g; const el = $('#fgps2'); if (el) el.textContent = g ? `GPS do celular: ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} (±${g.precisao} m)` : 'GPS do celular indisponível. Ative a localização para este app.' });
  const titulo = novo ? 'Poste não previsto' : rotuloPoste(o, key);
  openLayer(`<div class="ov" id="shov" style="align-items:flex-end;padding:0"><div class="sheet" style="position:relative;width:100%"><div class="grab"></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h4>${esc(titulo)}</h4><button class="btn sm ghost" id="shx">Fechar</button></div>
    ${(pp.estruturas || []).length ? `<div style="margin-top:8px">${estHtml(pp)}</div>` : prev ? `<div class="small" style="margin-top:6px;background:#f4f6f9;border-radius:8px;padding:8px">Previsto: ${esc(prev)}</div>` : ''}
    ${st && st.last ? `<div class="small" style="margin-top:6px">Situação atual: <span class="chip ${TIPO_CH[st.last.tipo]}">${esc(tipoTx(o, st.last))}</span>${st.last.pendente ? ' <span class="chip">aguardando envio</span>' : ''}</div>` : ''}
    ${fAtual ? `<div class="small" style="margin-top:6px">Fiscalização: <span class="chip ${TIPO_CH[fAtual]}">${esc(TIPO_TX[fAtual])}</span></div>` : ''}
    ${fiscal && executado ? `<div class="fiscbox"><div class="lbl">Fiscalização</div><div class="bigbtns"><button class="b1" data-t="aprovado">✔️ Aprovar · medido</button><button class="b3" data-t="reprovado">✖️ Reprovar</button></div></div>${novo ? '' : '<div class="lbl" style="margin-top:12px">Registrar execução</div>'}` : ''}
    ${novo ? `<div class="small muted" style="margin-top:6px">Registre o poste implantado fora do projeto. Descreva o que foi feito e tire a foto.</div>` : `
    <div class="bigbtns"><button class="b1" data-t="conforme">✅ ${ret ? 'Retirado' : 'Executado'} conforme projeto</button><button class="b2" data-t="alterado">✏️ ${ret ? 'Retirado' : 'Executado'} com alteração</button><button class="b3" data-t="nao">⛔ ${ret ? 'Não retirado' : 'Não executado'}</button></div>`}
    <div id="dyn"></div>
    <label class="f">Data da execução</label><input class="i" type="date" id="dex" value="${F.dataExec}" max="${hoje()}">
    <label class="f">Foto do poste <span id="fobr"></span></label>
    ${rasc ? `<div class="note" style="margin-top:6px">O registro foi retomado. Tire a foto de novo.</div>` : ''}
    <div class="photo"><img id="fprev" class="hidden"><button type="button" class="fbtn" id="fcam">📷 <span id="flbl">Tirar foto</span></button><label class="fbtn gal"><input type="file" accept="image/*" id="fgal" class="hidden">🖼️ Galeria</label><input type="file" accept="image/*" capture="environment" id="ffoto" class="hidden"></div>
    <div class="small muted" id="fgps2" style="margin-top:6px">Buscando GPS do celular…</div>
    <button class="btn pri" id="shok" style="width:100%;margin-top:16px;padding:14px;font-size:15px" disabled>Salvar registro</button>
    ${st && st.hist.length ? `<div class="hist"><b class="small">Histórico</b>${[...st.hist].reverse().map(r => `<div>${dtBR(r.em)} · ${esc(tipoTx(o, r))} · ${esc(r.equipe || '')}${r.alt && r.alt.length ? ' · ' + esc(r.alt.join(', ')) : ''}</div>`).join('')}</div>` : ''}
  </div></div>`);
  const fechar = () => { descartar(); closeLayer() };
  $('#shx').onclick = fechar; $('#shov').onclick = e => { if (e.target.id === 'shov') fechar() };
  const dyn = $('#dyn'); const LY = $('#layer');
  const precisaFoto = () => !['nao', 'aprovado', 'reprovado'].includes(F.tipo);
  const valida = () => { const ok = F.tipo && (!precisaFoto() || F.foto) && (F.tipo !== 'alterado' || F.alt.length) && (F.tipo !== 'nao' || F.alt.length) && (F.tipo !== 'reprovado' || F.alt.length) && (F.tipo !== 'novo' || F.obs.trim()); $('#shok').disabled = !ok; $('#fobr').textContent = precisaFoto() ? '(obrigatória)' : '(opcional)' };
  function drawDyn() {
    const lista = F.tipo === 'alterado' ? ALTERACOES : F.tipo === 'nao' ? PENDENCIAS : F.tipo === 'reprovado' ? MOTIVOS_REP : null;
    dyn.innerHTML = (lista ? `<label class="f">${F.tipo === 'alterado' ? 'O que foi alterado?' : F.tipo === 'reprovado' ? 'Motivo da reprovação' : 'Motivo'}</label><div class="chips">${lista.map(a => `<button data-a="${esc(a)}" class="${F.alt.includes(a) ? 'on' : ''}">${esc(a)}</button>`).join('')}</div>` : '')
      + (F.tipo ? `<label class="f">${F.tipo === 'novo' ? 'O que foi feito? *' : 'Observação'}</label><textarea class="i" id="obs" placeholder="${F.tipo === 'alterado' ? 'Ex.: poste deslocado 5 m para não ficar em frente à garagem' : ''}">${esc(F.obs)}</textarea>` : '');
    $$('[data-a]', dyn).forEach(b => b.onclick = () => { const a = b.dataset.a; F.alt = F.alt.includes(a) ? F.alt.filter(x => x !== a) : [...F.alt, a]; b.classList.toggle('on'); valida(); guardar() });
    $('#obs') && ($('#obs').oninput = e => { F.obs = e.target.value; valida(); guardar() });
    valida();
  }
  $$('[data-t]', LY).forEach(b => b.onclick = () => { F.tipo = b.dataset.t; F.alt = []; $$('[data-t]', LY).forEach(x => x.classList.toggle('on', x === b)); drawDyn(); guardar() });
  if (F.tipo) $$('[data-t]', LY).forEach(x => x.classList.toggle('on', x.dataset.t === F.tipo));
  drawDyn();
  $('#dex').onchange = e => { F.dataExec = e.target.value || hoje(); guardar() };
  const usarFoto = foto => { F.foto = foto; $('#fprev').src = URL.createObjectURL(foto.blob); $('#fprev').classList.remove('hidden'); $('#flbl').textContent = 'Trocar foto'; if (foto.data && foto.data <= hoje()) { F.dataExec = foto.data; $('#dex').value = foto.data } valida() };
  const deArquivo = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return; $('#flbl').textContent = 'Processando…';
    try { usarFoto(await prepFoto(f)) } catch (err) { console.error(err); $('#flbl').textContent = 'Tirar foto'; toast('Não consegui ler a foto', 1) }
  };
  $('#ffoto').onchange = deArquivo; $('#fgal').onchange = deArquivo;
  $('#fgal').onclick = () => guardar();
  $('#fcam').onclick = async () => {
    guardar();
    const foto = await cameraInterna().catch(() => 'falhou');
    if (foto === 'falhou') { $('#ffoto').click(); return }   // sem câmera interna: usa a câmera do celular
    if (foto) usarFoto(foto);
  };
  $('#shok').onclick = async () => {
    const b = $('#shok'); b.disabled = true; b.textContent = 'Salvando…';
    if (!F.gps) await Promise.race([gpsP, new Promise(r => setTimeout(r, 4000))]);
    const gps = F.gps || (F.foto && F.foto.gps ? Object.assign({ origem: 'foto' }, F.foto.gps) : null);
    const reg = {
      id: uid(), obra: o.id, poste: novo ? null : key, tipo: F.tipo, alt: F.alt, obs: F.obs.trim(), gps, dataExec: F.dataExec,
      marcadoEm: new Date().toISOString(), nome: S.nome, empresa: empresaCampo(o)
    };
    if (novo) { reg.x = +novoPos.x.toFixed(5); reg.y = +novoPos.y.toFixed(5); reg.folha = folhaNovo }
    const fotoB64 = F.foto ? await blobB64(F.foto.blob) : null;
    const item = { pref: o.pref, registro: reg, fotoB64, fotoLocal: F.foto ? 'data:image/jpeg;base64,' + fotoB64 : null };
    // grava primeiro no aparelho (não se perde), depois tenta enviar
    try { await IDB.set('fila:' + reg.id, item) } catch (e) { }
    S.fila.push(item); reindex(); descartar(); closeLayer(); render(true);
    try {
      const s = sessObra(o);
      const j = await api(s, 'registrar', { registro: reg, foto: fotoB64 ? { b64: fotoB64 } : null });
      await IDB.del('fila:' + reg.id).catch(() => { });
      S.fila = S.fila.filter(x => x.registro.id !== reg.id);
      if (j.fiscalizada) { toast('Último poste aprovado: obra medida, aguardando a FF'); await sincronizar() }
      else { toast(F.tipo === 'aprovado' ? 'Poste aprovado' : F.tipo === 'reprovado' ? 'Poste reprovado' : 'Registro salvo'); sincronizar() }
    } catch (e) {
      if (e.rede) { toast('Sem sinal: registro guardado no celular e será enviado sozinho.'); setSt('sem conexão', true) }
      else { await IDB.del('fila:' + reg.id).catch(() => { }); S.fila = S.fila.filter(x => x.registro.id !== reg.id); reindex(); render(true); toast(msgServidor(e), 1) }
    }
  };
}

function lerExif(buf){
  const v=new DataView(buf);if(v.byteLength<4||v.getUint16(0)!==0xFFD8)return {};
  let p=2;
  while(p+4<v.byteLength){const mk=v.getUint16(p);const len=v.getUint16(p+2);
    if(mk===0xFFE1&&v.getUint32(p+4)===0x45786966){return tiff(v,p+10)}
    if((mk&0xFF00)!==0xFF00)break;p+=2+len}
  return {};
  function tiff(v,t){const le=v.getUint16(t)===0x4949;const u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le);
    const ifd=o=>{const n=u16(o),m={};for(let i=0;i<n;i++){const e=o+2+i*12;m[u16(e)]={type:u16(e+2),cnt:u32(e+4),off:e+8}}return m};
    const rat=(o,k)=>{const a=[];for(let i=0;i<k;i++){a.push(u32(o+i*8)/(u32(o+i*8+4)||1))}return a};
    const str=(e)=>{const o=e.cnt>4?t+u32(e.off):e.off;let s='';for(let i=0;i<e.cnt-1;i++)s+=String.fromCharCode(v.getUint8(o+i));return s};
    const out={};
    try{const i0=ifd(t+u32(t+4));
      if(i0[0x8769]){const ex=ifd(t+u32(i0[0x8769].off));const d=ex[0x9003]||ex[0x9004];if(d){const s=str(d);const m=s.match(/^(\d{4}):(\d{2}):(\d{2})/);if(m)out.data=`${m[1]}-${m[2]}-${m[3]}`}}
      if(i0[0x8825]){const g=ifd(t+u32(i0[0x8825].off));
        if(g[2]&&g[4]){const la=rat(t+u32(g[2].off),3),lo=rat(t+u32(g[4].off),3);
          let lat=la[0]+la[1]/60+la[2]/3600,lon=lo[0]+lo[1]/60+lo[2]/3600;
          if(g[1]&&String.fromCharCode(v.getUint8(g[1].off))==='S')lat=-lat;if(g[3]&&String.fromCharCode(v.getUint8(g[3].off))==='W')lon=-lon;
          if(lat&&lon&&Math.abs(lat)<=90&&Math.abs(lon)<=180)out.gps={lat:+lat.toFixed(6),lon:+lon.toFixed(6)}}}
    }catch(e){}
    return out}
}
async function prepFoto(file){
  const buf=await file.arrayBuffer();const ex=lerExif(buf);
  const url=URL.createObjectURL(file);
  const img=await new Promise((ok,ko)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ko(new Error('imagem inválida'));i.src=url});
  const mx=1280,s=Math.min(1,mx/Math.max(img.naturalWidth,img.naturalHeight));
  const cv=document.createElement('canvas');cv.width=Math.round(img.naturalWidth*s);cv.height=Math.round(img.naturalHeight*s);
  cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(url);
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.78));
  return {blob,gps:ex.gps||null,data:ex.data||null};
}

/* ================= leitura do projeto (texto do PDF) ================= */
function norm(s){return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase();}
/* ===== leitura vetorial do PDF: círculos, segmentos (para riscos) ===== */
function geometriaPdf(ol, vp, OPS) {
  const mul = (m, n) => [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
  const ap = (m, x, y) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
  let ctm = vp.transform.slice(); const st = []; const circ = []; const segs = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i];
    if (fn === OPS.save) st.push(ctm.slice());
    else if (fn === OPS.restore) ctm = st.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { st.push(ctm.slice()); if (a && a[0]) ctm = mul(ctm, a[0]) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = st.pop() || ctm;
    else if (fn === OPS.constructPath) {
      const ops = a[0], c = a[1]; let k = 0, sub = null;
      const flush = () => {
        if (!sub) return; const P = sub.pts, curves = sub.curves, closed = sub.closed; sub = null;
        if (P.length < 5) return;
        const xs = P.map(p => p[0]), ys = P.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const w = x1 - x0, h = y1 - y0; if (w < 4 || w > 40 || h < 4 || h > 40 || w / h < 0.8 || w / h > 1.25) return;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; const ds = P.map(p => Math.hypot(p[0] - cx, p[1] - cy));
        const m = ds.reduce((s, d) => s + d, 0) / ds.length; const sd = Math.sqrt(ds.reduce((s, d) => s + (d - m) ** 2, 0) / ds.length);
        const fech = closed || Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < Math.max(1.5, w * 0.15);
        if ((P.length >= 8 && sd / m < 0.12 && fech) || (curves >= 2 && sd / m < 0.2)) circ.push({ x: cx, y: cy, r: (w + h) / 4 });
      };
      for (const op of ops) {
        if (op === OPS.moveTo) { flush(); sub = { pts: [ap(ctm, c[k], c[k + 1])], curves: 0, closed: false }; k += 2 }
        else if (op === OPS.lineTo) { const p = ap(ctm, c[k], c[k + 1]); if (sub) { const q = sub.pts[sub.pts.length - 1]; const L = Math.hypot(p[0] - q[0], p[1] - q[1]); if (L > 2 && L < 150) segs.push([q[0], q[1], p[0], p[1]]); sub.pts.push(p) } k += 2 }
        else if (op === OPS.curveTo) { if (sub) { sub.pts.push(ap(ctm, c[k], c[k + 1]), ap(ctm, c[k + 2], c[k + 3]), ap(ctm, c[k + 4], c[k + 5])); sub.curves++ } k += 6 }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { if (sub) { sub.pts.push(ap(ctm, c[k], c[k + 1]), ap(ctm, c[k + 2], c[k + 3])); sub.curves++ } k += 4 }
        else if (op === OPS.rectangle) { flush(); k += 4 }
        else if (op === OPS.closePath) { if (sub) sub.closed = true }
      }
      flush();
    }
  }
  return { circ, segs };
}
/* texto riscado: algum segmento atravessa a faixa do meio do texto cobrindo boa parte da largura */
function riscado(it, segs) {
  const x0 = it.x, x1 = it.x + it.w, yA = it.y - it.h * 0.7, yB = it.y - it.h * 0.05;
  for (const [ax, ay, bx, by] of segs) {
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx);
    const ov = Math.min(x1, sx1) - Math.max(x0, sx0); if (ov < Math.max(it.w * 0.5, 3)) continue;
    const mx = Math.max(Math.max(x0, sx0), Math.min((x0 + x1) / 2, Math.min(x1, sx1)));
    const t = bx === ax ? 0.5 : (mx - ax) / (bx - ax); const my = ay + (by - ay) * t;
    if (my >= yA && my <= yB) return true;
  }
  return false;
}
/* postes: número dentro de círculo (glifo "(" ou desenho) + estruturas próximas */
function lerPostes(items, W, H, geo) {
  const it = items.filter(i => i.str && i.str.trim()).map(i => ({ ...i, s: i.str.trim() }));
  const glifos = it.filter(i => i.s === '(').map(i => ({ x: i.x + i.w / 2, y: i.y - i.h * 0.35, r: i.h * 0.5, glifo: true, h: i.h }));
  const circ = (geo ? geo.circ : []).concat(glifos);
  const nums = it.filter(i => /^\d{1,3}$/.test(i.s));
  const postes = []; const usados = new Set(); const usadosIt = new Set();
  for (const n of nums) {
    const cx = n.x + n.w / 2, cy = n.y - n.h * 0.35;
    let best = null, bd = 1e9;
    for (const c of circ) { const d = Math.hypot(c.x - cx, c.y - cy); if (d < bd) { bd = d; best = c } }
    if (!best) continue;
    if (best.glifo) { if (bd > Math.max(9, n.h * 1.6) || best.h < n.h * 1.3) continue }
    else { if (bd > best.r * 0.6 || best.r < n.h * 0.45 || best.r > n.h * 2.5) continue }
    const num = parseInt(n.s, 10); if (usados.has(num)) continue; usados.add(num); usadosIt.add(n);
    postes.push({ n: num, px: best.glifo ? cx : best.x, py: best.glifo ? cy : best.y, r: best.glifo ? n.h : best.r });
  }
  // rótulos de estrutura: textos curtos que não são cabo, distância, código numérico, carimbo
  const CARIMBO = /^(PROJETO|PROJETISTA|FISCAL|CADASTRO|EMPREITEIRA|LOCAL|CLIENTE|OBRA|OSE|ODI|ODD|ODS|DATA|ESCALA|REF|FOLHA|APROVA|CREA|AVISAR|SOLICITAR)/i;
  const ehEstrutura = s => /^[A-Z0-9][A-Z0-9\-()\/.]*$/.test(s) && s.length <= 16 && (/\d/.test(s) || s.length <= 3)
    && !/^[XY][:;]/.test(s) && !/^[A-Z]{1,2}\d{3,}$/.test(s) && !/^\d+$/.test(s) && !/^\d{4,}/.test(s) && !/^\d+-\d+$/.test(s) && !/\d+X\d+/.test(s) && !CARIMBO.test(s);
  const cand = it.filter(i => !usadosIt.has(i) && i.s !== '(' && i.h < 12 && ehEstrutura(i.s));
  // blocos: pilha vertical de rótulos alinhados à esquerda
  cand.sort((a, b) => a.y - b.y);
  const blocos = [];
  for (const c of cand) {
    const b = blocos.find(b => Math.abs(b.x - c.x) < 6 && c.y - b.yUlt > 0 && c.y - b.yUlt < c.h * 2.8);
    if (b) { b.itens.push(c); b.yUlt = c.y } else blocos.push({ x: c.x, yIni: c.y, yUlt: c.y, itens: [c] });
  }
  const segs = geo ? geo.segs : [];
  for (const b of blocos) {
    // ponto do bloco mais próximo do poste
    let best = null, bd = 1e9;
    for (const p of postes) {
      const bx = Math.max(b.x, Math.min(p.px, b.x + Math.max(...b.itens.map(i => i.w))));
      const by = Math.max(b.yIni - b.itens[0].h, Math.min(p.py, b.yUlt));
      const d = Math.hypot(bx - p.px, by - p.py); if (d < bd) { bd = d; best = p }
    }
    if (!best || bd > 45) continue;
    if (best.bloco && best.blocoD <= bd) continue;
    best.bloco = b; best.blocoD = bd;
  }
  for (const p of postes) {
    const its = p.bloco ? p.bloco.itens : [];
    const est = its.map(i => ({ t: i.s, r: riscado(i, segs) }));
    p.estruturas = est;
    const ri = est.filter(e => e.r).length;
    p.acao = !est.length ? '' : ri === est.length ? 'retirar' : ri ? 'modificar' : 'instalar';
    p.nota = est.length ? (p.acao === 'retirar' ? 'Retirar: ' + est.map(e => e.t).join(' · ') :
      p.acao === 'modificar' ? 'Instalar: ' + est.filter(e => !e.r).map(e => e.t).join(' · ') + ' | Retirar: ' + est.filter(e => e.r).map(e => e.t).join(' · ') :
      'Instalar: ' + est.map(e => e.t).join(' · ')) : '';
  }
  return postes.sort((a, b) => a.n - b.n).map(p => ({ n: p.n, x: +(p.px / W).toFixed(5), y: +(p.py / H).toFixed(5), nota: p.nota, acao: p.acao, estruturas: p.estruturas }));
}
function analisarTexto(items,W,H,MUN,geo){
  const it=items.filter(i=>i.str&&i.str.trim()).map(i=>({...i,s:i.str.trim()}));
  const postes=lerPostes(items,W,H,geo);
  const LBL=['PROJETO:','PROJETISTA:','FISCAL:','CADASTRO:','EMPREITEIRA:','LOCAL:','CLIENTE:','OBRA:','OSE:','ODI:','ODD:','ODS:','DATA:','ESCALA:','REF:','FOLHA:','APROVAÇÃO:','CREA:'];
  const isLbl=s=>LBL.includes(s.toUpperCase())||/:$/.test(s);
  function campo(lbl){
    for(const l of it.filter(i=>i.s.toUpperCase()===lbl)){
      const row=it.filter(i=>i!==l&&Math.abs(i.y-l.y)<3.5&&i.x>l.x+1&&i.x<l.x+320).sort((a,b)=>a.x-b.x);
      const out=[];let lastX=l.x+l.w;
      for(const r of row){if(isLbl(r.s))break;if(r.x-lastX>40&&out.length)break;lastX=r.x+r.w;if(/^[^0-9]$/.test(r.s)||/^[a-z|]{1,2}$/.test(r.s))continue;out.push(r.s)}
      const v=out.join(' ').replace(/\s+/g,' ').replace(/\s+[A-Za-z|]$/,'').trim();
      if(v)return v;
    }
    return '';
  }
  const f={projeto:campo('PROJETO:'),cliente:campo('CLIENTE:'),descricao:campo('OBRA:'),local:campo('LOCAL:'),ose:campo('OSE:'),projetista:campo('PROJETISTA:'),dataProjeto:campo('DATA:')};
  f.projeto=(f.projeto.match(/\d{5,8}[A-Z]?/)||[f.projeto])[0];
  const txt=norm(f.local+' '+f.cliente+' '+f.descricao);let mun='';
  for(const m of MUN){const k=norm(m);if(k.length>3&&new RegExp('(^|[^A-Z])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^A-Z]|$)').test(txt)&&k.length>norm(mun).length)mun=m}
  const all=it.map(i=>i.s).join(' ');
  const m=all.match(/\(?\s*(\d{6}(?:[.,]\d+)?)\s*[,;]\s*(\d{7}(?:[.,]\d+)?)\s*\)?/);
  let utm=null;if(m){const e=parseFloat(m[1].replace(',','.')),n=parseFloat(m[2].replace(',','.'));if(e>150000&&e<850000&&n>6900000&&n<7600000)utm={e,n}}
  let ll=null;const md=all.match(/(-2[2-7][.,]\d{3,})\s*[,;]\s*(-(?:4[89]|5[0-4])[.,]\d{3,})/);if(md)ll={lat:parseFloat(md[1].replace(',','.')),lon:parseFloat(md[2].replace(',','.'))};
  return {postes,campos:f,municipio:mun,utm,ll};
}
function utmToLatLon(E,N,zone=22){
  const a=6378137,f=1/298.257223563,k0=0.9996,e2=f*(2-f),ep2=e2/(1-e2);
  const x=E-500000,y=N-10000000,M=y/k0,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const p1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const C1=ep2*Math.cos(p1)**2,T1=Math.tan(p1)**2,N1=a/Math.sqrt(1-e2*Math.sin(p1)**2),R1=a*(1-e2)/(1-e2*Math.sin(p1)**2)**1.5,D=x/(N1*k0);
  const lat=p1-(N1*Math.tan(p1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/Math.cos(p1);
  return {lat:lat*180/Math.PI,lon:(zone*6-183)+lon*180/Math.PI};
}

/* ================= instalar no celular ================= */
let promptInstalar = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; const el = $('#inst'); el && mostrarInstalar(el) });
function instalado() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone }
function mostrarInstalar(el) {
  if (!el || instalado() || lsGet('fisc.instOk', false)) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (promptInstalar) {
    el.innerHTML = `<div class="note ok-note" style="margin-top:10px;display:flex;gap:10px;align-items:center"><div style="flex:1">Instale o app no celular para abrir direto pelo ícone, até sem sinal.</div><button class="btn sm pri" id="instb">Instalar</button><button class="btn sm ghost" id="instx">×</button></div>`;
    $('#instb').onclick = async () => { promptInstalar.prompt(); const r = await promptInstalar.userChoice; promptInstalar = null; el.innerHTML = ''; if (r.outcome === 'accepted') toast('App instalado') };
  } else if (ios) {
    el.innerHTML = `<div class="note ok-note" style="margin-top:10px;display:flex;gap:10px;align-items:center"><div style="flex:1">Para instalar no iPhone: toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.</div><button class="btn sm ghost" id="instx">×</button></div>`;
  } else return;
  $('#instx').onclick = () => { lsSet('fisc.instOk', true); el.innerHTML = '' };
}

/* ================= início ================= */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
(async () => {
  // mostra o que já está no aparelho, depois atualiza
  for (const s of S.sess) { const raw = await carregarRaw(s.pref); if (raw.desde || Object.keys(raw.obras).length) S.carregado = true }
  montar(); await carregarFila(); reindex();
  route();
  if (S.sess.length) { await sincronizar(); enviarFila() }
})();

/* ================= documentos para assinatura (BMD, FF, vistoria) ================= */
const TIPOS_DOC = ['BMD parcial', 'BMD final', 'FF', 'Vistoria', 'Outro'];
const nomeDoc = d => d.tipo + (d.parcial ? ' nº ' + d.parcial : '') + (d.tipo === 'AES' && d.aes ? ' ' + d.aes : '');
const medTx = d => d.medicao ? ` · ${d.medicao.qtd} poste(s) · ${fmtUs(d.medicao.us)} US${d.medicao.novos != null ? ` (+${d.medicao.novos} desde a anterior)` : ''}` : '';
const docsPend = () => S.sess.reduce((n, s) => n + (((S.raw[s.pref] || {}).docs || {}).pendentes || 0), 0);
const docsTotal = () => S.sess.reduce((n, s) => n + (((S.raw[s.pref] || {}).docs || {}).total || 0), 0);
async function pdfLibA() { if (window.PDFLib) return window.PDFLib; await loadScript(LIB.pdflib); return window.PDFLib }
function b64Bytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u }
async function sha256Hex(bytes) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('') }
function baixarBytes(bytes, nome) { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
async function baixarDoc(s, id, versao, btn) {
  const t = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Baixando…' }
  try { const j = await api(s, 'docPdf', { id, versao }); baixarBytes(b64Bytes(j.b64), j.nome || 'documento.pdf') } catch (e) { toast(msgServidor(e), 1) }
  if (btn) { btn.disabled = false; btn.textContent = t }
}
const DOC_ST = d => d.status === 'assinado' ? `<span class="chip ok">assinado ${dtBR(d.assinadoEm)}</span>` : '<span class="chip alt">aguardando assinatura</span>';
async function listarDocs(filtro) {
  const L = []; let erro = '';
  for (const s of S.sess) {
    if (filtro && filtro.pref && s.pref !== filtro.pref) continue;
    try { const j = await api(s, 'documentos', filtro && filtro.obra ? { obra: filtro.obra } : {}); (j.documentos || []).forEach(d => L.push(Object.assign(d, { pref: s.pref }))) }
    catch (e) { erro = e.rede ? 'Sem conexão: os documentos precisam de internet.' : e.message }
  }
  return { L, erro };
}
function ligarDocBtns(root, L) {
  $$('[data-dl]', root).forEach(b => b.onclick = e => { e.stopPropagation(); const d = L.find(x => x.id === b.dataset.dl); baixarDoc(sessDe(d.pref), d.id, b.dataset.v, b) });
  $$('[data-dv]', root).forEach(b => b.onclick = e => { e.stopPropagation(); go('doc-' + b.dataset.dv) });
  $$('[data-drm]', root).forEach(b => b.onclick = async e => {
    e.stopPropagation(); if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar remoção'; return }
    const d = L.find(x => x.id === b.dataset.drm); b.disabled = true;
    try { await api(sessDe(d.pref), 'removerDocumento', { id: d.id }); delete DOCS_CACHE[d.obra]; toast('Documento removido'); sincronizar(); render() } catch (err) { toast(msgServidor(err), 1); b.disabled = false }
  });
}
/* Copel: todos os documentos */
async function vDocs(app) {
  app.innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0 12px 0 0">Assinaturas · BMD, FF e vistoria</h2>
    <select class="i" id="dst" style="width:auto"><option value="">Todos</option><option value="aguardando">Aguardando assinatura</option><option value="assinado">Assinados</option></select>
    <input class="i" id="dq" placeholder="Buscar projeto, PEP, empreiteira…" style="min-width:220px"></div>
    <p class="small muted" style="margin-top:0">Para enviar um documento, abra a obra no <a href="#historico">Histórico</a> e use “Documentos para assinatura”.</p><div id="dtb"><div class="empty">Carregando…</div></div></div>`;
  const { L, erro } = await listarDocs();
  if (S.view !== 'docs') return;
  const draw = () => {
    const q = ($('#dq').value || '').toLowerCase(), st = $('#dst').value;
    const V = L.filter(d => (!st || (st === 'assinado') === (d.status === 'assinado')) && (!q || [d.projeto, d.pep, d.empreiteira, d.tipo, d.nome].join(' ').toLowerCase().includes(q)));
    $('#dtb').innerHTML = erro && !L.length ? `<div class="empty">${esc(erro)}</div>` : V.length ? `<div style="overflow:auto"><table><thead><tr><th>Documento</th><th>Projeto</th><th>Empreiteira</th><th>Enviado</th><th>Situação</th><th></th></tr></thead><tbody>${V.map(d => `<tr class="cl" data-dv="${esc(d.id)}">
      <td><b>${esc(nomeDoc(d))}</b><div class="small muted">${esc(d.nome)}${esc(medTx(d))}</div></td><td>${esc(d.projeto)}${d.pep ? `<div class="small muted">PEP ${esc(d.pep)}</div>` : ''}</td><td>${esc(d.empreiteira)}</td>
      <td>${dtBR(d.enviadoEm)}<div class="small muted">${esc(d.enviadoPor || '')}</div></td><td>${DOC_ST(d)}${d.assinadoPor ? `<div class="small muted">${esc(d.assinadoPor)}</div>` : ''}</td>
      <td style="white-space:nowrap">${d.status === 'assinado' ? `<button class="btn sm pri" data-dl="${esc(d.id)}" data-v="assinado">Baixar assinado</button>` : `<button class="btn sm ghost" data-drm="${esc(d.id)}">Remover</button>`}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Nenhum documento${q || st ? ' com esse filtro' : ' enviado ainda'}.</div>`;
    ligarDocBtns(app, L);
  };
  $('#dq').oninput = draw; $('#dst').onchange = draw; draw();
  const box = document.createElement('div'); box.className = 'card'; box.style.marginTop = '14px'; box.innerHTML = '<h3>Assinaturas cadastradas pelas empreiteiras</h3><div class="small muted" id="aslst">Carregando…</div>'; app.appendChild(box);
  const AS = []; for (const s of S.sess.filter(s => s.papel !== 'empreiteira')) { try { ((await api(s, 'assinantes', {})).assinantes || []).forEach(a => AS.push(Object.assign(a, { pref: s.pref }))) } catch (e) { } }
  if (S.view !== 'docs') return;
  const al = $('#aslst'); al.classList.toggle('muted', !AS.length);
  al.innerHTML = AS.length ? `<table><thead><tr><th>Empreiteira</th><th>Responsável</th><th>Cadastrada</th><th>Último uso</th><th></th></tr></thead><tbody>${AS.map(a => `<tr><td>${esc(a.empresa)}</td><td><b>${esc(a.nome)}</b><div class="small muted">${esc(a.cargo || '')}</div></td><td>${dtBR(a.criadoEm)}</td><td>${a.ultimoUso ? dtBR(a.ultimoUso) : '—'}${a.bloqueado ? ' · <b style="color:var(--bad)">bloqueada</b>' : ''}</td><td>${sessDe(a.pref).papel === 'gestor' ? `<button class="btn sm ghost" data-rva="${esc(a.id)}">Revogar</button>` : ''}</td></tr>`).join('')}</tbody></table>` : 'Nenhuma empreiteira cadastrou assinatura ainda. O cadastro é feito pelo responsável da empresa, no app, com o código da empreiteira.';
  $$('[data-rva]', al).forEach(b => b.onclick = async () => { if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar'; return } const a = AS.find(x => x.id === b.dataset.rva); b.disabled = true; try { await api(sessDe(a.pref), 'revogarAssinante', { id: a.id }); toast('Assinatura revogada'); b.closest('tr').remove() } catch (e) { toast(msgServidor(e), 1); b.disabled = false } });
}
/* card na tela da obra (Histórico): enviar e acompanhar */
const DOCS_CACHE = {};
async function cardDocsObra(o) {
  const el = $('#docsobra'); if (!el) return;
  const s = sessObra(o); const pode = s && s.papel !== 'empreiteira'; const hist = S.view === 'hobra';
  const I = S.idx[o.id];
  const aprov = I ? [...I.postes.keys()].filter(k => fiscPoste(I, k) === 'aprovado') : [];
  const tipos = hist ? ['BMD final', 'FF', 'Vistoria', 'Outro', 'BMD parcial'] : (I && I.etapa === 'medida' ? ['FF', 'BMD parcial', 'Vistoria', 'Outro'] : ['BMD parcial', 'FF', 'Vistoria', 'Outro']);
  el.innerHTML = `<h3>${hist ? 'Documentos' : 'Medições e documentos'}</h3><div id="dresumo" class="small" style="margin-bottom:6px"></div><div id="dlist" class="small muted">Carregando…</div>
   ${pode ? `<div style="background:#f4f6f9;border-radius:10px;padding:10px;margin-top:10px"><div class="row2"><div><label class="f" style="margin-top:0">Tipo</label><select class="i" id="dtipo">${tipos.map(t => `<option>${t}</option>`).join('')}</select></div>
     <div><label class="f" style="margin-top:0">PDF</label><label class="btn sm ghost" style="display:block;text-align:center;cursor:pointer"><input type="file" accept="application/pdf" id="dfile" class="hidden"><span id="dfn">Escolher PDF</span></label></div></div>
     <div id="dinfo" class="small muted" style="margin-top:8px"></div>
     <button class="btn sm pri" id="denv" style="width:100%;margin-top:10px" disabled>Enviar para ${esc(o.empreiteira)} assinar</button></div>` : ''}`;
  const c = DOCS_CACHE[o.id]; let L, erro;
  if (c && Date.now() - c.t < 30000) ({ L, erro } = c); else { ({ L, erro } = await listarDocs({ obra: o.id, pref: o.pref })); if (!erro) DOCS_CACHE[o.id] = { t: Date.now(), L, erro } }
  const dl = $('#dlist'); if (!dl || getObra(S.obraId) !== o) return;
  const parciais = L.filter(d => d.tipo === 'BMD parcial' && d.medicao).sort((a, b) => (+a.parcial || 0) - (+b.parcial || 0));
  const ult = parciais[parciais.length - 1];
  const jaMedidos = new Set(ult && ult.medicao ? ult.medicao.postes || [] : []);
  const novos = aprov.filter(k => !jaMedidos.has(k));
  const usUlt = ult && ult.medicao ? ult.medicao.us || 0 : 0;
  if (!hist && I) $('#dresumo').innerHTML = parciais.length || novos.length
    ? `${parciais.length ? `<b>${parciais.length}</b> BMD parcial(is) emitido(s) · ` : ''}<b>${novos.length}</b> poste(s) aprovado(s) ainda sem BMD${novos.length ? ` (≈ ${fmtUs(Math.max(0, I.usMed - usUlt))} US)` : ''}`
    : '<span class="muted">Assim que o fiscal aprovar postes, já dá para emitir o BMD parcial.</span>';
  dl.innerHTML = erro && !L.length ? esc(erro) : L.length ? L.map(d => `<div class="docrow" data-dv="${esc(d.id)}"><div style="flex:1;min-width:0"><b>${esc(nomeDoc(d))}</b> ${DOC_ST(d)}<div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dBR(String(d.enviadoEm).slice(0, 10))}${medTx(d)} · ${esc(d.nome)}${d.assinadoPor ? ' · ' + esc(d.assinadoPor) : ''}</div></div>
    ${d.status === 'assinado' ? `<button class="btn sm pri" data-dl="${esc(d.id)}" data-v="assinado">Baixar</button>` : pode ? `<button class="btn sm ghost" data-drm="${esc(d.id)}">Remover</button>` : ''}</div>`).join('') : (hist ? 'Nenhum documento enviado.' : 'Nenhum BMD ou documento enviado ainda.');
  dl.classList.toggle('muted', !L.length);
  ligarDocBtns(el, L);
  if (!pode) return;
  let arq = null;
  const info = () => {
    const t = $('#dtipo').value; const b = $('#denv'); delete b.dataset.conf;
    b.textContent = t === 'FF' && !hist ? 'Enviar FF e encerrar a obra' : 'Enviar para ' + o.empreiteira + ' assinar'; b.style.background = '';
    $('#dinfo').innerHTML = t === 'BMD parcial' && I ? `Este será o <b>BMD parcial nº ${parciais.length + 1}</b>: ${novos.length} poste(s) aprovado(s) desde o anterior · total aprovado ${aprov.length} poste(s), ${fmtUs(I.usMed)} US.`
      : t === 'FF' && !hist && I ? (I.etapa === 'medida' ? 'Todos os postes estão aprovados. Ao enviar a FF a obra é encerrada e vai para o Histórico.' : `<b style="color:var(--bad)">Atenção:</b> ${I.tot - I.fis} poste(s) ainda sem aprovação. Ao enviar a FF a obra é encerrada mesmo assim.`)
      : t === 'BMD final' ? 'BMD final, emitido depois da FF.' : '';
  };
  $('#dtipo').onchange = info; info();
  $('#dfile').onchange = e => { arq = e.target.files[0] || null; $('#dfn').textContent = arq ? arq.name : 'Escolher PDF'; $('#denv').disabled = !arq };
  $('#denv').onclick = async e => {
    const b = e.currentTarget; if (!arq) return; if (arq.size > 20e6) { toast('PDF muito grande (máx. 20 MB)', 1); return }
    const t = $('#dtipo').value;
    if (t === 'FF' && !hist && !b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar: enviar a FF e encerrar'; b.style.background = 'var(--bad)'; return }
    b.disabled = true; b.textContent = 'Enviando…';
    try {
      const extra = t === 'BMD parcial' && I ? { medicao: { postes: aprov, qtd: aprov.length, us: +I.usMed.toFixed(3), novos: novos.length } } : {};
      const j = await api(s, 'enviarDocumento', Object.assign({ obra: o.id, tipo: t, pdf: { b64: await blobB64(arq), nome: arq.name } }, extra));
      delete DOCS_CACHE[o.id];
      if (j.encerrada) { toast('FF enviada: obra encerrada e movida para o Histórico'); await sincronizar(); go('historico'); return }
      toast(t === 'BMD parcial' ? `BMD parcial nº ${j.documento.parcial} enviado para assinatura` : 'Documento enviado: a empreiteira já pode assinar'); sincronizar(); cardDocsObra(o);
    } catch (err) { toast(msgServidor(err), 1); b.disabled = false; info() }
  };
}
/* Empreiteira: lista para assinar */
async function vAssinar(app) {
  app.innerHTML = `<div class="fhead"><div class="who"><div><b>Documentos para assinar</b><div class="small muted">AES, BMD, FF e vistoria enviados pela Copel</div></div><a class="btn sm ghost" href="#campo" style="text-decoration:none">← Obras</a></div></div><div style="padding:0 14px"><a href="#assinatura" class="small">✍️ Assinatura cadastrada da empresa</a></div><div class="flist" id="alist"><div class="fcard empty">Carregando…</div></div>`;
  const { L, erro } = await listarDocs();
  if (S.view !== 'assinar') return;
  L.sort((a, b) => (a.status === 'assinado') - (b.status === 'assinado') || String(b.enviadoEm).localeCompare(String(a.enviadoEm)));
  $('#alist').innerHTML = erro && !L.length ? `<div class="fcard empty">${esc(erro)}</div>` : L.length ? L.map(d => `<div class="fcard" data-dv="${esc(d.id)}"><div class="t"><b>${esc(nomeDoc(d))} · ${esc(d.projeto)}</b>${DOC_ST(d)}</div>
     <div class="s">${esc(d.nome)}${d.pep ? '<br>PEP ' + esc(d.pep) : ''}<br>Enviado ${dtBR(d.enviadoEm)}</div>
     <div style="margin-top:8px">${d.status === 'assinado' ? `<button class="btn sm pri" data-dl="${esc(d.id)}" data-v="assinado">⬇️ Baixar PDF assinado</button>` : `<button class="btn sm dk" data-dv="${esc(d.id)}">✍️ Abrir e assinar</button>`}</div></div>`).join('')
    : `<div class="fcard empty">Nenhum documento para assinar.</div>`;
  ligarDocBtns(app, L);
  $$('.fcard[data-dv]', app).forEach(c => c.onclick = () => go('doc-' + c.dataset.dv));
}
/* Visualizar (e assinar) um documento */
async function vDoc(app) {
  const id = S.docId; const campo = S.mode === 'campo';
  app.innerHTML = `<div class="${campo ? 'fhead' : ''}"><div class="who card" style="display:flex;align-items:center;gap:10px;padding:10px 12px"><a class="btn sm ghost" href="#${campo ? 'assinar' : 'docs'}" style="text-decoration:none">←</a><div style="flex:1;min-width:0" id="dtit"><b>Carregando documento…</b></div></div></div>
   <div id="dpages" class="dpages"></div><div id="dbar"></div>`;
  const { L } = await listarDocs(); const d = L.find(x => x.id === id);
  if (S.view !== 'doc' || S.docId !== id) return;
  if (!d) { $('#dtit').innerHTML = '<b>Documento não encontrado</b>'; return }
  const s = sessDe(d.pref);
  $('#dtit').innerHTML = `<b>${esc(nomeDoc(d))} · projeto ${esc(d.projeto)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.nome)} · ${d.status === 'assinado' ? 'assinado por ' + esc(d.assinadoPor) + ' em ' + dtBR(d.assinadoEm) : 'aguardando assinatura de ' + esc(d.empreiteira)}</div>`;
  let j; try { j = await api(s, 'docPdf', { id, versao: d.status === 'assinado' ? 'assinado' : 'original' }) } catch (e) { $('#dpages').innerHTML = `<div class="card empty">${esc(msgServidor(e))}</div>`; return }
  const bytes = b64Bytes(j.b64);
  const podeAssinar = s.papel === 'empreiteira' && d.status !== 'assinado';
  const bar = $('#dbar');
  bar.innerHTML = `<div class="dsign">${podeAssinar ? `<button class="btn pri" id="dass" style="flex:1;padding:14px;font-size:15px">✍️ Assinar documento</button>` : d.status === 'assinado' ? `<button class="btn pri" id="dbx" style="flex:1;padding:12px">⬇️ Baixar PDF assinado</button>` : `<span class="small muted" style="flex:1">Aguardando a assinatura da empreiteira. O download do original não fica disponível para ela antes de assinar.</span>`}</div>`;
  $('#dbx') && ($('#dbx').onclick = () => baixarBytes(bytes, j.nome));
  $('#dass') && ($('#dass').onclick = () => posicionarAssinatura(d, s, bytes));
  try {
    const lib = await pdfLib(); const doc = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false, disableFontFace: true }).promise;
    const host = $('#dpages'); const W = Math.min(host.clientWidth || innerWidth, 1100) - 4;
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      if (S.view !== 'doc') return;
      const pg = await doc.getPage(i); const v1 = pg.getViewport({ scale: 1 }); const sc = W / v1.width * Math.min(2, devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: sc }); const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; cv.style.width = W + 'px';
      const wr = document.createElement('div'); wr.className = 'pgw'; wr.dataset.i = i - 1; wr.appendChild(cv); host.appendChild(wr);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
    if (doc.numPages > 30) host.insertAdjacentHTML('beforeend', `<div class="small muted" style="text-align:center;padding:8px">Mostrando 30 de ${doc.numPages} páginas.</div>`);
  } catch (e) { console.error(e); $('#dpages').innerHTML = `<div class="card empty">Não consegui mostrar o PDF (${esc(e.message || e)}).</div>` }
}
/* ---------- assinatura cadastrada da empreiteira ---------- */
const assTotal = () => S.sess.reduce((n, s) => n + (((S.raw[s.pref] || {}).docs || {}).assinantes || 0), 0);
const IMG_ASS = {};
async function imgAss(s, id) { if (!IMG_ASS[id]) { const j = await api(s, 'imgAssinante', { id }); IMG_ASS[id] = 'data:image/png;base64,' + j.b64 } return IMG_ASS[id] }
const TERMO_ASS = 'Declaro que sou responsável pela empresa (proprietário, sócio, supervisor ou procurador) e que a assinatura acima e o PIN são pessoais e intransferíveis. Reconheço como válidos, para todos os fins, os documentos (BMD, FF, vistoria e outros) que eu assinar por este aplicativo com esta assinatura e este PIN, nos termos do art. 10, § 2º, da MP 2.200-2/2001.';
function padAssinatura(cv) {
  const dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f4b';
  let des = false, vazio = true, last = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } };
  cv.onpointerdown = e => { des = true; last = pt(e); try { cv.setPointerCapture(e.pointerId) } catch (er) { } ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 7); ctx.fillStyle = '#0b1f4b'; ctx.fill(); vazio = false; e.preventDefault() };
  cv.onpointermove = e => { if (!des) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; e.preventDefault() };
  cv.onpointerup = cv.onpointercancel = () => { des = false };
  return {
    vazio: () => vazio,
    limpar() { ctx.clearRect(0, 0, cv.width, cv.height); vazio = true },
    png() {   // recorta o desenho e devolve PNG (base64, fundo transparente)
      const D = ctx.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (D[(y * cv.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      if (x1 <= x0 || y1 <= y0) return null;
      const pad = 6 * dpr; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width, x1 + pad); y1 = Math.min(cv.height, y1 + pad);
      const k = Math.min(1, 700 / (x1 - x0)); const o = document.createElement('canvas'); o.width = Math.round((x1 - x0) * k); o.height = Math.round((y1 - y0) * k);
      o.getContext('2d').drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, o.width, o.height);
      return o.toDataURL('image/png').split(',')[1];
    }
  };
}
async function vAssinatura(app) {
  const s = S.sess.find(x => x.papel === 'empreiteira');
  if (!s) { app.innerHTML = `<div class="card empty">O cadastro de assinatura é feito com o código da empreiteira.</div>`; return }
  const volta = sessionStorage.getItem('fisc.voltarDoc');
  app.innerHTML = `<div class="fhead"><div class="who"><div><b>Assinatura da ${esc(s.empresa)}</b><div class="small muted">Usada para assinar BMD, FF e vistoria no app</div></div><a class="btn sm ghost" href="#${volta ? 'doc-' + volta : 'campo'}" style="text-decoration:none">← Voltar</a></div></div>
   <div class="flist"><div class="fcard" id="alst"><b>Assinaturas cadastradas</b><div class="small muted" style="margin-top:6px">Carregando…</div></div>
   <div class="fcard"><b>Cadastrar assinatura do responsável</b><div class="small muted">Dono, sócio ou supervisor da empresa. Faça uma vez; depois é só escolher o lugar no documento e digitar o PIN.</div>
    <label class="f">Nome completo</label><input class="i" id="anm" value="${esc(S.nome || '')}" autocomplete="name">
    <label class="f">Cargo</label><input class="i" id="acg" placeholder="Ex.: Proprietário, Supervisor de obras">
    <label class="f">Assinatura <span class="muted">(desenhe com o dedo)</span></label><canvas id="apad" class="sigpad"></canvas>
    <div style="display:flex;justify-content:flex-end"><button class="btn sm ghost" id="alimpa">Limpar</button></div>
    <div class="row2"><div><label class="f">PIN (6 números)</label><input class="i" id="apin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div><div><label class="f">Repita o PIN</label><input class="i" id="apin2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div></div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:12.5px;line-height:1.4"><input type="checkbox" id="atermo" style="width:22px;height:22px;flex:none;margin-top:1px"><span>${esc(TERMO_ASS)}</span></label>
    <button class="btn pri" id="asalva" style="width:100%;margin-top:14px;padding:13px">Salvar assinatura</button></div></div>`;
  const pad = padAssinatura($('#apad'));
  $('#alimpa').onclick = () => pad.limpar();
  const lista = async () => {
    let L = []; try { L = (await api(s, 'assinantes', {})).assinantes || [] } catch (e) { $('#alst').innerHTML = `<b>Assinaturas cadastradas</b><div class="small muted">${esc(msgServidor(e))}</div>`; return }
    $('#alst').innerHTML = `<b>Assinaturas cadastradas</b>` + (L.length ? L.map(a => `<div class="docrow" style="cursor:default"><img data-img="${esc(a.id)}" class="sigmini" alt=""><div style="flex:1;min-width:0"><b>${esc(a.nome)}</b><div class="small muted">${esc(a.cargo || '')} · desde ${dtBR(a.criadoEm)}${a.bloqueado ? ' · <b style="color:var(--bad)">bloqueada (PIN)</b>' : ''}</div></div><button class="btn sm ghost" data-rv="${esc(a.id)}">Excluir</button></div>`).join('') : `<div class="small muted" style="margin-top:6px">Nenhuma ainda. Cadastre abaixo para poder assinar os documentos.</div>`);
    $$('[data-img]', $('#alst')).forEach(async im => { try { im.src = await imgAss(s, im.dataset.img) } catch (e) { } });
    $$('[data-rv]', $('#alst')).forEach(b => b.onclick = async () => { if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar'; return } b.disabled = true; try { await api(s, 'revogarAssinante', { id: b.dataset.rv }); toast('Assinatura excluída'); sincronizar(); lista() } catch (e) { toast(msgServidor(e), 1); b.disabled = false } });
  };
  lista();
  $('#asalva').onclick = async e => {
    const nome = $('#anm').value.trim(), pin = $('#apin').value;
    if (nome.length < 5) return toast('Informe o nome completo', 1);
    if (pad.vazio()) return toast('Desenhe a assinatura', 1);
    if (!/^\d{6}$/.test(pin)) return toast('O PIN deve ter 6 números', 1);
    if (pin !== $('#apin2').value) return toast('Os PINs não conferem', 1);
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return toast('Escolha um PIN menos óbvio', 1);
    if (!$('#atermo').checked) return toast('Leia e aceite o termo', 1);
    const img = pad.png(); if (!img) return toast('Desenhe a assinatura', 1);
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Salvando…';
    try {
      await api(s, 'cadastrarAssinante', { nome, cargo: $('#acg').value.trim(), pin, img, aceite: true });
      S.nome = S.nome || nome; toast('Assinatura cadastrada'); await sincronizar();
      if (volta) { sessionStorage.removeItem('fisc.voltarDoc'); go('doc-' + volta) } else vAssinatura(app);
    } catch (err) { toast(msgServidor(err), 1); b.disabled = false; b.textContent = 'Salvar assinatura' }
  };
}
/* ---------- assinar: escolher o lugar + PIN ---------- */
async function posicionarAssinatura(d, s, bytes) {
  const bar = $('#dbar'); bar.innerHTML = `<div class="dsign"><span class="small muted">Carregando assinatura…</span></div>`;
  let L = []; try { L = ((await api(s, 'assinantes', {})).assinantes || []).filter(a => !a.bloqueado) } catch (e) { toast(msgServidor(e), 1); vDoc($('#app')); return }
  if (!L.length) { sessionStorage.setItem('fisc.voltarDoc', d.id); toast('Primeiro cadastre a assinatura do responsável'); go('assinatura'); return }
  let A = L[0]; let src = await imgAss(s, A.id);
  const pags = $$('#dpages .pgw'); if (!pags.length) { toast('Aguarde o documento carregar', 1); vDoc($('#app')); return }
  const POS = { i: pags.length - 1, fx: .72, fy: .86, fw: .26, ar: 3 };
  const ov = document.createElement('img'); ov.className = 'sigov'; ov.src = src;
  const desenhar = () => { const wr = pags[POS.i]; wr.appendChild(ov); ov.style.left = (POS.fx - POS.fw / 2) * 100 + '%'; ov.style.top = POS.fy * 100 + '%'; ov.style.width = POS.fw * 100 + '%'; ov.style.transform = 'translateY(-50%)' };
  ov.onload = () => { POS.ar = ov.naturalWidth / ov.naturalHeight || 3 };
  desenhar(); pags[POS.i].scrollIntoView({ block: 'center', behavior: 'smooth' });
  const marcar = e => { const wr = e.currentTarget; const r = wr.getBoundingClientRect(); POS.i = +wr.dataset.i; POS.fx = (e.clientX - r.left) / r.width; POS.fy = (e.clientY - r.top) / r.height; desenhar() };
  pags.forEach(w => { w.classList.add('pos'); w.onclick = marcar });
  bar.innerHTML = `<div class="dsign" style="flex-wrap:wrap"><div class="small" style="width:100%"><b>Toque no documento onde vai a assinatura</b> (normalmente no campo da empreiteira).</div>
    ${L.length > 1 ? `<select class="i" id="psig" style="flex:1;min-width:0">${L.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('')}</select>` : `<span class="small" style="flex:1">${esc(A.nome)}</span>`}
    <button class="btn sm ghost" id="pmen" title="Diminuir">A−</button><button class="btn sm ghost" id="pmai" title="Aumentar">A+</button><button class="btn sm ghost" id="pcan">Cancelar</button><button class="btn pri" id="pok">Continuar</button></div>`;
  $('#psig') && ($('#psig').onchange = async e => { A = L.find(a => a.id === e.target.value); ov.src = src = await imgAss(s, A.id) });
  $('#pmen').onclick = () => { POS.fw = Math.max(.1, POS.fw - .04); desenhar() };
  $('#pmai').onclick = () => { POS.fw = Math.min(.6, POS.fw + .04); desenhar() };
  $('#pcan').onclick = () => { ov.remove(); pags.forEach(w => { w.classList.remove('pos'); w.onclick = null }); vDoc($('#app')) };
  $('#pok').onclick = () => confirmarAssinatura(d, s, bytes, A, src, POS);
}
function confirmarAssinatura(d, s, bytes, A, src, POS) {
  openLayer(`<div class="ov" id="asov" style="align-items:flex-end;padding:0"><div class="sheet" style="width:100%"><div class="grab"></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h4>Assinar ${esc(d.tipo)} · ${esc(d.projeto)}</h4><button class="btn sm ghost" id="asx">Voltar</button></div>
    <div style="display:flex;gap:12px;align-items:center;background:#f4f6f9;border-radius:10px;padding:10px;margin-top:6px"><img src="${src}" class="sigmini" style="width:120px;height:48px"><div><b>${esc(A.nome)}</b><div class="small muted">${esc(A.cargo || '')} · ${esc(s.empresa)}</div></div></div>
    <label class="f">PIN da assinatura</label><input class="i" id="aspin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" style="font-size:20px;letter-spacing:6px">
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:13.5px"><input type="checkbox" id="asck" style="width:22px;height:22px;flex:none;margin-top:1px"><span>Li o documento e o assino em nome da ${esc(s.empresa)}.</span></label>
    <button class="btn pri" id="asok" style="width:100%;margin-top:16px;padding:14px;font-size:15px" disabled>Assinar agora</button>
    <div class="small muted" style="margin-top:8px">O PDF assinado recebe a sua assinatura no lugar escolhido, um carimbo em cada página e uma folha de assinatura com data e hora, ID e a impressão digital (SHA-256) do documento.</div></div></div>`);
  const val = () => $('#asok').disabled = !(/^\d{6}$/.test($('#aspin').value) && $('#asck').checked);
  $('#aspin').oninput = val; $('#asck').onchange = val; setTimeout(() => $('#aspin') && $('#aspin').focus(), 200);
  $('#asx').onclick = closeLayer;
  $('#asok').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Assinando…';
    try {
      const hashOriginal = await sha256Hex(bytes);
      if (hashOriginal !== d.hash) throw new Error('o documento recebido não confere com o original');
      const quando = new Date();
      const assinado = await carimbarPdf(bytes, { nome: A.nome, cargo: A.cargo, empresa: s.empresa, quando, id: d.id, tipo: d.tipo, projeto: d.projeto, pep: d.pep, arquivo: d.nome, hash: hashOriginal, chave: String(s.chave).slice(-4), div: s.div, sig: Object.assign({ png: b64Bytes(src.split(',')[1]) }, POS) });
      b.textContent = 'Enviando…';
      await api(s, 'assinarDocumento', { id: d.id, assinante: A.id, pin: $('#aspin').value, hashOriginal, assinadoEm: quando.toISOString(), dispositivo: navigator.userAgent, pdf: { b64: await blobB64(new Blob([assinado])) } });
      closeLayer(); toast('Documento assinado');
      $$('#dpages .pgw').forEach(w => { w.classList.remove('pos'); w.onclick = null });
      $('#dbar').innerHTML = `<div class="dsign"><button class="btn pri" id="dbx" style="flex:1;padding:12px">⬇️ Baixar PDF assinado</button></div>`;
      $('#dbx').onclick = () => baixarBytes(assinado, 'ASSINADO_' + d.nome);
      sincronizar();
    } catch (err) { console.error(err); b.disabled = false; b.textContent = 'Assinar agora'; $('#aspin').value = ''; val(); toast(err.rede ? 'Sem conexão: a assinatura precisa de internet.' : 'Não foi possível assinar: ' + (err.message || err), 1) }
  };
}
/** Carimba cada página, coloca a assinatura no lugar escolhido e acrescenta a folha de assinatura (pdf-lib, no próprio aparelho). */
async function carimbarPdf(bytes, a) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await pdfLibA();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const ok = t => String(t || '').normalize('NFC').replace(/[^\x20-\x7E -ÿ]/g, '?');
  const pad = n => String(n).padStart(2, '0'); const q = a.quando;
  const dataTx = `${pad(q.getDate())}/${pad(q.getMonth() + 1)}/${q.getFullYear()} ${pad(q.getHours())}:${pad(q.getMinutes())}:${pad(q.getSeconds())}`;
  const quem = a.nome + (a.cargo ? ', ' + a.cargo : '');
  const carimbo = ok(`Assinado eletronicamente por ${quem} (${a.empresa}) em ${dataTx} - ID ${a.id} - SHA-256 ${a.hash.slice(0, 16)}...`);
  const cor = rgb(0.05, 0.25, 0.55);
  const pages = doc.getPages();
  for (const pg of pages) {
    const { width: w, height: h } = pg.getSize(); const ang = ((pg.getRotation().angle % 360) + 360) % 360;
    const comp = ang === 90 || ang === 270 ? h : w; let sz = 6.5; while (sz > 4 && f.widthOfTextAtSize(carimbo, sz) > comp - 24) sz -= .25;
    const pos = ang === 90 ? { x: w - 7, y: 12, r: 90 } : ang === 180 ? { x: w - 12, y: h - 7, r: 180 } : ang === 270 ? { x: 7, y: h - 12, r: 270 } : { x: 12, y: 7, r: 0 };
    pg.drawText(carimbo, { x: pos.x, y: pos.y, size: sz, font: f, color: cor, rotate: degrees(pos.r) });
  }
  let img = null;
  if (a.sig && pages[a.sig.i]) {   // assinatura desenhada no lugar que a pessoa tocou
    img = await doc.embedPng(a.sig.png);
    const pg = pages[a.sig.i]; const cb = pg.getCropBox(); const w = cb.width, h = cb.height;
    const ang = ((pg.getRotation().angle % 360) + 360) % 360; const rot = ang === 90 || ang === 270;
    const DW = rot ? h : w, DH = rot ? w : h;
    // (u, v) = ponto na página como aparece na tela (origem no canto de cima, à esquerda) → coordenadas do PDF
    const M = (u, v) => ang === 90 ? { x: v, y: u } : ang === 180 ? { x: w - u, y: v } : ang === 270 ? { x: w - v, y: h - u } : { x: u, y: h - v };
    const sw = a.sig.fw * DW, sh = sw * img.height / img.width;
    const u0 = a.sig.fx * DW - sw / 2, vC = a.sig.fy * DH;
    const p0 = M(u0, vC + sh / 2);
    pg.drawImage(img, { x: cb.x + p0.x, y: cb.y + p0.y, width: sw, height: sh, rotate: degrees(ang) });
    const tsz = Math.max(4.5, Math.min(7, sw / 32)); const lin = ok(`${quem} - ${dataTx}`);
    const p1 = M(u0, vC + sh / 2 + tsz + 1.5);
    pg.drawText(lin, { x: cb.x + p1.x, y: cb.y + p1.y, size: tsz, font: f, color: cor, rotate: degrees(ang) });
  }
  const pg = doc.addPage([595.28, 841.89]); let y = 762;
  const tx = (t, o = {}) => { pg.drawText(ok(t), { x: o.x || 56, y, size: o.size || 10.5, font: o.b ? fb : f, color: o.c || rgb(0.1, 0.12, 0.16) }); y -= o.gap ?? 17 };
  pg.drawRectangle({ x: 40, y: 40, width: 515.28, height: 761.89, borderColor: cor, borderWidth: 1.2 });
  tx('FOLHA DE ASSINATURA ELETRÔNICA', { b: true, size: 16, c: cor, gap: 26 });
  tx(`Fiscalização de Obras · Copel · ${a.div || ''}`, { size: 10, gap: 30 });
  const campos = [['Documento', `${a.tipo} - ${a.arquivo}`], ['Projeto', a.projeto], ['PEP', a.pep || '-'], ['Assinado por', a.nome], ['Cargo', a.cargo || '-'], ['Empresa', a.empresa], ['Data e hora', dataTx + ' (horário do aparelho)'], ['ID da assinatura', a.id], ['Código de acesso', 'final ' + a.chave], ['Confirmação', 'PIN pessoal do signatário']];
  for (const [k, v] of campos) { tx(k, { b: true, gap: 0 }); tx(v, { x: 190 }) }
  if (img) { const sw = 170, sh = sw * img.height / img.width; y -= 4; pg.drawImage(img, { x: 190, y: y - sh + 10, width: sw, height: sh }); tx('Assinatura', { b: true, gap: sh + 4 }) }
  y -= 8; tx('SHA-256 do documento original', { b: true, gap: 15 }); tx(a.hash.slice(0, 32), { x: 56, size: 10 }); tx(a.hash.slice(32), { x: 56, size: 10, gap: 28 });
  const aviso = 'Assinatura eletrônica realizada no app Fiscalização de Obras com a assinatura cadastrada pelo signatário, confirmada pelo PIN pessoal dele e pelo código de acesso da empresa, que aceitou o termo de reconhecimento da validade desta forma de assinatura (MP 2.200-2/2001, art. 10, § 2º). As páginas anteriores reproduzem o documento original enviado pela Copel; a integridade dele pode ser conferida pelo SHA-256 acima. O registro da assinatura fica guardado no sistema da Copel.';
  let linha = ''; for (const w of ok(aviso).split(' ')) { if (f.widthOfTextAtSize(linha + ' ' + w, 9.5) > 480) { tx(linha, { size: 9.5, gap: 13 }); linha = w } else linha = linha ? linha + ' ' + w : w } if (linha) tx(linha, { size: 9.5 });
  doc.setModificationDate(q); doc.setProducer('Fiscalização de Obras · Copel');
  return await doc.save();
}

/* ================= fluxo do processo (BPMN) ================= */
const FLUXO = { src: './fluxo.svg?v=3', w: 4228, h: 718 };
function vFluxo(app) {
  const campo = S.mode === 'campo';
  app.innerHTML = `<div class="${campo ? 'fhead' : ''}" style="${campo ? '' : 'margin-bottom:12px'}"><div class="${campo ? 'who' : 'card'}">
     ${campo ? `<div><b>Como funciona o fluxo</b><div class="small muted">Arraste e use + / − para ver os detalhes</div></div><a class="btn sm ghost" href="#campo" style="text-decoration:none">← Voltar</a>`
      : `<h2 style="margin:0">Fluxo da fiscalização de obras</h2><div class="small muted">Do PEP liberado ao encerramento: quem faz cada etapa. Arraste e use + / − para ver os detalhes.</div>`}</div></div>
   ${campo ? '' : '<div class="card" id="armz" style="margin-bottom:12px"><div class="small muted">Carregando armazenamento…</div></div>'}
   <div id="fvw" style="height:${campo ? 'calc(100vh - 120px)' : 'calc(100vh - 290px)'};min-height:380px;${campo ? 'margin:0 10px' : ''}"></div>`;
  if (!campo) cardArmazenamento();
  const host = $('#fvw');
  const v = Viewer(host, { img: FLUXO.src, iw: FLUXO.w, ih: FLUXO.h, getMarkers: () => [] });
  // abre com a altura do fluxo preenchendo a tela, a partir do início (arraste para o lado)
  setTimeout(() => { const r = host.getBoundingClientRect(); if (!r.width) return; const zz = Math.min(r.height / FLUXO.h * .94, 1.1); v.focus((r.width / 2) / (FLUXO.w * zz), .5, zz) }, 200);
}

/* ================= armazenamento (Drive da conta da divisão + células da planilha) ================= */
const ARM_ALERTA = 0.8;
async function lerArmazenamento(forcar) {
  const k = 'fisc.arm'; let c = null; try { c = JSON.parse(sessionStorage.getItem(k) || 'null') } catch (e) { }
  if (!forcar && c && Date.now() - c.t < 30 * 60000) return c.L;
  const L = []; const vistos = new Set();
  for (const s of S.sess.filter(s => s.papel !== 'empreiteira')) {
    if (vistos.has(s.pref)) continue; vistos.add(s.pref);
    try { const j = await api(s, 'armazenamento', {}); L.push({ div: s.div, pref: s.pref, drive: j.drive, planilha: j.planilha, em: j.em }) } catch (e) { L.push({ div: s.div, pref: s.pref, erro: e.rede ? 'sem conexão' : (/ação desconhecida/.test(e.message || '') ? 'publique o Codigo.gs novo' : e.message) }) }
  }
  try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), L })) } catch (e) { }
  return L;
}
const gb = b => (b / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: b < 1073741824 * 10 ? 2 : 1 }) + ' GB';
const mi = n => (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi';
function usoArm(a) {
  const d = a.drive && a.drive.limite ? a.drive.usado / a.drive.limite : null;
  const p = a.planilha ? a.planilha.celulas / a.planilha.limite : null;
  return { d, p, max: Math.max(d || 0, p || 0) };
}
function barraArm(rot, frac, tx) {
  const cor = frac >= ARM_ALERTA ? 'var(--bad)' : frac >= .6 ? 'var(--alt)' : 'var(--ok)';
  return `<div style="flex:1;min-width:240px"><div style="display:flex;justify-content:space-between" class="small"><b>${rot}</b><span style="color:${cor};font-weight:700">${fmt1(frac * 100)}%</span></div>
    <div class="bar" style="height:10px;margin:5px 0"><i style="width:${Math.min(100, frac * 100)}%;background:${cor}"></i></div><div class="small muted">${tx}</div></div>`;
}
async function cardArmazenamento(forcar) {
  const el = $('#armz'); if (!el) return;
  const L = await lerArmazenamento(forcar); if (!$('#armz')) return;
  el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><h3 style="margin:0;flex:1">Armazenamento</h3><span class="small muted">${L[0] && L[0].em ? 'lido às ' + new Date(L[0].em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span><button class="btn sm ghost" id="armup">Atualizar</button></div>` +
    L.map(a => { if (a.erro) return `<div class="small"><b>${esc(a.div)}</b> · <span class="muted">${esc(a.erro)}</span></div>`; const u = usoArm(a);
      return `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">${L.length > 1 ? `<b style="min-width:70px">${esc(a.div)}</b>` : ''}
        ${u.d != null ? barraArm('Google Drive da conta', u.d, `${gb(a.drive.usado)} de ${gb(a.drive.limite)} · fotos, PDFs, plantas e documentos (o Gmail da conta também conta)`) : '<div class="small muted">Drive: não foi possível ler</div>'}
        ${barraArm('Planilha', u.p, `${mi(a.planilha.celulas)} de 10 mi de células (limite do Google Sheets)`)}</div>
        ${u.max >= ARM_ALERTA ? `<div class="note" style="margin-top:8px;background:#fee2e2;border-color:#fecaca;color:#991b1b">⚠️ ${esc(a.div)} passou de ${ARM_ALERTA * 100}% em ${u.d >= ARM_ALERTA ? 'Drive' : 'planilha'}. É hora de planejar a limpeza ou a migração (arquivar fotos antigas, outra conta ou GCP).</div>` : ''}`;
    }).join('<hr style="border:0;border-top:1px solid var(--ln);margin:10px 0">');
  $('#armup').onclick = () => { el.innerHTML = '<div class="small muted">Atualizando…</div>'; cardArmazenamento(true) };
}
async function alertaArmazenamento(app) {
  if (!S.sess.some(s => s.papel === 'gestor')) return;
  const L = await lerArmazenamento(); if (S.view !== 'painel') return;
  const altos = L.filter(a => !a.erro && usoArm(a).max >= ARM_ALERTA); if (!altos.length || $('#armalert')) return;
  const d = document.createElement('a'); d.id = 'armalert'; d.href = '#fluxo'; d.className = 'note';
  d.style.cssText = 'display:block;margin-bottom:12px;background:#fee2e2;border-color:#fecaca;color:#991b1b;text-decoration:none';
  d.innerHTML = `⚠️ Armazenamento alto: ${altos.map(a => `${esc(a.div)} em ${fmt1(usoArm(a).max * 100)}%`).join(' · ')}. Toque para ver os detalhes.`;
  app.prepend(d);
}

/* ================= PDE / PLV: pedido da empreiteira → análise do fiscal ================= */
const TIPOS_PDE = ['PDE', 'PLV', 'DEC Voluntário'];
const PDE_ST = { solicitado: ['alt', 'aguardando fiscal'], aprovado: ['ok', 'aprovado'], devolvido: ['bad', 'devolvido'], cancelado: ['', 'cancelado'] };
const pdeChip = d => `<span class="chip ${PDE_ST[d.status] ? PDE_ST[d.status][0] : ''}">${PDE_ST[d.status] ? PDE_ST[d.status][1] : esc(d.status)}</span>`;
const pdeResumo = () => S.sess.reduce((a, s) => { const r = (S.raw[s.pref] || {}).pde || {}; a.sol += r.solicitados || 0; a.dev += r.devolvidos || 0; a.tot += r.total || 0; return a }, { sol: 0, dev: 0, tot: 0 });
const fiscaisDe = pref => (S.raw[pref] || {}).fiscais || [];
const HORAS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String(i % 4 * 15).padStart(2, '0')}`);
const amanha = () => { const d = new Date(Date.now() + 864e5); return d.toISOString().slice(0, 10) };
async function listarPdes(filtro) {
  const L = []; let erro = '';
  for (const s of S.sess) { try { ((await api(s, 'pdes', filtro || {})).pdes || []).forEach(d => L.push(Object.assign(d, { pref: s.pref }))) } catch (e) { erro = e.rede ? 'Sem conexão.' : e.message } }
  return { L, erro };
}
function folhasTx(o, keys) {
  const fs = [...new Set(keys.map(k => folhaDe(o, k) + 1))].sort((a, b) => a - b);
  if (!fs.length) return '';
  return fs.length > 1 && fs[fs.length - 1] - fs[0] === fs.length - 1 ? `${fs[0]}-${fs[fs.length - 1]}` : fs.join(', ');
}
function servicosSugeridos(o, keys) {
  return keys.map(k => {
    if (!k.startsWith('P')) return rotuloPoste(o, k);
    const p = (o.postes || []).find(p => 'P' + p.n === k); if (!p) return '';
    const E = p.estruturas || []; const ins = E.filter(x => !x.r).map(x => x.t), ret = E.filter(x => x.r).map(x => x.t);
    const est = [ins.length && 'instalar ' + ins.join(', '), ret.length && 'retirar ' + ret.join(', ')].filter(Boolean).join(' / ');
    return `Poste ${p.n}${est ? ': ' + est : p.nota ? ': ' + p.nota : p.acao ? ' (' + p.acao + ')' : ''}`;
  }).filter(Boolean).join('; ');
}
/* --- Campo: escolher postes na planta --- */
function iniciarPde(o, base) {
  const sel = new Set(base ? base.postes : []);
  const opts = {
    decorar: L => L.map(m => sel.has(m.key) ? Object.assign({}, m, { cls: (m.cls || '') + ' pdesel' }) : m),
    onMarker: k => { sel.has(k) ? sel.delete(k) : sel.add(k); VIEWER.refresh(); barra() }
  };
  VIEWER = montarPlanta(o, opts);
  const bot = $('.fbot');
  const barra = () => {
    bot.innerHTML = `<div style="flex:1"><b>${base ? 'Corrigir pedido' : 'Novo PDE/PLV'}</b><div class="small muted">${sel.size ? sel.size + ' poste(s) marcado(s)' : 'Toque nos postes onde a equipe vai trabalhar'}</div></div>
      <button class="btn sm ghost" id="pdex">Cancelar</button><button class="btn sm pri" id="pdeok" ${sel.size ? '' : 'disabled'}>Continuar</button>`;
    $('#pdex').onclick = () => render();
    $('#pdeok').onclick = () => formPde(o, [...sel], base);
  };
  barra();
}
function formPde(o, keys, base) {
  const s = sessObra(o); const fis = fiscaisDe(s.pref); const ult = lsGet('fisc.pdeUlt', {});
  const v = Object.assign({ tipo: 'PDE', fiscal: ult.fiscal || '', data: amanha(), horaIni: '08:00', horaFim: '17:00', pessoas: '', encarregado: ult.encarregado || S.nome || '', telefone: ult.telefone || '', operacional: '', obs: '' }, base || {});
  const servBase = servicosSugeridos(o, keys);
  const opt = (L, at) => L.map(x => `<option ${x === at ? 'selected' : ''}>${esc(x)}</option>`).join('');
  openLayer(`<div class="ov" id="pdeov" style="align-items:flex-end;padding:0"><div class="sheet" style="width:100%;max-height:92vh;overflow:auto"><div class="grab"></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h4>${base ? 'Corrigir' : 'Solicitar'} PDE / PLV · ${esc(o.projeto)}</h4><button class="btn sm ghost" id="pfx">Voltar</button></div>
    ${base && base.motivo ? `<div class="note" style="background:#fee2e2;border-color:#fecaca;color:#991b1b">Devolvido pelo fiscal: ${esc(base.motivo)}</div>` : ''}
    <div class="small muted" style="margin:4px 0 8px">${esc(o.descricao || '')} · ${esc(o.municipio || '')} · ${keys.length} poste(s): ${esc(keys.map(k => rotuloPoste(o, k).replace(/^Poste /, '')).join(', '))} · folha ${esc(folhasTx(o, keys))}</div>
    <div class="row2"><div><label class="f">Tipo</label><select class="i" id="ptipo">${opt(TIPOS_PDE, v.tipo)}</select></div>
      <div><label class="f">Fiscal</label><select class="i" id="pfis"><option value="">Selecione…</option>${opt(fis, v.fiscal)}</select></div></div>
    <label class="f">Nº operacional / PS / referência elétrica</label><input class="i" id="pop" value="${esc(v.operacional)}">
    <div class="row2"><div><label class="f">Data dos trabalhos</label><input class="i" id="pdata" type="date" value="${esc(v.data)}"></div><div><label class="f">Pessoas na obra</label><input class="i" id="ppes" type="number" min="1" inputmode="numeric" value="${esc(v.pessoas)}" placeholder="obras + manutenção"></div></div>
    <div class="row2"><div><label class="f">Início</label><select class="i" id="phi">${opt(HORAS, v.horaIni)}</select></div><div><label class="f">Término</label><select class="i" id="phf">${opt(HORAS, v.horaFim)}</select></div></div>
    <label class="f">Serviços a serem executados</label><textarea class="i" id="pserv" rows="4" placeholder="Descreva TODO o serviço: pontos de aterramento, serviços com linha viva etc.">${esc(base ? v.servicos : servBase)}</textarea>
    <div class="small muted">Já veio com os postes e as estruturas do projeto. Complete com aterramentos, linha viva etc.</div>
    <div class="row2"><div><label class="f">Encarregado</label><input class="i" id="penc" value="${esc(v.encarregado)}"></div><div><label class="f">Telefone do encarregado</label><input class="i" id="ptel" type="tel" inputmode="numeric" value="${esc(v.telefone)}"></div></div>
    <label class="f">Observações</label><input class="i" id="pobs" value="${esc(v.obs)}">
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:13.5px"><input type="checkbox" id="ptermo" style="width:22px;height:22px;flex:none;margin-top:1px"><span>Declaro que todas as informações preenchidas acima são fiéis ao projeto que me foi entregue.</span></label>
    <button class="btn pri" id="penv" style="width:100%;margin-top:14px;padding:13px">${base ? 'Reenviar ao fiscal' : 'Enviar ao fiscal'}</button></div></div>`);
  $('#pfx').onclick = closeLayer;
  $('#penv').onclick = async e => {
    const d = { id: base ? base.id : null, obra: o.id, tipo: $('#ptipo').value, fiscal: $('#pfis').value, postes: keys, folhas: folhasTx(o, keys), operacional: $('#pop').value.trim(), data: $('#pdata').value, horaIni: $('#phi').value, horaFim: $('#phf').value,
      pessoas: $('#ppes').value, servicos: $('#pserv').value.trim(), encarregado: $('#penc').value.trim(), telefone: $('#ptel').value.replace(/\D/g, ''), obs: $('#pobs').value.trim(), nome: S.nome };
    const falta = [!d.fiscal && 'fiscal', !d.operacional && 'nº operacional', !d.data && 'data', !(+d.pessoas > 0) && 'pessoas', !d.servicos && 'serviços', !d.encarregado && 'encarregado', d.telefone.length < 10 && 'telefone (com DDD)'].filter(Boolean);
    if (falta.length) return toast('Preencha: ' + falta.join(', '), 1);
    if (d.horaFim <= d.horaIni) return toast('O término deve ser depois do início', 1);
    if (d.data < hoje()) return toast('A data não pode ser no passado', 1);
    if (!$('#ptermo').checked) return toast('Marque o termo de compromisso', 1);
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Enviando…';
    try {
      await api(s, 'solicitarPde', { pde: d });
      lsSet('fisc.pdeUlt', { fiscal: d.fiscal, encarregado: d.encarregado, telefone: d.telefone });
      closeLayer(); toast(`${d.tipo} enviado ao fiscal ${d.fiscal}`); await sincronizar(); go('pdes');
    } catch (err) { toast(err.rede ? 'Sem conexão: o pedido precisa de internet.' : msgServidor(err), 1); b.disabled = false; b.textContent = base ? 'Reenviar ao fiscal' : 'Enviar ao fiscal' }
  };
}
/* --- Campo: meus pedidos --- */
async function vPdesCampo(app) {
  app.innerHTML = `<div class="fhead"><div class="who"><div><b>PDE / PLV</b><div class="small muted">Pedidos enviados ao fiscal</div></div><a class="btn sm ghost" href="#campo" style="text-decoration:none">← Obras</a></div></div><div class="flist" id="plst"><div class="fcard empty">Carregando…</div></div>`;
  const { L, erro } = await listarPdes(); if (S.view !== 'pdes') return;
  const ord = { devolvido: 0, solicitado: 1, aprovado: 2, cancelado: 3 };
  L.sort((a, b) => (ord[a.status] - ord[b.status]) || String(b.data).localeCompare(String(a.data)));
  $('#plst').innerHTML = erro && !L.length ? `<div class="fcard empty">${esc(erro)}</div>` : L.length ? L.map(d => `<div class="fcard"><div class="t"><b>${esc(d.tipo)} · ${esc(d.projeto)}</b>${pdeChip(d)}</div>
     <div class="s">${dBR(d.data)} · ${esc(d.horaIni)}–${esc(d.horaFim)} · ${d.postes.length} poste(s) · fiscal ${esc(d.fiscal)}${d.numeroPde ? `<br><b>Nº do ${esc(d.tipo)}: ${esc(d.numeroPde)}</b>` : ''}${d.status === 'devolvido' ? `<br><b style="color:var(--bad)">Motivo: ${esc(d.motivo)}</b>` : ''}</div>
     ${d.status === 'devolvido' || d.status === 'solicitado' ? `<div style="margin-top:8px;display:flex;gap:8px">${d.status === 'devolvido' ? `<button class="btn sm pri" data-cor="${esc(d.id)}">Corrigir e reenviar</button>` : ''}<button class="btn sm ghost" data-can="${esc(d.id)}">Cancelar pedido</button></div>` : ''}</div>`).join('')
    : `<div class="fcard empty">Nenhum pedido ainda. Abra uma obra e toque em “PDE/PLV”.</div>`;
  $$('[data-cor]', app).forEach(b => b.onclick = () => { const d = L.find(x => x.id === b.dataset.cor); PDE_CORRIGIR = d; go('campo-' + d.obra) });
  $$('[data-can]', app).forEach(b => b.onclick = async () => { if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = 'Confirmar cancelamento'; return } const d = L.find(x => x.id === b.dataset.can); b.disabled = true; try { await api(sessDe(d.pref), 'cancelarPde', { id: d.id }); toast('Pedido cancelado'); await sincronizar(); vPdesCampo(app) } catch (e) { toast(msgServidor(e), 1); b.disabled = false } });
}
let PDE_CORRIGIR = null;
/* --- Gestão: análise do fiscal --- */
async function vPdes(app) {
  if (S.mode === 'campo') return vPdesCampo(app);
  const nomes = S.sess.filter(s => s.papel !== 'empreiteira').map(s => s.responsavel).filter(Boolean);
  app.innerHTML = `<div class="card"><div class="toolbar"><h2 style="margin:0 12px 0 0">PDE / PLV</h2>
    <select class="i" id="pst" style="width:auto"><option value="solicitado">Aguardando análise</option><option value="">Todos</option><option value="aprovado">Aprovados</option><option value="devolvido">Devolvidos</option><option value="cancelado">Cancelados</option></select>
    <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pmeus" ${nomes.length ? 'checked' : 'disabled'}> só os meus${nomes.length ? ` (${esc(nomes[0])})` : ''}</label>
    <input class="i" id="pq" placeholder="Buscar projeto, empreiteira, data…" style="min-width:220px"></div><div id="ptb"><div class="empty">Carregando…</div></div></div>`;
  const { L, erro } = await listarPdes(); if (S.view !== 'pdes') return;
  const draw = () => {
    const st = $('#pst').value, q = ($('#pq').value || '').toLowerCase(), meus = $('#pmeus').checked;
    const V = L.filter(d => (!st || d.status === st) && (!meus || nomes.includes(d.fiscal)) && (!q || [d.projeto, d.empreiteira, d.tipo, d.data, d.encarregado, d.operacional].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => String(a.data + a.horaIni).localeCompare(String(b.data + b.horaIni)));
    $('#ptb').innerHTML = erro && !L.length ? `<div class="empty">${esc(erro)}</div>` : V.length ? `<div style="overflow:auto"><table><thead><tr><th>Data</th><th>Tipo</th><th>Projeto</th><th>Empreiteira</th><th>Postes</th><th>Fiscal</th><th>Situação</th></tr></thead><tbody>${V.map(d => `<tr class="cl" data-pd="${esc(d.id)}">
      <td><b>${dBR(d.data)}</b><div class="small muted">${esc(d.horaIni)}–${esc(d.horaFim)}</div></td><td>${esc(d.tipo)}</td><td>${esc(d.projeto)}<div class="small muted">${esc(d.municipio)}</div></td><td>${esc(d.empreiteira)}<div class="small muted">${esc(d.encarregado)}</div></td>
      <td class="n">${d.postes.length}<div class="small muted">folha ${esc(d.folhas)}</div></td><td>${esc(d.fiscal)}</td><td>${pdeChip(d)}${d.numeroPde ? `<div class="small muted">nº ${esc(d.numeroPde)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Nenhum pedido${st === 'solicitado' ? ' aguardando análise' : ''}${meus ? ' para você' : ''}.</div>`;
    $$('[data-pd]', app).forEach(r => r.onclick = () => detalhePde(L.find(x => x.id === r.dataset.pd)));
  };
  ['pst', 'pmeus'].forEach(id => $('#' + id).onchange = draw); $('#pq').oninput = draw; draw();
}
function detalhePde(d) {
  const o = getObra(d.obra); const kv = (k, v) => v ? `<b>${k}</b><span>${v}</span>` : '';
  openLayer(`<div class="ov" id="pdov"><div class="box" style="max-width:1100px;width:96vw;padding:0;overflow:hidden"><div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(320px,1fr);min-height:70vh">
    <div style="position:relative;background:#eef1f5">${o ? '<div id="vw" data-h="min(80vh,760px)"></div>' : '<div class="empty">Obra não está mais ativa: planta indisponível.</div>'}</div>
    <div style="padding:18px;overflow:auto;max-height:86vh"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${esc(d.tipo)} · ${esc(d.projeto)}</h2><button class="btn sm ghost" id="pdx">Fechar</button></div>
     <div style="margin:6px 0 10px">${pdeChip(d)}</div>
     <div class="kv">${kv('Data', `${dBR(d.data)} · ${esc(d.horaIni)} às ${esc(d.horaFim)}`)}${kv('Empreiteira', esc(d.empreiteira))}${kv('Município', esc(d.municipio))}${kv('PEP', esc(d.pep))}
      ${kv('Postes', `${d.postes.length} · ${esc(o ? d.postes.map(k => rotuloPoste(o, k).replace(/^Poste /, '')).join(', ') : d.postes.join(', '))}`)}${kv('Folha', esc(d.folhas))}${kv('Nº operacional', esc(d.operacional))}
      ${kv('Pessoas', esc(d.pessoas))}${kv('Encarregado', `${esc(d.encarregado)} · <a href="tel:${esc(d.telefone)}">${esc(d.telefone)}</a>`)}${kv('Fiscal', esc(d.fiscal))}${kv('Solicitado', `${dtBR(d.solicitadoEm)} por ${esc(d.solicitadoPor)}`)}
      ${kv('Observações', esc(d.obs))}${d.analisadoEm ? kv('Análise', `${dtBR(d.analisadoEm)} · ${esc(d.analisadoPor)}`) : ''}${d.motivo ? kv('Motivo', esc(d.motivo)) : ''}</div>
     <label class="f">Serviços a serem executados</label><div class="small" style="white-space:pre-wrap;background:#f4f6f9;border-radius:8px;padding:8px">${esc(d.servicos)}</div>
     ${d.status === 'solicitado' || d.status === 'devolvido' ? `<div style="background:#f4f6f9;border-radius:10px;padding:10px;margin-top:12px">
       <label class="f" style="margin-top:0">Nº do ${esc(d.tipo)} criado no sistema</label><input class="i" id="pnum" placeholder="opcional, para a empreiteira ver">
       <button class="btn pri" id="papr" style="width:100%;margin-top:10px">✔️ Aprovar</button>
       <label class="f">Ou devolver para correção</label><input class="i" id="pmot" placeholder="motivo (ex.: falta ponto de aterramento)">
       <button class="btn sm" id="pdev" style="margin-top:8px;background:var(--bad);color:#fff">Devolver à empreiteira</button></div>` : ''}
    </div></div></div></div>`);
  $('#pdx').onclick = closeLayer; $('#pdov').onclick = e => { if (e.target.id === 'pdov') closeLayer() };
  if (o) { FOLHA = folhaDe(o, d.postes[0]); const sel = new Set(d.postes); VIEWER = montarPlanta(o, { decorar: L => L.map(m => Object.assign({}, m, { cls: (m.cls || '') + (sel.has(m.key) ? ' pdesel' : ' dim') })), onMarker: () => { } }) }
  const s = sessDe(d.pref);
  const acao = async (b, req) => { b.disabled = true; try { await api(s, 'analisarPde', Object.assign({ id: d.id }, req)); closeLayer(); toast(req.decisao === 'aprovar' ? 'Pedido aprovado' : 'Pedido devolvido à empreiteira'); await sincronizar(); vPdes($('#app')) } catch (e) { toast(msgServidor(e), 1); b.disabled = false } };
  $('#papr') && ($('#papr').onclick = e => acao(e.currentTarget, { decisao: 'aprovar', numeroPde: $('#pnum').value }));
  $('#pdev') && ($('#pdev').onclick = e => { const m = $('#pmot').value.trim(); if (!m) return toast('Informe o motivo', 1); acao(e.currentTarget, { decisao: 'devolver', motivo: m }) });
}
