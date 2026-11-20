/* Fiscalização de Obras · app (campo + gestão) */
'use strict';
const CFG = window.FISC_CONFIG || { divisoes: {} };
const VERSAO_APP = '1.2.0';
const LIB = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfw: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
};
const ALTERACOES = ['Poste deslocado', 'Estrutura diferente', 'Altura/esforço do poste diferente', 'Condutor/vão diferente', 'Equipamento diferente', 'Aterramento diferente', 'Outro'];
const PENDENCIAS = ['Falta material', 'Impedimento do proprietário', 'Roçada/supressão pendente', 'Interferência (outra rede, via)', 'Condição de terreno/clima', 'Outro'];
const PRMAP = window.PRMAP;

/* ================= estado ================= */
const S = {
  sess: lsGet('fisc.sess', []), obras: [], regs: [], emps: {}, fila: [], idx: {}, carregado: false, carregando: false, ultimaSync: null,
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
  const regs = (d.registros || []).map(r => Object.assign({}, r, {
    pref, em: r.marcadoEm || r.recebidoEm, equipe: r.nome, foto: r.fotoId ? { id: r.fotoId } : null,
    x: r.x === '' ? null : r.x, y: r.y === '' ? null : r.y, poste: r.poste || null
  }));
  return { obras, regs };
}

async function sincronizar(silencioso) {
  if (S.carregando || !S.sess.length) return;
  S.carregando = true; setSt('sincronizando…');
  let falhou = 0;
  const obras = [], regs = [];
  for (const s of S.sess) {
    try {
      const d = await api(s, 'dados');
      const n = normalizar(s.pref, d);
      obras.push(...n.obras); regs.push(...n.regs);
      if (Array.isArray(d.empreiteiras)) S.emps[s.pref] = d.empreiteiras;
      IDB.set('cache:' + s.pref, { obras: d.obras, registros: d.registros, empreiteiras: d.empreiteiras || null, em: new Date().toISOString() }).catch(() => { });
    } catch (e) {
      if (e.codigo === 'chave') { toast(`O código da ${s.div} foi bloqueado ou removido.`, 1); S.sess = S.sess.filter(x => x !== s); salvarSess(); continue }
      falhou++;
      const c = await IDB.get('cache:' + s.pref).catch(() => null);
      if (c) { const n = normalizar(s.pref, c); obras.push(...n.obras); regs.push(...n.regs); if (Array.isArray(c.empreiteiras)) S.emps[s.pref] = c.empreiteiras }
    }
  }
  S.obras = obras; S.regs = regs; S.carregado = true; S.carregando = false;
  if (!falhou) S.ultimaSync = new Date();
  await carregarFila();
  reindex();
  setSt(falhou ? 'sem conexão · dados salvos no aparelho' : '', !!falhou);
  if (!S.sess.length) { route(); return }
  render(true);
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
  if (enviados) { toast(enviados + ' registro(s) pendente(s) enviado(s)'); sincronizar(true) } else { reindex(); render(true) }
}
addEventListener('online', () => { enviarFila(); sincronizar(true) });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { enviarFila(); sincronizar(true) } });
setInterval(() => { if (document.visibilityState === 'visible') { enviarFila(); sincronizar(true) } }, 90000);

/* ================= índice derivado ================= */
const EXEC = new Set(['conforme', 'alterado', 'novo']);
function todosRegs() {
  const pend = S.fila.map(it => Object.assign({}, it.registro, { pref: it.pref, em: it.registro.marcadoEm, equipe: it.registro.nome, pendente: true, foto: it.fotoLocal ? { local: it.fotoLocal } : null }));
  const ids = new Set(S.regs.map(r => r.id));
  return S.regs.concat(pend.filter(p => !ids.has(p.id)));
}
function reindex() {
  const idx = {};
  for (const o of S.obras) idx[o.id] = { postes: new Map(), novos: [], regs: [], ultimo: null, porDia: {} };
  const regs = todosRegs().sort((a, b) => (a.em || '').localeCompare(b.em || ''));
  for (const r of regs) {
    const I = idx[r.obra]; if (!I) continue;
    I.regs.push(r);
    if (r.invalido) continue;
    if (r.tipo === 'novo' && !I.novos.find(n => n.key === 'N:' + r.id)) I.novos.push({ key: 'N:' + r.id, x: Number(r.x), y: Number(r.y), desc: r.obs, id: r.id });
    const key = r.tipo === 'novo' ? 'N:' + r.id : r.poste;
    const st = I.postes.get(key) || { hist: [], first: null };
    st.hist.push(r); st.last = r;
    if (EXEC.has(r.tipo) && !st.first) st.first = r.dataExec || (r.em || '').slice(0, 10);
    I.postes.set(key, st);
    if (!I.ultimo || r.em > I.ultimo) I.ultimo = r.em;
  }
  for (const o of S.obras) {
    const I = idx[o.id]; const tot = (o.postes || []).length;
    let ok = 0, alt = 0, bad = 0;
    for (const p of (o.postes || [])) {
      const st = I.postes.get('P' + p.n); if (!st || !st.last) continue;
      const t = st.last.tipo; if (t === 'conforme') ok++; else if (t === 'alterado') alt++; else if (t === 'nao') bad++;
    }
    for (const [, st] of I.postes) if (st.first) I.porDia[st.first] = (I.porDia[st.first] || 0) + 1;
    I.tot = tot; I.ok = ok; I.alt = alt; I.bad = bad; I.exec = ok + alt; I.pct = tot ? (ok + alt) / tot : 0;
    I.usExec = (o.us || 0) * I.pct;
    I.pend = I.regs.filter(r => r.pendente).length;
    const gps = I.regs.filter(r => r.gps && !r.invalido && r.gps.lat != null);
    I.gps = gps.length ? { lat: gps.reduce((s, r) => s + Number(r.gps.lat), 0) / gps.length, lon: gps.reduce((s, r) => s + Number(r.gps.lon), 0) / gps.length } : null;
  }
  S.idx = idx;
}
function posObra(o) { if (o.lat != null && o.lon != null) return { lat: o.lat, lon: o.lon }; const I = S.idx[o.id]; return I && I.gps ? I.gps : null }
function statusPoste(o, key) {
  const I = S.idx[o.id]; const st = I && I.postes.get(key); if (!st || !st.last) return '';
  const t = st.last.tipo; const c = t === 'conforme' ? 'ok' : t === 'alterado' ? 'alt' : t === 'nao' ? 'bad' : t === 'novo' ? 'novo' : '';
  return c + (st.last.pendente ? ' pend' : '');
}
const TIPO_TX = { conforme: 'Executado conforme projeto', alterado: 'Executado com alteração', nao: 'Não executado', novo: 'Poste não previsto' };
const TIPO_CH = { conforme: 'ok', alterado: 'alt', nao: 'bad', novo: 'novo' };
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
    S.sess = S.sess.filter(x => x !== s); salvarSess(); IDB.del('cache:' + s.pref).catch(() => { });
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
  else if (m || soCampo) { S.mode = 'campo'; S.view = m && m[2] ? 'fobra' : 'flist'; S.obraId = m && m[2] ? m[2] : null }
  else {
    m = h.match(/^obra-(.+)$/);
    if (m) { S.mode = 'gestao'; S.view = 'obra'; S.obraId = m[1] }
    else if (['painel', 'obras', 'nova'].includes(h)) { S.mode = 'gestao'; S.view = h }
    else { S.mode = lsGet('fisc.modo', innerWidth < 760 ? 'campo' : 'gestao'); S.view = S.mode === 'campo' ? 'flist' : 'painel' }
  }
  if (S.mode) lsSet('fisc.modo', S.mode);
  document.body.classList.toggle('campo', S.mode === 'campo' && S.view !== 'login');
  $('#topo').classList.toggle('hidden', S.view === 'login');
  $('.modesw').classList.toggle('hidden', !!soCampo);
  $$('.modesw button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
  $('#nav').classList.toggle('hidden', S.mode === 'campo' || S.view === 'conta');
  $('#navnova').classList.toggle('hidden', !souGestor());
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === S.view || (S.view === 'obra' && a.dataset.v === 'obras')));
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
  if (fromData && (S.view === 'nova' || S.view === 'conta')) return;
  if (fromData && S.view === 'fobra' && VIEWER && VIEWER.obraId === S.obraId) { VIEWER.refresh(); updFbot(); return }
  if (fromData && S.view === 'obra' && VIEWER && VIEWER.obraId === S.obraId) { VIEWER.refresh(); renderObraSide(); return }
  if (S.view === 'conta') { VIEWER = null; vConta(app); return }
  if (!S.carregado) { app.innerHTML = `<div class="empty">Carregando…</div>`; return }
  VIEWER = null;
  ({ painel: vPainel, obras: vObras, nova: vNova, obra: vObra, flist: vFlist, fobra: vFobra }[S.view] || vPainel)(app);
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
  let us = 0, usE = 0, pt = 0, pe = 0, hojeN = 0, alt = 0, bad = 0; const h = hoje();
  for (const o of ativas) { const I = S.idx[o.id]; us += o.us || 0; usE += I.usExec; pt += I.tot; pe += I.exec; alt += I.alt; bad += I.bad }
  const ids = new Set(base.map(o => o.id));
  for (const r of todosRegs()) if (!r.invalido && r.dataExec === h && ids.has(r.obra)) hojeN++;
  app.innerHTML = `
  ${S.sess.length > 1 ? `<div class="toolbar">${filtroDivHtml()}</div>` : ''}
  <div class="grid k4">
    <div class="kpi"><b>${ativas.length}</b><span>obras em andamento</span><small>${base.length} cadastradas</small></div>
    <div class="kpi"><b>${fmt(us)}</b><span>US empenhadas</span><small>obras em andamento</small></div>
    <div class="kpi"><b>${fmt(usE)}</b><span>US executadas (estim.)</span><small>${us ? fmt1(usE / us * 100) + '%' : '—'} · proporcional aos postes</small></div>
    <div class="kpi"><b>${fmt(pe)}<span style="display:inline;font-size:15px;color:#c7cfdb"> / ${fmt(pt)}</span></b><span>postes executados</span><small>${alt} com alteração · ${bad} não executados</small></div>
    <div class="kpi"><b>${hojeN}</b><span>registros hoje</span><small>${dBR(h)}</small></div>
  </div>
  <div class="grid two" style="margin-top:14px">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Onde estão as obras</h2>
      <div class="legend"><span style="--c:var(--pend)">sem início</span><span style="--c:var(--or)">em execução</span><span style="--c:var(--ok)">concluída em campo</span></div></div>
      <div class="mapbox" id="mapa" style="margin-top:8px"></div></div>
    <div class="grid" style="align-content:start">
      <div class="card chart"><h2>Avanço diário · postes executados</h2><div id="graf"></div></div>
      <div class="card"><h2>Pontos de atenção</h2><div id="aten"></div></div>
    </div>
  </div>
  ${S.sess.length > 1 && !S.divFiltro ? '<div class="card" style="margin-top:14px"><h2>Por divisão</h2><div id="pdiv"></div></div>' : ''}
  <div class="card" style="margin-top:14px"><h2>Por empreiteira</h2><div id="emp"></div></div>`;
  ligarFiltroDiv();
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
  }
  at.sort((a, b) => a[0] - b[0]);
  $('#aten').innerHTML = at.length ? `<table>${at.slice(0, 8).map(([, o, c]) => `<tr class="cl" data-o="${esc(o.id)}"><td><b>${esc(o.projeto)}</b><div class="small muted">${esc(o.empreiteira || '—')}${S.sess.length > 1 ? ' · ' + esc((sessObra(o) || {}).div || '') : ''}</div></td><td class="n">${c}</td></tr>`).join('')}</table>` : `<div class="muted small">Nada pendente.</div>`;
  const agrupar = (fk) => {
    const E = {};
    for (const o of ativas) {
      const I = S.idx[o.id]; const k = fk(o); const e = E[k] || (E[k] = { n: 0, us: 0, usE: 0, tot: 0, exec: 0, alt: 0, bad: 0, ult: null });
      e.n++; e.us += o.us || 0; e.usE += I.usExec; e.tot += I.tot; e.exec += I.exec; e.alt += I.alt; e.bad += I.bad; if (I.ultimo && (!e.ult || I.ultimo > e.ult)) e.ult = I.ultimo
    }
    const ks = Object.keys(E).sort((a, b) => E[b].us - E[a].us);
    return ks.length ? `<table><thead><tr><th></th><th class="n">Obras</th><th class="n">US</th><th class="n">US exec.</th><th class="n">Postes</th><th>Avanço</th><th class="n">Alter.</th><th class="n">Não exec.</th><th>Último registro</th></tr></thead><tbody>${ks.map(k => { const e = E[k]; const p = e.tot ? e.exec / e.tot : 0; return `<tr><td><b>${esc(k)}</b></td><td class="n">${e.n}</td><td class="n">${fmt(e.us)}</td><td class="n">${fmt(e.usE)}</td><td class="n">${e.exec}/${e.tot}</td><td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i class="b-ok" style="width:${p * 100}%"></i></div><span class="pct">${fmt1(p * 100)}%</span></div></td><td class="n">${e.alt}</td><td class="n">${e.bad}</td><td>${e.ult ? dtBR(e.ult) : '—'}</td></tr>` }).join('')}</tbody></table>` : `<div class="empty">Nenhuma obra em andamento.${souGestor() ? ' <a href="#nova">Empenhar a primeira obra</a>.' : ''}</div>`;
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
    <select class="i" id="fs">${[['ativa', 'Em andamento'], ['concluida', 'Concluídas'], ['', 'Todas']].map(([v, t]) => `<option value="${v}" ${FILT.st === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span style="flex:1"></span>${souGestor() ? `<a class="btn pri" href="#nova" style="text-decoration:none">+ Empenhar obra</a>` : ''}</div><div id="tb"></div></div>`;
  ligarFiltroDiv();
  const draw = () => {
    const q = FILT.q.toLowerCase();
    const L = base.filter(o => (!FILT.emp || o.empreiteira === FILT.emp) && (!FILT.st || (FILT.st === 'ativa' ? (o.status !== 'concluida' && o.status !== 'cancelada') : o.status === FILT.st)) && (!q || [o.projeto, o.cliente, o.descricao, o.municipio, o.local, o.aes].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    $('#tb').innerHTML = L.length ? `<div style="overflow:auto"><table><thead><tr><th>Projeto</th><th>Obra / cliente</th>${S.sess.length > 1 ? '<th>Divisão</th>' : ''}<th>Município</th><th>Empreiteira</th><th class="n">US</th><th class="n">Postes</th><th style="width:150px">Avanço</th><th>Prazo</th><th>Último registro</th></tr></thead><tbody>${L.map(o => {
      const I = S.idx[o.id]; const d = diasAte(o.prazo);
      return `<tr class="cl" data-o="${esc(o.id)}"><td><b>${esc(o.projeto)}</b>${o.status === 'concluida' ? ' <span class="chip ok">concluída</span>' : ''}</td><td>${esc(o.descricao || '')}<div class="small muted">${esc(o.cliente || '')}</div></td>${S.sess.length > 1 ? `<td>${esc((sessObra(o) || {}).div || '')}</td>` : ''}<td>${esc(o.municipio || '—')}</td><td>${esc(o.empreiteira || '—')}</td><td class="n">${fmt(o.us)}</td><td class="n">${I.exec}/${I.tot}</td>
      <td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div><span class="pct">${fmt1(I.pct * 100)}%</span></div></td>
      <td>${dBR(o.prazo)}${d != null && I.pct < 1 && o.status !== 'concluida' ? (d < 0 ? ` <span class="chip bad">${-d} d atrasada</span>` : d <= 10 ? ` <span class="chip alt">${d} d</span>` : '') : ''}</td><td>${I.ultimo ? dtBR(I.ultimo) : '<span class="muted">—</span>'}</td></tr>`
    }).join('')}</tbody></table></div>`
      : `<div class="empty">${base.length ? 'Nenhuma obra com esses filtros.' : 'Nenhuma obra cadastrada ainda.'}${souGestor() && !base.length ? ' <a href="#nova">Empenhar a primeira obra</a>.' : ''}</div>`;
    $$('[data-o]', app).forEach(el => el.onclick = () => go('obra-' + el.dataset.o));
  };
  $('#fq').oninput = e => { FILT.q = e.target.value; draw() }; $('#fe').onchange = e => { FILT.emp = e.target.value; draw() }; $('#fs').onchange = e => { FILT.st = e.target.value; draw() };
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
function markersObra(o, sel) {
  const L = (o.postes || []).map(p => ({ key: 'P' + p.n, label: String(p.n), x: p.x, y: p.y, cls: statusPoste(o, 'P' + p.n) + (p.acao === 'retirar' ? ' ret' : '') + (sel === 'P' + p.n ? ' sel' : '') }));
  const I = S.idx[o.id]; (I ? I.novos : []).forEach((n, i) => L.push({ key: n.key, label: '+' + (i + 1), x: n.x, y: n.y, cls: statusPoste(o, n.key) + (sel === n.key ? ' sel' : '') }));
  return L;
}
function rotuloPoste(o, key) { if (key && key.startsWith('P')) return 'Poste ' + key.slice(1); const I = S.idx[o.id]; const i = I.novos.findIndex(n => n.key === key); return 'Poste não previsto +' + (i + 1) }
function plantaSrc(o) { return { src: driveImg(o.planta.id, Math.max(o.planta.w, o.planta.h)), alt: driveImg2(o.planta.id, Math.max(o.planta.w, o.planta.h)) } }

/* ---------- detalhe da obra (gestão) ---------- */
let SEL = null;
function vObra(app) {
  const o = S.obras.find(x => x.id === S.obraId);
  if (!o) { app.innerHTML = `<div class="card empty">Obra não encontrada. <a href="#obras">Voltar</a></div>`; return }
  SEL = null;
  app.innerHTML = `<div class="toolbar"><a href="#obras" class="btn ghost sm" style="text-decoration:none">← Obras</a><h2 style="margin:0">Projeto ${esc(o.projeto)}</h2><span class="muted">${esc(o.descricao || '')}</span><span style="flex:1"></span>
    <div class="legend"><span style="--c:var(--pend)">a executar</span><span style="--c:var(--ok)">conforme</span><span style="--c:var(--alt)">com alteração</span><span style="--c:var(--bad)">não executado</span><span style="--c:var(--novo)">não previsto</span><span class="small">▢ quadrado = retirar</span></div></div>
   <div class="det"><div id="vw"></div><div class="grid" id="side"></div></div>`;
  const ps = plantaSrc(o);
  VIEWER = Viewer($('#vw'), { img: ps.src, imgAlt: ps.alt, iw: o.planta.w, ih: o.planta.h, fitMarkers: true, getMarkers: () => markersObra(o, SEL), onMarker: k => { SEL = k; VIEWER.refresh(); renderObraSide() } });
  VIEWER.obraId = o.id;
  renderObraSide();
}
function renderObraSide() {
  const o = S.obras.find(x => x.id === S.obraId); if (!o) return; const I = S.idx[o.id]; const side = $('#side'); if (!side) return;
  const regs = [...I.regs].filter(r => !SEL || (r.tipo === 'novo' ? 'N:' + r.id : r.poste) === SEL).reverse();
  const d = diasAte(o.prazo);
  side.innerHTML = `
   <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">Avanço</h3><b class="pct" style="font-size:22px;color:var(--or)">${fmt1(I.pct * 100)}%</b></div>
    <div class="bar" style="height:12px;margin:8px 0"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>
    <div class="small">${I.exec} de ${I.tot} postes · ${I.ok} conforme · ${I.alt} com alteração · ${I.bad} não executado(s)${I.novos.length ? ` · ${I.novos.length} não previsto(s)` : ''}</div>
    <div class="small muted" style="margin-top:4px">US: ${fmt(I.usExec)} de ${fmt(o.us)} (estimado pela proporção de postes)</div></div>
   <div class="card"><h3>Dados do empenho</h3><div class="kv">
    ${S.sess.length > 1 ? `<b>Divisão</b><span>${esc((sessObra(o) || {}).div || '')}</span>` : ''}
    <b>Empreiteira</b><span>${esc(o.empreiteira || '—')}</span><b>AES</b><span>${esc(o.aes || '—')}</span><b>US</b><span>${fmt(o.us)}</span>
    <b>Empenho</b><span>${dBR(o.empenhoEm)}</span><b>Prazo</b><span>${dBR(o.prazo)}${d != null && I.pct < 1 ? ` <span class="chip ${d < 0 ? 'bad' : d <= 10 ? 'alt' : ''}">${d < 0 ? -d + ' d atrasada' : d + ' d'}</span>` : ''}</span>
    <b>Cliente</b><span>${esc(o.cliente || '—')}</span><b>Local</b><span>${esc(o.local || '—')}</span><b>Município</b><span>${esc(o.municipio || '—')}</span>
    <b>OSE</b><span>${esc(o.ose || '—')}</span><b>Projetista</b><span>${esc(o.projetista || '—')}</span><b>Status</b><span>${o.status === 'concluida' ? '<span class="chip ok">concluída</span>' : '<span class="chip or">em andamento</span>'}</span>
   </div>
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${o.pdf ? `<a class="btn sm ghost" href="${esc(driveVer(o.pdf.id))}" target="_blank" rel="noopener" style="text-decoration:none">Abrir PDF do projeto</a>` : ''}
    ${podeEditarObra(o) ? `<button class="btn sm ghost" id="edob">Editar dados</button><button class="btn sm ${o.status === 'concluida' ? 'ghost' : 'dk'}" id="conc">${o.status === 'concluida' ? 'Reabrir obra' : 'Marcar como concluída'}</button>` : ''}</div></div>
   <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${SEL ? esc(rotuloPoste(o, SEL)) : 'Registros de campo'}</h3>${SEL ? `<button class="btn sm ghost" id="clr">Ver todos</button>` : ''}</div>
   ${SEL && SEL.startsWith('P') ? (() => { const p = o.postes.find(p => 'P' + p.n === SEL); return p && (p.estruturas || []).length ? `<div style="margin:8px 0">${estHtml(p)}</div>` : p && p.nota ? `<div class="small muted" style="margin:6px 0">Previsto: ${esc(p.nota)}</div>` : '' })() : ''}
   <div class="feed" style="margin-top:8px">${regs.length ? regs.map(r => regHtml(o, r)).join('') : `<div class="muted small">${SEL ? 'Nenhum registro para este poste.' : 'Nenhum registro em campo ainda.'}</div>`}</div></div>`;
  $('#clr') && ($('#clr').onclick = () => { SEL = null; VIEWER.refresh(); renderObraSide() });
  $('#edob') && ($('#edob').onclick = () => editarObra(o));
  $('#conc') && ($('#conc').onclick = async () => {
    try { await api(sessObra(o), 'atualizarObra', { id: o.id, campos: { status: o.status === 'concluida' ? 'ativa' : 'concluida' } }); toast('Status atualizado'); sincronizar(true) } catch (e) { toast('Não foi possível salvar: ' + e.message, 1) }
  });
  $$('.reg img', side).forEach(im => { imgFallback(im); im.onclick = () => lightbox(im.dataset.full, im.dataset.id) });
  $$('[data-inv]', side).forEach(b => b.onclick = async () => {
    const r = S.regs.find(x => x.id === b.dataset.inv); if (!r) return; b.disabled = true;
    try { await api(sessObra(o), 'invalidar', { id: r.id, invalido: !r.invalido }); toast(r.invalido ? 'Registro restaurado' : 'Registro desconsiderado'); sincronizar(true) } catch (e) { b.disabled = false; toast('Não foi possível salvar: ' + e.message, 1) }
  });
  $$('[data-pk]', side).forEach(el => el.onclick = () => { SEL = el.dataset.pk; const m = markersObra(o).find(m => m.key === SEL); m && VIEWER.focus(m.x, m.y); VIEWER.refresh(); renderObraSide() });
}
function regHtml(o, r) {
  const key = r.tipo === 'novo' ? 'N:' + r.id : r.poste;
  const gm = r.gps && r.gps.lat != null ? `<a href="https://www.google.com/maps?q=${r.gps.lat},${r.gps.lon}" target="_blank" rel="noopener">GPS${r.gps.origem === 'foto' ? ' (foto)' : ''}</a>` : '<span title="Sem localização">sem GPS</span>';
  const img = r.foto ? (r.foto.local ? `<img src="${esc(r.foto.local)}" data-full="${esc(r.foto.local)}">` : `<img src="${esc(driveImg(r.foto.id, 200))}" data-id="${esc(r.foto.id)}" data-w="200" data-full="${esc(driveImg(r.foto.id, 1600))}" loading="lazy">`) : `<div class="nf">sem foto</div>`;
  return `<div class="reg ${r.invalido ? 'inv' : ''}">${img}
   <div style="flex:1;min-width:0"><div><b data-pk="${esc(key)}" style="cursor:pointer">${esc(rotuloPoste(o, key))}</b> <span class="chip ${TIPO_CH[r.tipo] || ''}">${esc(TIPO_TX[r.tipo] || r.tipo)}</span>${r.invalido ? ' <span class="chip">desconsiderado</span>' : ''}${r.pendente ? ' <span class="chip">aguardando envio</span>' : ''}</div>
   ${r.alt && r.alt.length ? `<div class="small" style="margin-top:3px">${esc(r.alt.join(' · '))}</div>` : ''}
   ${r.obs ? `<div class="small" style="margin-top:3px">“${esc(r.obs)}”</div>` : ''}
   <div class="small muted" style="margin-top:3px">Execução ${dBR(r.dataExec)} · ${esc(r.equipe || '')}${r.empresa ? ' (' + esc(r.empresa) + ')' : ''} · lançado ${dtBR(r.em)} · ${gm}</div>
   ${podeInvalidar(o) && !r.pendente ? `<button class="btn sm ghost" style="margin-top:6px" data-inv="${esc(r.id)}">${r.invalido ? 'Restaurar' : 'Desconsiderar'}</button>` : ''}</div></div>`;
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
   <div class="row2"><div><label class="f">AES</label><input class="i" name="aes" value="${esc(o.aes || '')}"></div><div><label class="f">US *</label><input class="i" name="us" type="number" min="0" step="1" value="${o.us ?? ''}"></div></div>
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
    try { $('#ok').disabled = true; await api(sessObra(o), 'atualizarObra', { id: o.id, campos: v }); closeLayer(); toast('Dados salvos'); sincronizar(true) } catch (e) { $('#ok').disabled = false; toast('Não foi possível salvar: ' + e.message, 1) }
  };
}

/* ================= empenhar obra ================= */
let NOVA = null;
function vNova(app) {
  if (!souGestor()) { app.innerHTML = `<div class="card empty">Só o gestor pode empenhar obras.</div>`; return }
  NOVA = null;
  app.innerHTML = `<div class="card" style="max-width:760px;margin:0 auto"><h2>Empenhar obra para uma empreiteira</h2>
   <p class="muted" style="margin-top:0">Suba o PDF do projeto. O app lê o carimbo, localiza o município e marca os postes numerados da planta. Depois você confere, ajusta e informa empreiteira, AES, US e prazo.</p>
   <label class="drop" id="drop" style="display:block;cursor:pointer"><input type="file" accept="application/pdf" id="fpdf" class="hidden"><div style="font-size:15px;font-weight:700">Clique para escolher o PDF do projeto</div><div class="small muted" style="margin-top:4px">ou arraste o arquivo para cá</div></label>
   <div id="prog" class="small muted" style="margin-top:10px"></div></div>`;
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over') }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over') }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; f && processarPdf(f) });
  $('#fpdf').onchange = e => { const f = e.target.files[0]; f && processarPdf(f) };
}
function loadScript(src){return new Promise((ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('não carregou '+src));document.head.appendChild(s)})}
async function pdfLib() { if (window.pdfjsLib) return window.pdfjsLib; await loadScript(LIB.pdfw); await loadScript(LIB.pdf); return window.pdfjsLib }
async function processarPdf(file) {
  const prog = $('#prog'); const st = t => prog.textContent = t;
  try {
    st('Carregando leitor de PDF…'); const lib = await pdfLib();
    st('Lendo o projeto…');
    const buf = await file.arrayBuffer();
    const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, disableFontFace: true }).promise;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.map(i => { const [a, b, , , e, g] = i.transform; const [x, y] = vp1.convertToViewportPoint(e, g); const L = Math.hypot(a, b) || 1; const [x2] = vp1.convertToViewportPoint(e + i.width * a / L, g + i.width * b / L); return { str: i.str, x: Math.min(x, x2), y, w: Math.abs(x2 - x) || i.width, h: L } });
    st('Procurando os postes no desenho…');
    let geo = null; try { geo = geometriaPdf(await page.getOperatorList(), vp1, lib.OPS) } catch (e) { console.warn('geometria', e) }
    const R = analisarTexto(items, vp1.width, vp1.height, PRMAP.c.map(c => c[0]), geo);
    st('Gerando a imagem da planta…');
    const scale = Math.min(3, 2600 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale }); const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const png = await new Promise(r => cv.toBlob(r, 'image/jpeg', .88));
    let loc = null;
    if (R.utm) { const ll = utmToLatLon(R.utm.e, R.utm.n); if (ll.lat < -22 && ll.lat > -27 && ll.lon < -48 && ll.lon > -55) loc = { lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6), src: 'utm' } }
    if (!loc && R.ll) loc = { lat: +R.ll.lat.toFixed(6), lon: +R.ll.lon.toFixed(6), src: 'coordenada' };
    if (!loc && R.municipio) { const c = PRMAP.c.find(z => z[0] === R.municipio); loc = { lat: c[1], lon: c[2], src: 'municipio' } }
    const divs = S.sess.filter(s => s.papel === 'gestor');
    NOVA = { file, png, url: URL.createObjectURL(png), w: cv.width, h: cv.height, postes: R.postes.map(p => ({ ...p, nota: p.nota || '', acao: p.acao || '', estruturas: p.estruturas || [] })), campos: { ...R.campos, municipio: R.municipio, empenhoEm: hoje(), pref: S.divFiltro && divs.some(s => s.pref === S.divFiltro) ? S.divFiltro : divs[0].pref }, loc, utm: R.utm, sel: null, divs };
    editorNova();
  } catch (e) { console.error(e); st('Não consegui ler este PDF: ' + (e.message || e)); toast('Erro ao ler o PDF', 1) }
}
function editorNova() {
  const app = $('#app'); const N = NOVA;
  const emps = [...new Set(S.obras.map(x => x.empreiteira).filter(Boolean))];
  const ja = S.obras.find(o => o.projeto === N.campos.projeto);
  app.innerHTML = `<div class="toolbar"><button class="btn ghost sm" id="vol">← Outro PDF</button><h2 style="margin:0">Conferir projeto ${esc(N.campos.projeto || '')}</h2><span style="flex:1"></span>
   <button class="btn sm ghost" id="add">+ Adicionar poste</button><button class="btn sm ghost" id="ren">Renumerar</button></div>
   <div class="edlay"><div id="vw"></div>
   <div class="card" style="max-height:calc(100vh - 170px);overflow:auto">
    <div class="note ${N.postes.length ? 'ok-note' : ''}" id="pnote"></div>
    <div class="plist" id="plist"></div>
    <div id="psel"></div>
    ${ja ? `<div class="note" style="margin-top:10px">Já existe uma obra com o projeto ${esc(ja.projeto)}. Salvar vai criar outra obra separada.</div>` : ''}
    <div class="note" style="margin-top:10px;background:#f4f6f9;border-color:var(--ln);color:var(--tx)">Localização: ${N.loc ? (N.loc.src === 'utm' ? `coordenada UTM do desenho (${fmt1(N.utm.e)}, ${fmt1(N.utm.n)})` : N.loc.src === 'coordenada' ? `coordenada do desenho (${N.loc.lat}, ${N.loc.lon})` : `centro do município de ${esc(N.campos.municipio)}`) : 'não encontrada no PDF. Informe o município ou ela virá do GPS dos registros.'}</div>
    <div id="nf">${formCampos(N.campos, emps, N.divs)}</div>
    <button class="btn pri" id="salvar" style="width:100%;margin-top:16px;padding:12px">Empenhar obra</button>
    <div class="small muted" id="sst" style="margin-top:8px"></div>
   </div></div>`;
  const ed = Viewer($('#vw'), {
    img: N.url, iw: N.w, ih: N.h, editable: true,
    getMarkers: () => N.postes.map(p => ({ key: String(p.n), label: String(p.n), x: p.x, y: p.y, cls: 'ed' + (p.acao === 'retirar' ? ' ret' : '') + (N.sel === p.n ? ' sel' : '') })),
    onMarker: k => { N.sel = +k; ed.refresh(); side() },
    onMove: (k, p) => { const q = N.postes.find(x => x.n === +k); q.x = +p.x.toFixed(5); q.y = +p.y.toFixed(5); N.sel = +k; ed.refresh(); side() },
    onPlace: p => { const n = (Math.max(0, ...N.postes.map(x => x.n)) + 1); N.postes.push({ n, x: +p.x.toFixed(5), y: +p.y.toFixed(5), nota: '' }); N.sel = n; ed.setPlacing(false); ed.refresh(); side() }
  });
  function side() {
    N.postes.sort((a, b) => a.n - b.n);
    $('#pnote').innerHTML = N.postes.length ? `<b>${N.postes.length} postes</b> marcados na planta${N.postes.some(p => p.acao === 'retirar') ? ` (${N.postes.filter(p => p.acao === 'retirar').length} a retirar, em quadrado)` : ''}. Confira: arraste um número para corrigir a posição, clique para editar ou excluir, e use “+ Adicionar poste” para algum que faltou.` : `<b>Nenhum poste numerado foi encontrado.</b> Use “+ Adicionar poste” e clique na planta sobre cada poste a executar.`;
    $('#plist').innerHTML = N.postes.map(p => `<span data-n="${p.n}" class="${N.sel === p.n ? 'sel' : ''}" title="${esc(p.nota || '')}">${p.n}${p.acao === 'retirar' ? ' ✕' : p.acao === 'modificar' ? ' ±' : p.nota ? ' •' : ''}</span>`).join('');
    $$('#plist span').forEach(s => s.onclick = () => { N.sel = +s.dataset.n; const p = N.postes.find(x => x.n === N.sel); ed.focus(p.x, p.y); ed.refresh(); side() });
    const p = N.postes.find(x => x.n === N.sel);
    $('#psel').innerHTML = p ? `<div style="background:#f4f6f9;border-radius:10px;padding:10px;margin-top:10px"><div class="row2"><div><label class="f" style="margin-top:0">Número</label><input class="i" id="pn" type="number" value="${p.n}"></div><div style="display:flex;align-items:flex-end;justify-content:flex-end"><button class="btn sm" id="pdel" style="background:#fee2e2;color:#991b1b">Excluir poste</button></div></div>
      ${(p.estruturas || []).length ? `<label class="f">Estruturas lidas do PDF</label>${estHtml(p)}` : ''}
      <label class="f">Ação no poste</label><select class="i" id="pacao">${[['', '—'], ['instalar', 'Instalar'], ['retirar', 'Retirar'], ['modificar', 'Modificar (instalar e retirar)']].map(([v, t]) => `<option value="${v}" ${(p.acao || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="f">O que deve ser feito</label><input class="i" id="pnota" value="${esc(p.nota || '')}" placeholder="Ex.: Instalar: B1 · SI-3"></div>` : '';
    if (p) {
      $('#pn').onchange = e => { const v = parseInt(e.target.value, 10); if (!v || N.postes.some(x => x !== p && x.n === v)) { toast('Número inválido ou repetido', 1); e.target.value = p.n; return } p.n = v; N.sel = v; ed.refresh(); side() };
      $('#pnota').oninput = e => { p.nota = e.target.value };
      $('#pacao').onchange = e => { p.acao = e.target.value; ed.refresh(); side() };
      $('#pdel').onclick = () => { N.postes = N.postes.filter(x => x !== p); N.sel = null; ed.refresh(); side() }
    }
  }
  side();
  $('#vol').onclick = () => vNova(app);
  $('#add').onclick = () => ed.setPlacing(!ed.placing, 'Clique na planta onde fica o novo poste');
  $('#ren').onclick = () => { N.postes.sort((a, b) => a.n - b.n).forEach((p, i) => p.n = i + 1); N.sel = null; ed.refresh(); side(); toast('Postes renumerados de 1 a ' + N.postes.length) };
  ligarTrocaDivisao($('#nf'));
  $('#salvar').onclick = salvarNova;
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
    const plantaB64 = await blobB64(N.png);
    const pdfB64 = N.file.size < 25e6 ? await blobB64(N.file) : null;
    sst.textContent = `Enviando para a ${s.div}… (pode levar alguns segundos)`;
    const obra = Object.assign({}, v, { postes: N.postes.map(p => ({ n: p.n, x: p.x, y: p.y, nota: p.nota || '', acao: p.acao || '', estruturas: p.estruturas || [] })), lat: loc ? loc.lat : '', lon: loc ? loc.lon : '', locOrigem: loc ? loc.src : '' });
    const j = await api(s, 'empenhar', { obra, planta: { b64: plantaB64, w: N.w, h: N.h }, pdf: pdfB64 ? { b64: pdfB64, nome: N.file.name } : null });
    toast('Obra empenhada'); NOVA = null;
    await sincronizar(true); go('obra-' + j.id);
  } catch (e) { console.error(e); btn.disabled = false; sst.textContent = ''; toast(e.rede ? 'Sem conexão. Tente de novo.' : 'Não foi possível salvar: ' + e.message, 1) }
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
   <div id="inst"></div></div>
   <div class="flist">${L.length ? L.map(o => {
    const I = S.idx[o.id]; const d = diasAte(o.prazo); return `<div class="fcard" data-o="${esc(o.id)}"><div class="t"><b>${esc(o.projeto)}</b><span class="pct" style="color:var(--or)">${fmt1(I.pct * 100)}%</span></div>
     <div class="s">${esc(o.descricao || '')}${o.municipio ? ' · ' + esc(o.municipio) : ''}<br>${esc(o.empreiteira || '')}${o.prazo ? ` · prazo ${dBR(o.prazo)}${d != null && d < 0 && I.pct < 1 ? ' (vencido)' : ''}` : ''}</div>
     <div class="bar" style="height:10px"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>
     <div class="small muted" style="margin-top:6px">${I.exec} de ${I.tot} postes executados${I.pend ? ` · ${I.pend} aguardando envio` : ''}</div></div>`
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
   <div id="vw"></div><div class="fbot"><div style="flex:1" id="fsum"></div><button class="btn sm dk" id="novo">+ Poste não previsto</button></div></div>`;
  const ps = plantaSrc(o);
  VIEWER = Viewer($('#vw'), {
    img: ps.src, imgAlt: ps.alt, iw: o.planta.w, ih: o.planta.h, fitMarkers: true, getMarkers: () => markersObra(o),
    onMarker: k => abrirPoste(o, k),
    onPlace: p => { VIEWER.setPlacing(false); abrirPoste(o, null, p) }
  });
  VIEWER.obraId = o.id;
  $('#novo').onclick = () => { VIEWER.setPlacing(!VIEWER.placing, 'Toque na planta onde ficou o poste novo') };
  updFbot();
}
function updFbot() {
  const o = S.obras.find(x => x.id === S.obraId); const el = $('#fsum'); if (!o || !el) return; const I = S.idx[o.id];
  el.innerHTML = `<b>${I.exec}/${I.tot}</b> postes · <b style="color:var(--or)">${fmt1(I.pct * 100)}%</b>${I.pend ? ` · <span class="small muted">${I.pend} a enviar</span>` : ''}<div class="bar" style="margin-top:4px"><i class="b-ok" style="width:${I.ok / (I.tot || 1) * 100}%"></i><i class="b-alt" style="width:${I.alt / (I.tot || 1) * 100}%"></i><i class="b-bad" style="width:${I.bad / (I.tot || 1) * 100}%"></i></div>`
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

function abrirPoste(o, key, novoPos) {
  const novo = !key;
  const I = S.idx[o.id]; const st = key ? I.postes.get(key) : null;
  const pp = key && key.startsWith('P') ? (o.postes.find(p => 'P' + p.n === key) || {}) : {};
  const prev = pp.nota || ''; const ret = pp.acao === 'retirar';
  const F = { tipo: novo ? 'novo' : null, alt: [], obs: '', foto: null, dataExec: hoje(), gps: null };
  const gpsP = pegarGps().then(g => { F.gps = g; const el = $('#fgps2'); if (el) el.textContent = g ? `GPS do celular: ${g.lat.toFixed(5)}, ${g.lon.toFixed(5)} (±${g.precisao} m)` : 'GPS do celular indisponível. Ative a localização para este app.' });
  const titulo = novo ? 'Poste não previsto' : rotuloPoste(o, key);
  openLayer(`<div class="ov" id="shov" style="align-items:flex-end;padding:0"><div class="sheet" style="position:relative;width:100%"><div class="grab"></div>
    <div style="display:flex;justify-content:space-between;align-items:center"><h4>${esc(titulo)}</h4><button class="btn sm ghost" id="shx">Fechar</button></div>
    ${(pp.estruturas || []).length ? `<div style="margin-top:8px">${estHtml(pp)}</div>` : prev ? `<div class="small" style="margin-top:6px;background:#f4f6f9;border-radius:8px;padding:8px">Previsto: ${esc(prev)}</div>` : ''}
    ${st && st.last ? `<div class="small" style="margin-top:6px">Situação atual: <span class="chip ${TIPO_CH[st.last.tipo]}">${esc(TIPO_TX[st.last.tipo])}</span>${st.last.pendente ? ' <span class="chip">aguardando envio</span>' : ''}</div>` : ''}
    ${novo ? `<div class="small muted" style="margin-top:6px">Registre o poste implantado fora do projeto. Descreva o que foi feito e tire a foto.</div>` : `
    <div class="bigbtns"><button class="b1" data-t="conforme">✅ ${ret ? 'Retirado' : 'Executado'} conforme projeto</button><button class="b2" data-t="alterado">✏️ ${ret ? 'Retirado' : 'Executado'} com alteração</button><button class="b3" data-t="nao">⛔ ${ret ? 'Não retirado' : 'Não executado'}</button></div>`}
    <div id="dyn"></div>
    <label class="f">Data da execução</label><input class="i" type="date" id="dex" value="${F.dataExec}" max="${hoje()}">
    <label class="f">Foto do poste <span id="fobr"></span></label>
    <div class="photo"><img id="fprev" class="hidden"><label><input type="file" accept="image/*" capture="environment" id="ffoto" class="hidden">📷 <span id="flbl">Tirar foto</span></label></div>
    <div class="small muted" id="fgps2" style="margin-top:6px">Buscando GPS do celular…</div>
    <button class="btn pri" id="shok" style="width:100%;margin-top:16px;padding:14px;font-size:15px" disabled>Salvar registro</button>
    ${st && st.hist.length ? `<div class="hist"><b class="small">Histórico</b>${[...st.hist].reverse().map(r => `<div>${dtBR(r.em)} · ${esc(TIPO_TX[r.tipo])} · ${esc(r.equipe || '')}${r.alt && r.alt.length ? ' · ' + esc(r.alt.join(', ')) : ''}</div>`).join('')}</div>` : ''}
  </div></div>`);
  $('#shx').onclick = closeLayer; $('#shov').onclick = e => { if (e.target.id === 'shov') closeLayer() };
  const dyn = $('#dyn'); const LY = $('#layer');
  const precisaFoto = () => F.tipo !== 'nao';
  const valida = () => { const ok = F.tipo && (!precisaFoto() || F.foto) && (F.tipo !== 'alterado' || F.alt.length) && (F.tipo !== 'nao' || F.alt.length) && (F.tipo !== 'novo' || F.obs.trim()); $('#shok').disabled = !ok; $('#fobr').textContent = precisaFoto() ? '(obrigatória)' : '(opcional)' };
  function drawDyn() {
    const lista = F.tipo === 'alterado' ? ALTERACOES : F.tipo === 'nao' ? PENDENCIAS : null;
    dyn.innerHTML = (lista ? `<label class="f">${F.tipo === 'alterado' ? 'O que foi alterado?' : 'Motivo'}</label><div class="chips">${lista.map(a => `<button data-a="${esc(a)}" class="${F.alt.includes(a) ? 'on' : ''}">${esc(a)}</button>`).join('')}</div>` : '')
      + (F.tipo ? `<label class="f">${F.tipo === 'novo' ? 'O que foi feito? *' : 'Observação'}</label><textarea class="i" id="obs" placeholder="${F.tipo === 'alterado' ? 'Ex.: poste deslocado 5 m para não ficar em frente à garagem' : ''}">${esc(F.obs)}</textarea>` : '');
    $$('[data-a]', dyn).forEach(b => b.onclick = () => { const a = b.dataset.a; F.alt = F.alt.includes(a) ? F.alt.filter(x => x !== a) : [...F.alt, a]; b.classList.toggle('on'); valida() });
    $('#obs') && ($('#obs').oninput = e => { F.obs = e.target.value; valida() });
    valida();
  }
  $$('[data-t]', LY).forEach(b => b.onclick = () => { F.tipo = b.dataset.t; F.alt = []; $$('[data-t]', LY).forEach(x => x.classList.toggle('on', x === b)); drawDyn() });
  drawDyn();
  $('#dex').onchange = e => F.dataExec = e.target.value || hoje();
  $('#ffoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; $('#flbl').textContent = 'Processando…';
    try {
      F.foto = await prepFoto(f); $('#fprev').src = URL.createObjectURL(F.foto.blob); $('#fprev').classList.remove('hidden'); $('#flbl').textContent = 'Trocar foto';
      if (F.foto.data && F.foto.data <= hoje()) { F.dataExec = F.foto.data; $('#dex').value = F.foto.data }
    } catch (err) { console.error(err); $('#flbl').textContent = 'Tirar foto'; toast('Não consegui ler a foto', 1) } valida()
  };
  $('#shok').onclick = async () => {
    const b = $('#shok'); b.disabled = true; b.textContent = 'Salvando…';
    if (!F.gps) await Promise.race([gpsP, new Promise(r => setTimeout(r, 4000))]);
    const gps = F.gps || (F.foto && F.foto.gps ? Object.assign({ origem: 'foto' }, F.foto.gps) : null);
    const reg = {
      id: uid(), obra: o.id, poste: novo ? null : key, tipo: F.tipo, alt: F.alt, obs: F.obs.trim(), gps, dataExec: F.dataExec,
      marcadoEm: new Date().toISOString(), nome: S.nome, empresa: empresaCampo(o)
    };
    if (novo) { reg.x = +novoPos.x.toFixed(5); reg.y = +novoPos.y.toFixed(5) }
    const fotoB64 = F.foto ? await blobB64(F.foto.blob) : null;
    const item = { pref: o.pref, registro: reg, fotoB64, fotoLocal: F.foto ? 'data:image/jpeg;base64,' + fotoB64 : null };
    // grava primeiro no aparelho (não se perde), depois tenta enviar
    try { await IDB.set('fila:' + reg.id, item) } catch (e) { }
    S.fila.push(item); reindex(); closeLayer(); render(true);
    try {
      const s = sessObra(o);
      await api(s, 'registrar', { registro: reg, foto: fotoB64 ? { b64: fotoB64 } : null });
      await IDB.del('fila:' + reg.id).catch(() => { });
      S.fila = S.fila.filter(x => x.registro.id !== reg.id);
      toast('Registro salvo'); sincronizar(true);
    } catch (e) {
      if (e.rede) { toast('Sem sinal: registro guardado no celular e será enviado sozinho.'); setSt('sem conexão', true) }
      else { await IDB.del('fila:' + reg.id).catch(() => { }); S.fila = S.fila.filter(x => x.registro.id !== reg.id); reindex(); render(true); toast('Não foi possível salvar: ' + e.message, 1) }
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
  const mx=1600,s=Math.min(1,mx/Math.max(img.naturalWidth,img.naturalHeight));
  const cv=document.createElement('canvas');cv.width=Math.round(img.naturalWidth*s);cv.height=Math.round(img.naturalHeight*s);
  cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(url);
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',.82));
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
  for (const s of S.sess) {
    const c = await IDB.get('cache:' + s.pref).catch(() => null);
    if (c) { const n = normalizar(s.pref, c); S.obras.push(...n.obras); S.regs.push(...n.regs); if (Array.isArray(c.empreiteiras)) S.emps[s.pref] = c.empreiteiras; S.carregado = true }
  }
  await carregarFila(); reindex();
  route();
  if (S.sess.length) { await sincronizar(); enviarFila() }
})();
