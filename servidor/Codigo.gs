/**
 * Fiscalização de Obras · servidor da divisão (Apps Script da planilha)
 * ---------------------------------------------------------------------
 * Cole este arquivo inteiro em Extensões > Apps Script da planilha da divisão.
 * Depois: menu Fiscalização > 1. Configurar  e  Implantar > Nova implantação > App da Web
 *   (Executar como: Eu · Quem pode acessar: Qualquer pessoa).
 * Para atualizar o código depois: Implantar > Gerenciar implantações > ✏️ > Nova versão.
 * NUNCA use "Nova implantação" de novo, porque o endereço muda e o app perde a conexão.
 */
const VERSAO_SERVIDOR = '1.1';

const ABAS = {
  obras: ['id', 'projeto', 'ose', 'descricao', 'cliente', 'local', 'municipio', 'projetista', 'empreiteira', 'aes', 'us',
    'empenhoEm', 'prazo', 'status', 'lat', 'lon', 'locOrigem', 'plantaId', 'plantaW', 'plantaH', 'pdfId', 'pdfNome',
    'postes', 'criadoPor', 'criadoEm', 'atualizadoEm'],
  registros: ['id', 'obra', 'poste', 'tipo', 'alt', 'obs', 'fotoId', 'lat', 'lon', 'gpsOrigem', 'precisao', 'dataExec',
    'marcadoEm', 'recebidoEm', 'nome', 'empresa', 'x', 'y', 'invalido', 'invalidadoPor'],
  chaves: ['chave', 'papel', 'empresa', 'responsavel', 'ativa', 'criadaEm', 'ultimoUso'],
  config: ['item', 'valor']
};
const COL_DATA = ['empenhoEm', 'prazo', 'dataExec'];
const COL_NUM = ['us', 'lat', 'lon', 'plantaW', 'plantaH', 'precisao', 'x', 'y'];
const PAPEIS = ['gestor', 'fiscal', 'empreiteira'];
const EDITAVEIS_OBRA = ['ose', 'descricao', 'cliente', 'local', 'municipio', 'projetista', 'empreiteira', 'aes', 'us', 'empenhoEm',
  'prazo', 'status', 'lat', 'lon', 'locOrigem', 'postes'];

/* ============================ menu e configuração ============================ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fiscalização')
    .addItem('1. Configurar (abas e pastas)', 'configurar')
    .addItem('2. Gerar códigos que faltam', 'gerarCodigos')
    .addItem('Ver endereço das pastas', 'mostrarPastas')
    .addToUi();
}

function configurar() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  Object.keys(ABAS).forEach(function (nome) {
    const cab = ABAS[nome];
    let sh = ss.getSheetByName(nome);
    if (!sh) sh = ss.insertSheet(nome);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#101826').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    // tudo como texto puro: evita o Sheets transformar datas e códigos
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
  });
  ['Página1', 'Sheet1', 'Planilha1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  const cfg = lerConfig();
  if (!cfg.divisao) {
    const r = ui.prompt('Sigla da divisão', 'Ex.: VCMCEP', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    salvarConfig('divisao', r.getResponseText().trim().toUpperCase());
  }
  if (!lerConfig().prefixo) {
    const r = ui.prompt('Prefixo dos códigos de acesso', 'Três letras que identificam a divisão no código. Ex.: CEP (para VCMCEP)', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    salvarConfig('prefixo', r.getResponseText().trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  }
  const div = lerConfig().divisao;
  if (!lerConfig().pastaRaiz) {
    const raiz = DriveApp.createFolder('Fiscalização ' + div + ' · arquivos do app');
    raiz.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    salvarConfig('pastaRaiz', raiz.getId());
    salvarConfig('pastaPlantas', raiz.createFolder('plantas').getId());
    salvarConfig('pastaPdfs', raiz.createFolder('pdfs').getId());
    salvarConfig('pastaFotos', raiz.createFolder('fotos').getId());
  }
  // primeiro código de gestor
  const ch = ss.getSheetByName('chaves');
  if (ch.getLastRow() < 2) {
    ch.appendRow(['', 'gestor', 'Copel', 'Gestor ' + div, 'SIM', '', '']);
    ch.appendRow(['', 'fiscal', 'Copel', 'Fiscal ' + div, 'SIM', '', '']);
  }
  gerarCodigos();
  ui.alert('Pronto',
    'Abas e pastas criadas para ' + div + '.\n\n' +
    'Próximos passos:\n' +
    '1) Na aba "chaves", inclua uma linha por empreiteira (papel = empreiteira, empresa = nome igual ao que vai no empenho) e rode "2. Gerar códigos que faltam".\n' +
    '2) Implantar > Nova implantação > App da Web (Executar como: Eu · Acesso: Qualquer pessoa).\n' +
    '3) Copie o endereço que termina em /exec e cole no config.js do app.',
    ui.ButtonSet.OK);
}

function gerarCodigos() {
  const sh = SpreadsheetApp.getActive().getSheetByName('chaves');
  if (!sh || sh.getLastRow() < 2) return;
  const pref = lerConfig().prefixo || 'XXX';
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const usados = {};
  vals.forEach(function (r) { if (r[0]) usados[r[0]] = 1; });
  let n = 0;
  vals.forEach(function (r, i) {
    if (!r[0] && (r[1] || r[2])) {
      let c;
      do { c = pref + '-' + aleatorio(4) + '-' + aleatorio(4); } while (usados[c]);
      usados[c] = 1;
      sh.getRange(i + 2, 1).setValue(c);
      if (!r[1]) sh.getRange(i + 2, 2).setValue('empreiteira');
      if (!r[4]) sh.getRange(i + 2, 5).setValue('SIM');
      sh.getRange(i + 2, 6).setValue(agoraIso());
      n++;
    }
  });
  if (n) SpreadsheetApp.getActive().toast(n + ' código(s) gerado(s).', 'Fiscalização');
}

function mostrarPastas() {
  const cfg = lerConfig();
  SpreadsheetApp.getUi().alert('Pasta dos arquivos: https://drive.google.com/drive/folders/' + cfg.pastaRaiz);
}

/* ============================ entrada HTTP ============================ */
function doGet(e) {
  const cfg = lerConfig();
  return json({ ok: true, app: 'fiscalizacao', versao: VERSAO_SERVIDOR, divisao: cfg.divisao || null });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, erro: 'requisição inválida' }); }
  try {
    const p = perfil(req.chave);
    if (!p) return json({ ok: false, erro: 'código de acesso inválido ou bloqueado', codigo: 'chave' });
    switch (req.acao) {
      case 'login': marcarUso(p); return json({ ok: true, perfil: publico(p), versao: VERSAO_SERVIDOR });
      case 'dados': return json(dados(p));
      case 'empenhar': return json(empenhar(p, req));
      case 'atualizarObra': return json(atualizarObra(p, req));
      case 'registrar': return json(registrar(p, req));
      case 'invalidar': return json(invalidar(p, req));
      default: return json({ ok: false, erro: 'ação desconhecida' });
    }
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  }
}

/* ============================ ações ============================ */
function dados(p) {
  let obras = ler('obras');
  if (p.papel === 'empreiteira') obras = obras.filter(function (o) { return norm(o.empreiteira) === norm(p.empresa); });
  const ids = {};
  obras.forEach(function (o) {
    ids[o.id] = 1;
    try { o.postes = JSON.parse(o.postes || '[]'); } catch (err) { o.postes = []; }
  });
  const regs = ler('registros').filter(function (r) { return ids[r.obra]; });
  regs.forEach(function (r) {
    r.alt = r.alt ? String(r.alt).split(' | ') : [];
    r.invalido = r.invalido === 'SIM';
    r.gps = (r.lat !== '' && r.lat != null && r.lon !== '' && r.lon != null) ? { lat: r.lat, lon: r.lon, origem: r.gpsOrigem, precisao: r.precisao } : null;
  });
  const out = { ok: true, divisao: lerConfig().divisao, obras: obras, registros: regs, agora: agoraIso() };
  if (p.papel !== 'empreiteira') out.empreiteiras = listaEmpreiteiras();
  return out;
}

/** Empreiteiras ativas da aba "chaves" (papel = empreiteira), para a lista do empenho. */
function listaEmpreiteiras() {
  const sh = aba('chaves');
  if (!sh || sh.getLastRow() < 2) return [];
  const vistos = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    const ativa = String(r[4]).toUpperCase();
    if (String(r[1]).toLowerCase() === 'empreiteira' && r[2] && ativa !== 'NÃO' && ativa !== 'NAO') vistos[String(r[2]).trim()] = 1;
  });
  return Object.keys(vistos).sort(function (x, y) { return x.localeCompare(y, 'pt-BR'); });
}

function empenhar(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode empenhar obras' };
  const o = req.obra || {};
  if (!o.projeto || !o.empreiteira) return { ok: false, erro: 'projeto e empreiteira são obrigatórios' };
  if (!req.planta || !req.planta.b64) return { ok: false, erro: 'planta não enviada' };
  const cfg = lerConfig();
  const id = String(o.projeto).replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36);
  const fPlanta = DriveApp.getFolderById(cfg.pastaPlantas)
    .createFile(Utilities.newBlob(Utilities.base64Decode(req.planta.b64), 'image/jpeg', id + '_planta.jpg'));
  let pdfId = '', pdfNome = '';
  if (req.pdf && req.pdf.b64) {
    pdfNome = req.pdf.nome || (o.projeto + '.pdf');
    pdfId = DriveApp.getFolderById(cfg.pastaPdfs)
      .createFile(Utilities.newBlob(Utilities.base64Decode(req.pdf.b64), 'application/pdf', id + '_' + pdfNome)).getId();
  }
  const linha = {};
  EDITAVEIS_OBRA.concat(['projeto']).forEach(function (k) { if (o[k] !== undefined) linha[k] = o[k]; });
  linha.id = id;
  linha.status = 'ativa';
  linha.plantaId = fPlanta.getId();
  linha.plantaW = req.planta.w;
  linha.plantaH = req.planta.h;
  linha.pdfId = pdfId;
  linha.pdfNome = pdfNome;
  linha.postes = JSON.stringify(o.postes || []);
  linha.criadoPor = p.responsavel || p.chave;
  linha.criadoEm = agoraIso();
  linha.atualizadoEm = linha.criadoEm;
  comTrava(function () { anexar('obras', linha); });
  return { ok: true, id: id };
}

function atualizarObra(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode alterar a obra' };
  const campos = {};
  EDITAVEIS_OBRA.forEach(function (k) {
    if (req.campos && req.campos[k] !== undefined) campos[k] = k === 'postes' ? JSON.stringify(req.campos[k]) : req.campos[k];
  });
  campos.atualizadoEm = agoraIso();
  let ok = false;
  comTrava(function () { ok = atualizarLinha('obras', req.id, campos); });
  return ok ? { ok: true } : { ok: false, erro: 'obra não encontrada' };
}

function registrar(p, req) {
  const r = req.registro || {};
  if (!r.id || !r.obra || !r.tipo) return { ok: false, erro: 'registro incompleto' };
  if (['conforme', 'alterado', 'nao', 'novo'].indexOf(r.tipo) < 0) return { ok: false, erro: 'tipo inválido' };
  const obra = ler('obras').filter(function (o) { return o.id === r.obra; })[0];
  if (!obra) return { ok: false, erro: 'obra não encontrada' };
  if (p.papel === 'empreiteira' && norm(obra.empreiteira) !== norm(p.empresa)) return { ok: false, erro: 'esta obra não é da sua empresa' };
  // idempotente: o celular pode reenviar o mesmo registro quando o sinal volta
  const ja = buscarLinha('registros', r.id);
  if (ja) return { ok: true, id: r.id, repetido: true };
  let fotoId = '';
  if (req.foto && req.foto.b64) {
    const nome = obra.projeto + '_' + String(r.poste || 'novo').replace(/[^A-Za-z0-9]/g, '') + '_' + r.id + '.jpg';
    fotoId = DriveApp.getFolderById(lerConfig().pastaFotos)
      .createFile(Utilities.newBlob(Utilities.base64Decode(req.foto.b64), 'image/jpeg', nome)).getId();
  }
  const g = r.gps || {};
  const linha = {
    id: r.id, obra: r.obra, poste: r.poste || '', tipo: r.tipo, alt: (r.alt || []).join(' | '), obs: r.obs || '',
    fotoId: fotoId, lat: g.lat != null ? g.lat : '', lon: g.lon != null ? g.lon : '', gpsOrigem: g.origem || '',
    precisao: g.precisao != null ? g.precisao : '', dataExec: r.dataExec || '', marcadoEm: r.marcadoEm || '',
    recebidoEm: agoraIso(), nome: r.nome || p.responsavel || '', empresa: p.papel === 'empreiteira' ? p.empresa : (r.empresa || p.empresa),
    x: r.x != null ? r.x : '', y: r.y != null ? r.y : '', invalido: '', invalidadoPor: ''
  };
  comTrava(function () { if (!buscarLinha('registros', r.id)) anexar('registros', linha); });
  return { ok: true, id: r.id, fotoId: fotoId };
}

function invalidar(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'só a fiscalização pode desconsiderar registros' };
  let ok = false;
  comTrava(function () {
    ok = atualizarLinha('registros', req.id, { invalido: req.invalido ? 'SIM' : '', invalidadoPor: req.invalido ? (p.responsavel || p.papel) + ' · ' + agoraIso() : '' });
  });
  return ok ? { ok: true } : { ok: false, erro: 'registro não encontrado' };
}

/* ============================ planilha ============================ */
function aba(nome) { return SpreadsheetApp.getActive().getSheetByName(nome); }

function ler(nome) {
  const sh = aba(nome);
  if (!sh || sh.getLastRow() < 2) return [];
  const cab = ABAS[nome];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).getValues();
  const tz = Session.getScriptTimeZone();
  return vals.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const o = {};
    cab.forEach(function (k, i) {
      let v = r[i];
      if (v instanceof Date) v = COL_DATA.indexOf(k) >= 0 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      if (COL_NUM.indexOf(k) >= 0 && v !== '' && v !== null) { const n = Number(String(v).replace(',', '.')); v = isNaN(n) ? '' : n; }
      o[k] = v;
    });
    return o;
  });
}

function anexar(nome, obj) {
  const cab = ABAS[nome];
  const sh = aba(nome);
  const linha = cab.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : String(obj[k]); });
  const r = sh.getLastRow() + 1;
  const rg = sh.getRange(r, 1, 1, cab.length);
  rg.setNumberFormat('@');
  rg.setValues([linha]);
}

function buscarLinha(nome, id) {
  const sh = aba(nome);
  if (!sh || sh.getLastRow() < 2) return 0;
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function atualizarLinha(nome, id, campos) {
  const row = buscarLinha(nome, id);
  if (!row) return false;
  const cab = ABAS[nome];
  const sh = aba(nome);
  Object.keys(campos).forEach(function (k) {
    const c = cab.indexOf(k);
    if (c >= 0) sh.getRange(row, c + 1).setNumberFormat('@').setValue(campos[k] === null || campos[k] === undefined ? '' : String(campos[k]));
  });
  return true;
}

function lerConfig() {
  const sh = aba('config');
  const o = {};
  if (!sh || sh.getLastRow() < 2) return o;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) o[r[0]] = String(r[1]); });
  return o;
}

function salvarConfig(item, valor) {
  const sh = aba('config');
  const n = sh.getLastRow();
  if (n >= 2) {
    const v = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) if (v[i][0] === item) { sh.getRange(i + 2, 2).setValue(valor); return; }
  }
  sh.appendRow([item, valor]);
}

/* ============================ acesso ============================ */
function perfil(chave) {
  if (!chave) return null;
  const sh = aba('chaves');
  if (!sh || sh.getLastRow() < 2) return null;
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(chave).trim().toUpperCase()).matchEntireCell(true).findNext();
  if (!f) return null;
  const r = sh.getRange(f.getRow(), 1, 1, 5).getValues()[0];
  if (String(r[4]).toUpperCase() === 'NÃO' || String(r[4]).toUpperCase() === 'NAO') return null;
  const papel = PAPEIS.indexOf(String(r[1]).toLowerCase()) >= 0 ? String(r[1]).toLowerCase() : 'empreiteira';
  return { chave: r[0], papel: papel, empresa: String(r[2] || ''), responsavel: String(r[3] || ''), linha: f.getRow() };
}

function publico(p) {
  return { papel: p.papel, empresa: p.empresa, responsavel: p.responsavel, divisao: lerConfig().divisao };
}

function marcarUso(p) {
  try { aba('chaves').getRange(p.linha, 7).setValue(agoraIso()); } catch (err) { }
}

/* ============================ utilitários ============================ */
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function agoraIso() { return new Date().toISOString(); }
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase(); }
function aleatorio(n) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += A.charAt(Math.floor(Math.random() * A.length));
  return s;
}
function comTrava(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { fn(); } finally { lock.releaseLock(); }
}
