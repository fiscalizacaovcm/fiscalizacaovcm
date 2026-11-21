/**
 * Fiscalização de Obras · servidor da divisão (Apps Script da planilha)
 * ---------------------------------------------------------------------
 * Cole este arquivo inteiro em Extensões > Apps Script da planilha da divisão.
 * Primeira vez: menu Fiscalização > 1. Configurar  e  Implantar > Nova implantação > App da Web
 *   (Executar como: Eu · Quem pode acessar: Qualquer pessoa).
 * Para atualizar o código depois: Implantar > Gerenciar implantações > ✏️ > Versão: Nova versão > Implantar.
 * NUNCA use "Nova implantação" de novo, porque o endereço muda e o app perde a conexão.
 */
const VERSAO_SERVIDOR = '1.4';

const COLS_OBRAS = ['id', 'projeto', 'ose', 'descricao', 'cliente', 'local', 'municipio', 'projetista', 'empreiteira', 'aes', 'us',
  'empenhoEm', 'prazo', 'status', 'lat', 'lon', 'locOrigem', 'plantaId', 'plantaW', 'plantaH', 'pdfId', 'pdfNome',
  'postes', 'criadoPor', 'criadoEm', 'atualizadoEm', 'concluidaEm', 'resumo', 'pep', 'encerramento', 'folhas'];
const COLS_REGS = ['id', 'obra', 'poste', 'tipo', 'alt', 'obs', 'fotoId', 'lat', 'lon', 'gpsOrigem', 'precisao', 'dataExec',
  'marcadoEm', 'recebidoEm', 'nome', 'empresa', 'x', 'y', 'invalido', 'invalidadoPor', 'alteradoEm', 'folha'];
const ABAS = {
  obras: COLS_OBRAS,
  registros: COLS_REGS,
  chaves: ['chave', 'papel', 'empresa', 'responsavel', 'ativa', 'criadaEm', 'ultimoUso'],
  config: ['item', 'valor'],
  obras_historico: COLS_OBRAS,
  registros_historico: COLS_REGS
};
const COL_DATA = ['empenhoEm', 'prazo', 'dataExec'];
const COL_NUM = ['us', 'lat', 'lon', 'plantaW', 'plantaH', 'precisao', 'x', 'y', 'folha'];
const PAPEIS = ['gestor', 'fiscal', 'empreiteira'];
/** Papel tolerante a digitação: "Empreiteria", "empreiteira " etc. viram "empreiteira". */
function normPapel(v) {
  const t = String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (t.indexOf('gest') === 0) return 'gestor';
  if (t.indexOf('fisc') === 0) return 'fiscal';
  return 'empreiteira';
}
const EDITAVEIS_OBRA = ['ose', 'descricao', 'cliente', 'local', 'municipio', 'projetista', 'empreiteira', 'aes', 'us', 'empenhoEm',
  'prazo', 'lat', 'lon', 'locOrigem', 'postes', 'pep'];
const TIPOS_EXEC = ['conforme', 'alterado', 'nao', 'novo'];
const TIPOS_FISC = ['aprovado', 'reprovado'];

/* ============================ menu e configuração ============================ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fiscalização')
    .addItem('1. Configurar (abas e pastas)', 'configurar')
    .addItem('2. Gerar códigos que faltam', 'gerarCodigos')
    .addItem('Ver endereço das pastas', 'mostrarPastas')
    .addToUi();
}

/** Qualquer edição feita à mão na planilha avisa o app que há novidade. */
function onEdit(e) { marcarAlteracao(); }

function configurar() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  garantirEstrutura();
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
  const ch = ss.getSheetByName('chaves');
  if (ch.getLastRow() < 2) {
    ch.appendRow(['', 'gestor', 'Copel', 'Gestor ' + div, 'SIM', '', '']);
    ch.appendRow(['', 'fiscal', 'Copel', 'Fiscal ' + div, 'SIM', '', '']);
  }
  gerarCodigos();
  ui.alert('Pronto',
    'Abas e pastas prontas para ' + div + '.\n\n' +
    'Próximos passos:\n' +
    '1) Na aba "chaves", inclua uma linha por empreiteira (papel = empreiteira, empresa = nome) e rode "2. Gerar códigos que faltam".\n' +
    '2) Implantar > Nova implantação > App da Web (Executar como: Eu · Acesso: Qualquer pessoa) — só na primeira vez.\n' +
    '3) Copie o endereço que termina em /exec e cole no config.js do app.',
    ui.ButtonSet.OK);
}

/** Cria as abas que faltam e acrescenta colunas novas no fim do cabeçalho (sem mexer nos dados). */
function garantirEstrutura() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(ABAS).forEach(function (nome) {
    const cab = ABAS[nome];
    let sh = ss.getSheetByName(nome);
    if (!sh) sh = ss.insertSheet(nome);
    const atual = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (atual.length < cab.length || atual.join('|') !== cab.slice(0, atual.length).join('|') || sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#101826').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
    if (nome === 'chaves') sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(PAPEIS, true).setAllowInvalid(true).build());
  });
  PropertiesService.getScriptProperties().setProperty('estrutura', VERSAO_SERVIDOR);
}
function estruturaEmDia() {
  if (PropertiesService.getScriptProperties().getProperty('estrutura') === VERSAO_SERVIDOR) return;
  comTrava(garantirEstrutura);
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
  marcarAlteracao();
  if (n) SpreadsheetApp.getActive().toast(n + ' código(s) gerado(s).', 'Fiscalização');
}

function mostrarPastas() {
  SpreadsheetApp.getUi().alert('Pasta dos arquivos: https://drive.google.com/drive/folders/' + lerConfig().pastaRaiz);
}

/* ============================ entrada HTTP ============================ */
function doGet(e) {
  return json({ ok: true, app: 'fiscalizacao', versao: VERSAO_SERVIDOR, divisao: lerConfig().divisao || null });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, erro: 'requisição inválida' }); }
  try {
    estruturaEmDia();
    const p = perfil(req.chave);
    if (!p) return json({ ok: false, erro: 'código de acesso inválido ou bloqueado', codigo: 'chave' });
    switch (req.acao) {
      case 'login': marcarUso(p); return json({ ok: true, perfil: publico(p), versao: VERSAO_SERVIDOR });
      case 'dados': return json(dados(p, req));
      case 'empenhar': return json(empenhar(p, req));
      case 'atualizarObra': return json(atualizarObra(p, req));
      case 'concluir': return json(concluir(p, req));
      case 'reabrir': return json(reabrir(p, req));
      case 'historico': return json(historico(p));
      case 'obraHistorico': return json(obraHistorico(p, req));
      case 'registrar': return json(registrar(p, req));
      case 'fiscalizarLote': return json(fiscalizarLote(p, req));
      case 'adicionarFolhas': return json(adicionarFolhas(p, req));
      case 'invalidar': return json(invalidar(p, req));
      default: return json({ ok: false, erro: 'ação desconhecida' });
    }
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  }
}

/* ============================ leitura ============================ */
/**
 * dados: com "desde" (data/hora da última sincronização do celular), devolve só o que mudou.
 * Se nada mudou desde então, responde na hora sem ler a planilha.
 */
function dados(p, req) {
  const agora = agoraIso();
  const ult = PropertiesService.getScriptProperties().getProperty('ult') || '';
  if (req.desde && ult && ult < req.desde) return { ok: true, semMudanca: true, agora: agora };
  let obras = ler('obras');
  if (p.papel === 'empreiteira') obras = obras.filter(function (o) { return norm(o.empreiteira) === norm(p.empresa); });
  const ids = {};
  obras.forEach(function (o) { ids[o.id] = 1; });
  const idsObras = obras.map(function (o) { return o.id; });
  let regs = ler('registros').filter(function (r) { return ids[r.obra]; });
  if (req.desde) {
    const corte = new Date(new Date(req.desde).getTime() - 120000).toISOString(); // 2 min de sobra
    obras = obras.filter(function (o) { return String(o.atualizadoEm || o.criadoEm) >= corte; });
    regs = regs.filter(function (r) { return String(r.alteradoEm || r.recebidoEm) >= corte; });
  }
  const out = {
    ok: true, divisao: lerConfig().divisao, incremental: !!req.desde, agora: agora,
    obras: obras.map(normObra), registros: regs.map(normReg), idsObras: idsObras,
    qtdHistorico: Math.max(0, (aba('obras_historico') ? aba('obras_historico').getLastRow() : 1) - 1)
  };
  if (p.papel !== 'empreiteira') out.empreiteiras = listaEmpreiteiras();
  return out;
}
function normObra(o) {
  try { o.postes = JSON.parse(o.postes || '[]'); } catch (err) { o.postes = []; }
  try { o.resumo = o.resumo ? JSON.parse(o.resumo) : null; } catch (err) { o.resumo = null; }
  try { o.folhas = o.folhas ? JSON.parse(o.folhas) : []; } catch (err) { o.folhas = []; }
  return o;
}
function normReg(r) {
  r.alt = r.alt ? String(r.alt).split(' | ') : [];
  r.invalido = r.invalido === 'SIM';
  r.gps = (r.lat !== '' && r.lat != null && r.lon !== '' && r.lon != null) ? { lat: r.lat, lon: r.lon, origem: r.gpsOrigem, precisao: r.precisao } : null;
  return r;
}

/** Empreiteiras ativas da aba "chaves" (papel = empreiteira), para a lista do empenho. */
function listaEmpreiteiras() {
  const sh = aba('chaves');
  if (!sh || sh.getLastRow() < 2) return [];
  const vistos = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    const ativa = String(r[4]).toUpperCase();
    if (normPapel(r[1]) === 'empreiteira' && r[2] && ativa !== 'NÃO' && ativa !== 'NAO') vistos[String(r[2]).trim()] = 1;
  });
  return Object.keys(vistos).sort(function (x, y) { return x.localeCompare(y, 'pt-BR'); });
}

/* ============================ obras ============================ */
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
  linha.folhas = JSON.stringify(salvarFolhas(req.folhas, id, 2));
  linha.criadoPor = p.responsavel || p.chave;
  linha.criadoEm = agoraIso();
  linha.atualizadoEm = linha.criadoEm;
  comTrava(function () { anexar('obras', linha); marcarAlteracao(); });
  return { ok: true, id: id };
}

/** Grava as imagens das folhas 2, 3… da planta no Drive. */
function salvarFolhas(lista, id, primeira) {
  if (!lista || !lista.length) return [];
  const pasta = DriveApp.getFolderById(lerConfig().pastaPlantas);
  return lista.map(function (f, i) {
    const arq = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(f.b64), 'image/jpeg', id + '_folha' + (primeira + i) + '.jpg'));
    return { id: arq.getId(), w: f.w, h: f.h };
  });
}

/** Acrescenta folhas (e os postes delas) a uma obra já empenhada. */
function adicionarFolhas(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode alterar a obra' };
  const o = ler('obras').filter(function (x) { return x.id === req.id; })[0];
  if (!o) return { ok: false, erro: 'obra não encontrada ou já concluída' };
  if (!req.folhas || !req.folhas.length) return { ok: false, erro: 'nenhuma folha enviada' };
  let folhas = [], postes = [];
  try { folhas = o.folhas ? JSON.parse(o.folhas) : []; } catch (err) { }
  try { postes = JSON.parse(o.postes || '[]'); } catch (err) { }
  const base = folhas.length + 1;  // índice (0 = folha 1) da primeira folha nova
  const novas = salvarFolhas(req.folhas, o.id, base + 1);
  const usados = {}; postes.forEach(function (x) { usados[x.n] = 1; });
  let incluidos = 0;
  (req.postes || []).forEach(function (x) {
    if (usados[x.n]) return;
    usados[x.n] = 1; incluidos++;
    postes.push({ n: x.n, x: x.x, y: x.y, nota: x.nota || '', acao: x.acao || '', estruturas: x.estruturas || [], f: base + (Number(x.f) || 0) });
  });
  let ok = false;
  comTrava(function () {
    ok = atualizarLinha('obras', o.id, { folhas: JSON.stringify(folhas.concat(novas)), postes: JSON.stringify(postes), atualizadoEm: agoraIso() });
    marcarAlteracao();
  });
  return ok ? { ok: true, folhas: novas.length, postes: incluidos } : { ok: false, erro: 'não foi possível gravar' };
}

function atualizarObra(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode alterar a obra' };
  if (req.campos && req.campos.status === 'concluida') return concluir(p, req);
  const campos = {};
  EDITAVEIS_OBRA.forEach(function (k) {
    if (req.campos && req.campos[k] !== undefined) campos[k] = k === 'postes' ? JSON.stringify(req.campos[k]) : req.campos[k];
  });
  campos.atualizadoEm = agoraIso();
  let ok = false;
  comTrava(function () { ok = atualizarLinha('obras', req.id, campos); marcarAlteracao(); });
  return ok ? { ok: true } : { ok: false, erro: 'obra não encontrada' };
}

/** Conclui a obra: move a obra e todos os registros dela para as abas de histórico. */
function concluir(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode encerrar a obra' };
  let res = { ok: false, erro: 'obra não encontrada' };
  comTrava(function () { if (encerrarObra(req.id, 'manual · ' + (p.responsavel || p.papel))) res = { ok: true }; });
  return res;
}
/** Move a obra e seus registros para o histórico (chamar dentro de comTrava). */
function encerrarObra(id, motivo) {
  const row = buscarLinha('obras', id);
  if (!row) return false;
  const o = linhaObj('obras', row);
  const regs = ler('registros').filter(function (r) { return r.obra === id; });
  const agora = agoraIso();
  o.status = 'concluida';
  o.concluidaEm = agora;
  o.atualizadoEm = agora;
  o.encerramento = motivo || '';
  o.resumo = JSON.stringify(resumoObra(o, regs));
  anexar('obras_historico', o);
  moverLinhas('registros', 'registros_historico', id, null);
  aba('obras').deleteRow(row);
  marcarAlteracao();
  return true;
}

/** Reabre uma obra concluída: volta do histórico para as abas ativas. */
function reabrir(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode reabrir a obra' };
  let res = { ok: false, erro: 'obra não encontrada no histórico' };
  comTrava(function () {
    const row = buscarLinha('obras_historico', req.id);
    if (!row) return;
    const o = linhaObj('obras_historico', row);
    const agora = agoraIso();
    o.status = 'ativa';
    o.concluidaEm = '';
    o.resumo = '';
    o.encerramento = '';
    o.atualizadoEm = agora;
    anexar('obras', o);
    moverLinhas('registros_historico', 'registros', req.id, agora);
    aba('obras_historico').deleteRow(row);
    marcarAlteracao();
    res = { ok: true };
  });
  return res;
}

function historico(p) {
  let L = ler('obras_historico');
  if (p.papel === 'empreiteira') L = L.filter(function (o) { return norm(o.empreiteira) === norm(p.empresa); });
  return {
    ok: true, obras: L.map(function (o) {
      let resumo = null; try { resumo = o.resumo ? JSON.parse(o.resumo) : null; } catch (err) { }
      return { id: o.id, projeto: o.projeto, descricao: o.descricao, cliente: o.cliente, municipio: o.municipio, empreiteira: o.empreiteira,
        us: o.us, aes: o.aes, pep: o.pep, empenhoEm: o.empenhoEm, prazo: o.prazo, concluidaEm: o.concluidaEm, encerramento: o.encerramento, resumo: resumo };
    })
  };
}

function obraHistorico(p, req) {
  const o = ler('obras_historico').filter(function (x) { return x.id === req.id; })[0];
  if (!o) return { ok: false, erro: 'obra não encontrada no histórico' };
  if (p.papel === 'empreiteira' && norm(o.empreiteira) !== norm(p.empresa)) return { ok: false, erro: 'esta obra não é da sua empresa' };
  const regs = ler('registros_historico').filter(function (r) { return r.obra === req.id; });
  return { ok: true, obra: normObra(o), registros: regs.map(normReg) };
}

/**
 * Situação por poste: última execução válida e última fiscalização válida.
 * A aprovação do fiscal só vale se for posterior à última execução do poste.
 */
function situacaoPostes(o, regs) {
  let postes = [];
  try { postes = typeof o.postes === 'string' ? JSON.parse(o.postes || '[]') : (o.postes || []); } catch (err) { }
  const quando = function (r) { return String(r.marcadoEm || r.recebidoEm); };
  const ex = {}, fi = {};
  regs.filter(function (r) { return r.invalido !== 'SIM' && r.invalido !== true; })
    .sort(function (a, b) { return quando(a).localeCompare(quando(b)); })
    .forEach(function (r) {
      const k = r.tipo === 'novo' ? 'N:' + r.id : r.poste;
      if (TIPOS_FISC.indexOf(r.tipo) >= 0) fi[k] = { t: r.tipo, em: quando(r) };
      else ex[k] = { t: r.tipo, em: quando(r) };
    });
  const chaves = postes.map(function (pp) { return 'P' + pp.n; }).concat(Object.keys(ex).filter(function (k) { return k.indexOf('N:') === 0; }));
  let ok = 0, alt = 0, bad = 0, fis = 0, rep = 0, fisPrev = 0;
  chaves.forEach(function (k) {
    const e = ex[k], f = fi[k];
    if (e && e.t === 'conforme') ok++; else if (e && e.t === 'alterado') alt++; else if (e && e.t === 'nao') bad++;
    const valida = f && e && f.em >= e.em;
    if (valida && f.t === 'aprovado') { fis++; if (k.indexOf('P') === 0) fisPrev++; }
    if (valida && f.t === 'reprovado') rep++;
  });
  return { postes: postes, chaves: chaves, ok: ok, alt: alt, bad: bad, fis: fis, fisPrev: fisPrev, rep: rep };
}
function resumoObra(o, regs) {
  const s = situacaoPostes(o, regs);
  const tot = s.postes.length, exec = s.ok + s.alt;
  const us = Number(o.us) || 0;
  return { tot: tot, ok: s.ok, alt: s.alt, bad: s.bad, exec: exec, novos: s.chaves.length - tot, fiscalizados: s.fisPrev, reprovados: s.rep,
    registros: regs.length, usExec: tot ? Math.round(us * exec / tot) : 0, usMedida: tot ? Math.round(us * s.fisPrev / tot) : 0 };
}
/** Todos os postes (previstos e não previstos) aprovados pelo fiscal? */
function obraFiscalizada(o, regs) {
  const s = situacaoPostes(o, regs);
  return s.chaves.length > 0 && s.fis === s.chaves.length;
}

/* ============================ registros ============================ */
function registrar(p, req) {
  const r = req.registro || {};
  if (!r.id || !r.obra || !r.tipo) return { ok: false, erro: 'registro incompleto' };
  if (TIPOS_EXEC.indexOf(r.tipo) < 0 && TIPOS_FISC.indexOf(r.tipo) < 0) return { ok: false, erro: 'tipo inválido' };
  if (TIPOS_FISC.indexOf(r.tipo) >= 0 && p.papel === 'empreiteira') return { ok: false, erro: 'só a fiscalização pode aprovar ou reprovar postes' };
  const obra = ler('obras').filter(function (o) { return o.id === r.obra; })[0];
  if (!obra) return { ok: false, erro: 'obra não encontrada ou já concluída' };
  if (p.papel === 'empreiteira' && norm(obra.empreiteira) !== norm(p.empresa)) return { ok: false, erro: 'esta obra não é da sua empresa' };
  // idempotente: o celular pode reenviar o mesmo registro quando o sinal volta
  if (buscarLinha('registros', r.id)) return { ok: true, id: r.id, repetido: true };
  let fotoId = '';
  if (req.foto && req.foto.b64) {
    const nome = obra.projeto + '_' + String(r.poste || 'novo').replace(/[^A-Za-z0-9]/g, '') + '_' + r.id + '.jpg';
    fotoId = DriveApp.getFolderById(lerConfig().pastaFotos)
      .createFile(Utilities.newBlob(Utilities.base64Decode(req.foto.b64), 'image/jpeg', nome)).getId();
  }
  const g = r.gps || {};
  const agora = agoraIso();
  const linha = {
    id: r.id, obra: r.obra, poste: r.poste || '', tipo: r.tipo, alt: (r.alt || []).join(' | '), obs: r.obs || '',
    fotoId: fotoId, lat: g.lat != null ? g.lat : '', lon: g.lon != null ? g.lon : '', gpsOrigem: g.origem || '',
    precisao: g.precisao != null ? g.precisao : '', dataExec: r.dataExec || '', marcadoEm: r.marcadoEm || '',
    recebidoEm: agora, nome: r.nome || p.responsavel || '', empresa: p.papel === 'empreiteira' ? p.empresa : (r.empresa || p.empresa),
    x: r.x != null ? r.x : '', y: r.y != null ? r.y : '', invalido: '', invalidadoPor: '', alteradoEm: agora,
    folha: r.folha != null ? r.folha : ''
  };
  let encerrada = false;
  comTrava(function () {
    if (!buscarLinha('registros', r.id)) { anexar('registros', linha); marcarAlteracao(); }
    // última aprovação do fiscal: a obra vai sozinha para encerramento final
    if (r.tipo === 'aprovado') {
      const regsObra = ler('registros').filter(function (x) { return x.obra === r.obra; });
      if (obraFiscalizada(obra, regsObra)) encerrada = encerrarObra(r.obra, 'fiscalização concluída · ' + (r.nome || p.responsavel || p.papel));
    }
  });
  return { ok: true, id: r.id, fotoId: fotoId, encerrada: encerrada };
}

/** Fiscal aprova/reprova vários postes de uma vez (botão "Aprovar todos os executados"). */
function fiscalizarLote(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'só a fiscalização pode aprovar ou reprovar postes' };
  const L = (req.registros || []).filter(function (r) { return r && r.id && r.obra && TIPOS_FISC.indexOf(r.tipo) >= 0; });
  if (!L.length) return { ok: false, erro: 'nada para registrar' };
  const idObra = L[0].obra;
  const obra = ler('obras').filter(function (o) { return o.id === idObra; })[0];
  if (!obra) return { ok: false, erro: 'obra não encontrada ou já concluída' };
  const agora = agoraIso();
  let encerrada = false, gravados = 0;
  comTrava(function () {
    L.forEach(function (r) {
      if (r.obra !== idObra || buscarLinha('registros', r.id)) return;
      anexar('registros', {
        id: r.id, obra: r.obra, poste: r.poste || '', tipo: r.tipo, alt: (r.alt || []).join(' | '), obs: r.obs || '', fotoId: '',
        lat: '', lon: '', gpsOrigem: '', precisao: '', dataExec: r.dataExec || '', marcadoEm: r.marcadoEm || agora, recebidoEm: agora,
        nome: r.nome || p.responsavel || '', empresa: r.empresa || p.empresa, x: '', y: '', invalido: '', invalidadoPor: '', alteradoEm: agora, folha: ''
      });
      gravados++;
    });
    if (gravados) marcarAlteracao();
    const regsObra = ler('registros').filter(function (x) { return x.obra === idObra; });
    if (obraFiscalizada(obra, regsObra)) encerrada = encerrarObra(idObra, 'fiscalização concluída · ' + (L[0].nome || p.responsavel || p.papel));
  });
  return { ok: true, gravados: gravados, encerrada: encerrada };
}

function invalidar(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'só a fiscalização pode desconsiderar registros' };
  let ok = false;
  comTrava(function () {
    const agora = agoraIso();
    ok = atualizarLinha('registros', req.id, { invalido: req.invalido ? 'SIM' : '', invalidadoPor: req.invalido ? (p.responsavel || p.papel) + ' · ' + agora : '', alteradoEm: agora });
    marcarAlteracao();
  });
  return ok ? { ok: true } : { ok: false, erro: 'registro não encontrado' };
}

/* ============================ planilha ============================ */
function aba(nome) { return SpreadsheetApp.getActive().getSheetByName(nome); }

function converter(k, v, tz) {
  if (v instanceof Date) v = COL_DATA.indexOf(k) >= 0 ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
  if (COL_NUM.indexOf(k) >= 0 && v !== '' && v !== null) { const n = Number(String(v).replace(',', '.')); v = isNaN(n) ? '' : n; }
  return v;
}

function ler(nome) {
  const sh = aba(nome);
  if (!sh || sh.getLastRow() < 2) return [];
  const cab = ABAS[nome];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, cab.length).getValues();
  const tz = Session.getScriptTimeZone();
  return vals.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const o = {};
    cab.forEach(function (k, i) { o[k] = converter(k, r[i], tz); });
    return o;
  });
}

function linhaObj(nome, row) {
  const cab = ABAS[nome];
  const r = aba(nome).getRange(row, 1, 1, cab.length).getValues()[0];
  const o = {}; const tz = Session.getScriptTimeZone();
  cab.forEach(function (k, i) { o[k] = r[i] instanceof Date ? converter(k, r[i], tz) : r[i]; });
  return o;
}

function anexar(nome, obj) {
  const cab = ABAS[nome];
  const sh = aba(nome);
  const linha = cab.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : String(obj[k]); });
  const rg = sh.getRange(sh.getLastRow() + 1, 1, 1, cab.length);
  rg.setNumberFormat('@');
  rg.setValues([linha]);
}

/** Move todas as linhas de uma obra entre abas de registros (opcionalmente marcando alteradoEm). */
function moverLinhas(de, para, obraId, alteradoEm) {
  const shDe = aba(de), shPara = aba(para);
  if (!shDe || shDe.getLastRow() < 2) return 0;
  const cab = ABAS[de];
  const cObra = cab.indexOf('obra'), cAlt = cab.indexOf('alteradoEm');
  const vals = shDe.getRange(2, 1, shDe.getLastRow() - 1, cab.length).getValues();
  const linhas = [], rows = [];
  vals.forEach(function (r, i) {
    if (r[cObra] === obraId) {
      const c = r.map(function (v) { return v instanceof Date ? v.toISOString() : String(v); });
      if (alteradoEm) c[cAlt] = alteradoEm;
      linhas.push(c); rows.push(i + 2);
    }
  });
  if (!linhas.length) return 0;
  const rg = shPara.getRange(shPara.getLastRow() + 1, 1, linhas.length, cab.length);
  rg.setNumberFormat('@');
  rg.setValues(linhas);
  // apaga de baixo para cima, em blocos contínuos
  rows.sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    shDe.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  return linhas.length;
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

/** Marca a hora da última alteração: o app usa isso para não reler a planilha à toa. */
function marcarAlteracao() {
  try { PropertiesService.getScriptProperties().setProperty('ult', agoraIso()); } catch (err) { }
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
  const papel = normPapel(r[1]);
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
