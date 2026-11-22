/**
 * Fiscalização de Obras · servidor da divisão (Apps Script da planilha)
 * ---------------------------------------------------------------------
 * Cole este arquivo inteiro em Extensões > Apps Script da planilha da divisão.
 * Primeira vez: menu Fiscalização > 1. Configurar  e  Implantar > Nova implantação > App da Web
 *   (Executar como: Eu · Quem pode acessar: Qualquer pessoa).
 * Para atualizar o código depois: Implantar > Gerenciar implantações > ✏️ > Versão: Nova versão > Implantar.
 * NUNCA use "Nova implantação" de novo, porque o endereço muda e o app perde a conexão.
 */
const VERSAO_SERVIDOR = '1.13';

const COLS_OBRAS = ['id', 'projeto', 'ose', 'descricao', 'cliente', 'local', 'municipio', 'projetista', 'empreiteira', 'aes', 'us',
  'empenhoEm', 'prazo', 'status', 'lat', 'lon', 'locOrigem', 'plantaId', 'plantaW', 'plantaH', 'pdfId', 'pdfNome',
  'postes', 'criadoPor', 'criadoEm', 'atualizadoEm', 'concluidaEm', 'resumo', 'pep', 'encerramento', 'folhas'];
const COLS_REGS = ['id', 'obra', 'poste', 'tipo', 'alt', 'obs', 'fotoId', 'lat', 'lon', 'gpsOrigem', 'precisao', 'dataExec',
  'marcadoEm', 'recebidoEm', 'nome', 'empresa', 'x', 'y', 'invalido', 'invalidadoPor', 'alteradoEm', 'folha'];
const COLS_DOCS = ['id', 'obra', 'projeto', 'pep', 'empreiteira', 'tipo', 'nome', 'pdfId', 'hash', 'enviadoPor', 'enviadoEm', 'status',
  'assinadoPor', 'assinadoEm', 'assinaturaChave', 'dispositivo', 'pdfAssinadoId', 'hashAssinado', 'alteradoEm', 'parcial', 'medicao', 'aes'];
const TIPOS_DOC = ['AES', 'BMD parcial', 'BMD final', 'BMD', 'FF', 'Vistoria', 'Outro'];
const COLS_ASS = ['id', 'empresa', 'nome', 'cargo', 'imgId', 'pinHash', 'sal', 'criadoEm', 'criadoPor', 'ativo', 'tentativas', 'ultimoUso', 'aceiteTermo'];
const TERMO_VERSAO = 'termo-v1';
const COLS_PDE = ['id', 'obra', 'projeto', 'pep', 'municipio', 'empreiteira', 'tipo', 'fiscal', 'postes', 'folhas', 'operacional', 'data', 'horaIni', 'horaFim',
  'pessoas', 'servicos', 'encarregado', 'telefone', 'obs', 'status', 'numeroPde', 'motivo', 'solicitadoEm', 'solicitadoPor', 'analisadoEm', 'analisadoPor', 'alteradoEm'];
const TIPOS_PDE = ['PDE', 'PLV', 'DEC Voluntário'];
const COLS_AES = ['id', 'aes', 'emitidaEm', 'orgao', 'empreiteiraAes', 'cnpj', 'empreiteira', 'contrato', 'item', 'progOrc', 'pep', 'pepOdd',
  'tipoObra', 'prazo', 'us', 'custo', 'projeto', 'obra', 'pdfId', 'criadoPor', 'criadoEm', 'alteradoEm'];
const ABAS = {
  obras: COLS_OBRAS,
  registros: COLS_REGS,
  chaves: ['chave', 'papel', 'empresa', 'responsavel', 'ativa', 'criadaEm', 'ultimoUso'],
  config: ['item', 'valor'],
  obras_historico: COLS_OBRAS,
  registros_historico: COLS_REGS,
  documentos: COLS_DOCS,
  assinantes: COLS_ASS,
  aes: COLS_AES,
  pde: COLS_PDE
};
const COL_DATA = ['empenhoEm', 'prazo', 'dataExec'];
const COL_NUM = ['us', 'lat', 'lon', 'plantaW', 'plantaH', 'precisao', 'x', 'y', 'folha', 'custo'];
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
      case 'armazenamento': return json(armazenamento(p));
      case 'obraHistorico': return json(obraHistorico(p, req));
      case 'pdfObra': return json(pdfObra(p, req));
      case 'atualizarPlantas': return json(atualizarPlantas(p, req));
      case 'registrar': return json(registrar(p, req));
      case 'fiscalizarLote': return json(fiscalizarLote(p, req));
      case 'adicionarFolhas': return json(adicionarFolhas(p, req));
      case 'invalidar': return json(invalidar(p, req));
      case 'documentos': return json(documentos(p, req));
      case 'enviarDocumento': return json(enviarDocumento(p, req));
      case 'encerramentoDocs': return json(encerramentoDocs(p, req));
      case 'docPdf': return json(docPdf(p, req));
      case 'assinarDocumento': return json(assinarDocumento(p, req));
      case 'removerDocumento': return json(removerDocumento(p, req));
      case 'assinantes': return json(assinantes(p, req));
      case 'registrarAes': return json(registrarAes(p, req));
      case 'solicitarPde': return json(solicitarPde(p, req));
      case 'pdes': return json(pdes(p, req));
      case 'analisarPde': return json(analisarPde(p, req));
      case 'cancelarPde': return json(cancelarPde(p, req));
      case 'removerAes': return json(removerAes(p, req));
      case 'cadastrarAssinante': return json(cadastrarAssinante(p, req));
      case 'imgAssinante': return json(imgAssinante(p, req));
      case 'revogarAssinante': return json(revogarAssinante(p, req));
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
  out.docs = resumoDocs(p);
  out.pde = resumoPde(p);
  out.fiscais = listaFiscais();
  if (p.papel === 'gestor') out.aes = ler('aes').filter(function (a) { return !a.obra; });
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
  comTrava(function () {
    anexar('obras', linha);
    if (req.aesItem) atualizarLinha('aes', req.aesItem, { obra: id, alteradoEm: agoraIso() });
    marcarAlteracao();
  });
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
  let fiscalizada = false;
  comTrava(function () {
    if (!buscarLinha('registros', r.id)) { anexar('registros', linha); marcarAlteracao(); }
    // última aprovação: a obra fica "aguardando FF" (o encerramento é quando o fiscal envia a FF)
    if (r.tipo === 'aprovado') {
      const regsObra = ler('registros').filter(function (x) { return x.obra === r.obra; });
      fiscalizada = obraFiscalizada(obra, regsObra);
    }
  });
  return { ok: true, id: r.id, fotoId: fotoId, fiscalizada: fiscalizada };
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
  let fiscalizada = false, gravados = 0;
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
    fiscalizada = obraFiscalizada(obra, regsObra);
  });
  return { ok: true, gravados: gravados, fiscalizada: fiscalizada };
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

/* ============================ documentos para assinatura (BMD, FF, vistoria) ============================ */
/** Pasta dos documentos: privada (não é compartilhada por link); só sai pelo app, com código de acesso. */
function pastaDocs() {
  const cfg = lerConfig();
  if (cfg.pastaDocs) { try { return DriveApp.getFolderById(cfg.pastaDocs); } catch (e) { } }
  const f = DriveApp.createFolder('Fiscalização ' + (cfg.divisao || '') + ' · documentos assinados');
  salvarConfig('pastaDocs', f.getId());
  return f;
}
function sha256(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function docsVisiveis(p) {
  const L = ler('documentos');
  return p.papel === 'empreiteira' ? L.filter(function (d) { return norm(d.empreiteira) === norm(p.empresa); }) : L;
}
function resumoDocs(p) {
  const L = docsVisiveis(p);
  const A = ler('assinantes').filter(function (a) { return a.ativo === 'SIM' && (p.papel !== 'empreiteira' || norm(a.empresa) === norm(p.empresa)); });
  return { pendentes: L.filter(function (d) { return d.status !== 'assinado'; }).length, total: L.length, assinantes: A.length };
}
function docPublico(d) {
  const o = {};
  COLS_DOCS.forEach(function (k) { if (k !== 'assinaturaChave') o[k] = d[k]; });
  o.chaveFinal = d.assinaturaChave ? String(d.assinaturaChave).slice(-4) : '';
  try { o.medicao = d.medicao ? JSON.parse(d.medicao) : null; } catch (e) { o.medicao = null; }
  return o;
}
function documentos(p, req) {
  let L = docsVisiveis(p);
  if (req.obra) {
    const ob = acharObraQualquer(req.obra); const aesObra = ob && ob.aes ? String(ob.aes) : '';
    L = L.filter(function (d) { return d.obra === req.obra || (d.tipo === 'AES' && aesObra && String(d.aes) === aesObra); });
  }
  L.sort(function (a, b) { return String(b.enviadoEm).localeCompare(String(a.enviadoEm)); });
  return { ok: true, documentos: L.map(docPublico) };
}
function acharObraQualquer(id) {
  return ler('obras').filter(function (o) { return o.id === id; })[0] || ler('obras_historico').filter(function (o) { return o.id === id; })[0] || null;
}
function enviarDocumento(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'só a Copel envia documentos para assinatura' };
  const o = acharObraQualquer(req.obra);
  if (!o) return { ok: false, erro: 'obra não encontrada' };
  if (!req.pdf || !req.pdf.b64) return { ok: false, erro: 'PDF não enviado' };
  const tipo = TIPOS_DOC.indexOf(req.tipo) >= 0 ? req.tipo : 'Outro';
  const bytes = Utilities.base64Decode(req.pdf.b64);
  const id = 'D' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const nome = req.pdf.nome || (tipo + '_' + o.projeto + '.pdf');
  const arq = pastaDocs().createFile(Utilities.newBlob(bytes, 'application/pdf', o.projeto + '_' + tipo + '_' + id + '.pdf'));
  const agora = agoraIso();
  const linha = {
    id: id, obra: o.id, projeto: o.projeto, pep: o.pep || '', empreiteira: o.empreiteira, tipo: tipo, nome: nome, pdfId: arq.getId(),
    hash: sha256(bytes), enviadoPor: p.responsavel || p.papel, enviadoEm: agora, status: 'aguardando', alteradoEm: agora, parcial: '', medicao: ''
  };
  let encerrada = false;
  comTrava(function () {
    if (tipo === 'BMD parcial') {
      linha.parcial = String(ler('documentos').filter(function (d) { return d.obra === o.id && d.tipo === 'BMD parcial'; }).length + 1);
      linha.medicao = req.medicao ? JSON.stringify(req.medicao) : '';
    }
    anexar('documentos', linha);
    // FF emitida: a obra é encerrada e vai para o histórico
    if (tipo === 'FF' && buscarLinha('obras', o.id)) encerrada = encerrarObra(o.id, 'FF enviada · ' + (p.responsavel || p.papel));
    marcarAlteracao();
  });
  return { ok: true, documento: docPublico(linha), encerrada: encerrada };
}
/** Encerramento: BMD final + FF + Vistoria juntos; a obra vai para o histórico. */
function encerramentoDocs(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'só a Copel envia documentos para assinatura' };
  const o = ler('obras').filter(function (x) { return x.id === req.obra; })[0];
  if (!o) return { ok: false, erro: 'obra não encontrada ou já encerrada' };
  const D = req.docs || {}; const tipos = [['bmd', 'BMD final'], ['vistoria', 'Vistoria'], ['ff', 'FF']];
  const falta = tipos.filter(function (t) { return !D[t[0]] || !D[t[0]].b64; }).map(function (t) { return t[1]; });
  if (falta.length) return { ok: false, erro: 'faltam: ' + falta.join(', ') };
  const agora = agoraIso(); const pasta = pastaDocs();
  const linhas = tipos.map(function (t, i) {
    const bytes = Utilities.base64Decode(D[t[0]].b64);
    const id = 'D' + Date.now().toString(36) + i + Math.floor(Math.random() * 1e4).toString(36);
    const arq = pasta.createFile(Utilities.newBlob(bytes, 'application/pdf', o.projeto + '_' + t[1].replace(' ', '_') + '_' + id + '.pdf'));
    return { id: id, obra: o.id, projeto: o.projeto, pep: o.pep || '', empreiteira: o.empreiteira, tipo: t[1], nome: D[t[0]].nome || (t[1] + '_' + o.projeto + '.pdf'),
      pdfId: arq.getId(), hash: sha256(bytes), enviadoPor: p.responsavel || p.papel, enviadoEm: agora, status: 'aguardando', alteradoEm: agora, parcial: '', medicao: '', aes: '' };
  });
  let encerrada = false;
  comTrava(function () {
    linhas.forEach(function (l) { anexar('documentos', l); });
    encerrada = encerrarObra(o.id, 'BMD final, FF e vistoria enviados · ' + (p.responsavel || p.papel));
    marcarAlteracao();
  });
  return { ok: true, encerrada: encerrada, documentos: linhas.map(docPublico) };
}
function docPdf(p, req) {
  const d = docsVisiveis(p).filter(function (x) { return x.id === req.id; })[0];
  if (!d) return { ok: false, erro: 'documento não encontrado' };
  const assinado = req.versao === 'assinado';
  if (assinado && !d.pdfAssinadoId) return { ok: false, erro: 'documento ainda não assinado' };
  const blob = DriveApp.getFileById(assinado ? d.pdfAssinadoId : d.pdfId).getBlob();
  return { ok: true, b64: Utilities.base64Encode(blob.getBytes()), nome: (assinado ? 'ASSINADO_' : '') + d.nome, hash: assinado ? d.hashAssinado : d.hash };
}
function assinarDocumento(p, req) {
  if (p.papel !== 'empreiteira') return { ok: false, erro: 'quem assina é a empreiteira' };
  const d = docsVisiveis(p).filter(function (x) { return x.id === req.id; })[0];
  if (!d) return { ok: false, erro: 'documento não encontrado' };
  if (d.status === 'assinado') return { ok: true, repetido: true, documento: docPublico(d) };
  if (!req.pdf || !req.pdf.b64) return { ok: false, erro: 'PDF assinado não enviado' };
  const chk = conferirPin(p, req.assinante, req.pin);
  if (!chk.ok) return chk;
  const as = chk.assinante;
  // confere que o PDF assinado partiu do mesmo original que a Copel enviou
  const hashOrig = sha256(DriveApp.getFileById(d.pdfId).getBlob().getBytes());
  if (hashOrig !== d.hash || req.hashOriginal !== d.hash) return { ok: false, erro: 'o documento original foi alterado; peça um novo envio' };
  const bytes = Utilities.base64Decode(req.pdf.b64);
  const arq = pastaDocs().createFile(Utilities.newBlob(bytes, 'application/pdf', 'ASSINADO_' + d.projeto + '_' + d.tipo + '_' + d.id + '.pdf'));
  const campos = {
    status: 'assinado', assinadoPor: as.nome + (as.cargo ? ' (' + as.cargo + ')' : '') + ' · ' + p.empresa, assinadoEm: req.assinadoEm || agoraIso(), assinaturaChave: p.chave,
    dispositivo: String(req.dispositivo || '').slice(0, 200), pdfAssinadoId: arq.getId(), hashAssinado: sha256(bytes), alteradoEm: agoraIso()
  };
  let ok = false;
  comTrava(function () { ok = atualizarLinha('documentos', d.id, campos); marcarAlteracao(); });
  if (!ok) return { ok: false, erro: 'não foi possível gravar' };
  Object.keys(campos).forEach(function (k) { d[k] = campos[k]; });
  return { ok: true, documento: docPublico(d) };
}
function removerDocumento(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'sem permissão' };
  const d = ler('documentos').filter(function (x) { return x.id === req.id; })[0];
  if (!d) return { ok: false, erro: 'documento não encontrado' };
  if (d.status === 'assinado') return { ok: false, erro: 'documento já assinado não pode ser removido' };
  let ok = false;
  comTrava(function () {
    const row = buscarLinha('documentos', d.id);
    if (row) { aba('documentos').deleteRow(row); ok = true; marcarAlteracao(); }
  });
  try { DriveApp.getFileById(d.pdfId).setTrashed(true); } catch (e) { }
  return { ok: ok };
}

/* ---------- assinantes da empreiteira (assinatura desenhada + PIN) ---------- */
function hashPin(pin, sal) { return sha256(Utilities.newBlob(String(sal) + ':' + String(pin)).getBytes()); }
function assPublico(a) { return { id: a.id, empresa: a.empresa, nome: a.nome, cargo: a.cargo, criadoEm: a.criadoEm, ativo: a.ativo, ultimoUso: a.ultimoUso, bloqueado: Number(a.tentativas || 0) >= 5 }; }
function assinantes(p, req) {
  const L = ler('assinantes').filter(function (a) { return a.ativo === 'SIM' && (p.papel !== 'empreiteira' || norm(a.empresa) === norm(p.empresa)); });
  return { ok: true, assinantes: L.map(assPublico) };
}
function cadastrarAssinante(p, req) {
  if (p.papel !== 'empreiteira') return { ok: false, erro: 'o cadastro de assinatura é feito pela empreiteira' };
  const nome = String(req.nome || '').trim(), pin = String(req.pin || '');
  if (nome.length < 5) return { ok: false, erro: 'informe o nome completo' };
  if (!/^\d{6}$/.test(pin)) return { ok: false, erro: 'o PIN deve ter 6 números' };
  if (!req.img) return { ok: false, erro: 'desenhe a assinatura' };
  if (!req.aceite) return { ok: false, erro: 'é preciso aceitar o termo' };
  const id = 'A' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const arq = pastaDocs().createFile(Utilities.newBlob(Utilities.base64Decode(req.img), 'image/png', 'assinatura_' + norm(p.empresa).replace(/\s+/g, '_') + '_' + id + '.png'));
  const sal = Utilities.getUuid();
  const agora = agoraIso();
  const linha = { id: id, empresa: p.empresa, nome: nome, cargo: String(req.cargo || '').trim(), imgId: arq.getId(), pinHash: hashPin(pin, sal), sal: sal,
    criadoEm: agora, criadoPor: 'código final ' + String(p.chave).slice(-4), ativo: 'SIM', tentativas: '0', ultimoUso: '', aceiteTermo: TERMO_VERSAO + ' · ' + agora };
  comTrava(function () { anexar('assinantes', linha); marcarAlteracao(); });
  return { ok: true, assinante: assPublico(linha) };
}
function acharAssinante(p, id) {
  return ler('assinantes').filter(function (a) { return a.id === id && a.ativo === 'SIM' && (p.papel !== 'empreiteira' || norm(a.empresa) === norm(p.empresa)); })[0] || null;
}
function imgAssinante(p, req) {
  const a = acharAssinante(p, req.id);
  if (!a) return { ok: false, erro: 'assinatura não encontrada' };
  return { ok: true, b64: Utilities.base64Encode(DriveApp.getFileById(a.imgId).getBlob().getBytes()) };
}
function revogarAssinante(p, req) {
  if (p.papel === 'fiscal') return { ok: false, erro: 'sem permissão' };
  const a = acharAssinante(p, req.id);
  if (!a) return { ok: false, erro: 'assinatura não encontrada' };
  let ok = false;
  comTrava(function () { ok = atualizarLinha('assinantes', a.id, { ativo: 'NÃO' }); marcarAlteracao(); });
  return { ok: ok };
}
/** Confere o PIN; 5 erros seguidos bloqueiam (a empresa cadastra a assinatura de novo ou o gestor revoga). */
function conferirPin(p, id, pin) {
  const a = acharAssinante(p, id);
  if (!a) return { ok: false, erro: 'assinatura não encontrada: cadastre a assinatura do responsável' };
  const t = Number(a.tentativas || 0);
  if (t >= 5) return { ok: false, erro: 'assinatura bloqueada por 5 PINs errados; cadastre a assinatura de novo' };
  if (hashPin(pin, a.sal) !== a.pinHash) {
    comTrava(function () { atualizarLinha('assinantes', a.id, { tentativas: String(t + 1) }); });
    return { ok: false, erro: 'PIN incorreto (' + (4 - t) + ' tentativa(s) restante(s))' };
  }
  comTrava(function () { atualizarLinha('assinantes', a.id, { tentativas: '0', ultimoUso: agoraIso() }); });
  return { ok: true, assinante: a };
}

/* ============================ AES (autorização para execução) ============================ */
/** Registra os itens (projetos) de uma AES. Reenviar a mesma AES atualiza os itens, sem duplicar. */
function registrarAes(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor registra AES' };
  const a = req.aes || {};
  if (!a.numero || !a.itens || !a.itens.length) return { ok: false, erro: 'AES sem número ou sem itens' };
  if (!a.empreiteira) return { ok: false, erro: 'informe a empreiteira (como está na aba chaves)' };
  let pdfId = '', bytesAes = null;
  if (req.pdf && req.pdf.b64) {
    bytesAes = Utilities.base64Decode(req.pdf.b64);
    pdfId = DriveApp.getFolderById(lerConfig().pastaPdfs).createFile(Utilities.newBlob(bytesAes, 'application/pdf', 'AES_' + a.numero + '.pdf')).getId();
  }
  const agora = agoraIso();
  const obras = ler('obras');
  let novos = 0, atualizados = 0, vinculados = 0, docAes = false;
  comTrava(function () {
    a.itens.forEach(function (it) {
      const id = 'AES' + a.numero + '-' + it.item;
      const campos = { aes: a.numero, emitidaEm: a.data || '', orgao: a.orgao || '', empreiteiraAes: a.empreiteiraAes || '', cnpj: a.cnpj || '', empreiteira: a.empreiteira,
        contrato: a.contrato || '', item: it.item, progOrc: it.progOrc || '', pep: it.pep || '', pepOdd: it.pepOdd || '', tipoObra: it.tipoObra || '',
        prazo: it.prazo || '', us: it.us, custo: it.custo, projeto: String(it.projeto || ''), alteradoEm: agora };
      if (pdfId) campos.pdfId = pdfId;
      // obra do mesmo projeto já empenhada antes da AES: vincula e completa o que estiver vazio
      const ob = obras.filter(function (o) { return String(o.projeto) === String(it.projeto); })[0];
      const existente = buscarLinha('aes', id);
      if (existente) { atualizarLinha('aes', id, campos); atualizados++; }
      else { campos.id = id; campos.criadoPor = p.responsavel || p.chave; campos.criadoEm = agora; campos.obra = ''; anexar('aes', campos); novos++; }
      if (ob) {
        const lin = ler('aes').filter(function (x) { return x.id === id; })[0];
        if (lin && !lin.obra) {
          atualizarLinha('aes', id, { obra: ob.id });
          const comp = {};
          if (!ob.aes) comp.aes = a.numero;
          if (!ob.pep && it.pep) comp.pep = it.pep;
          if (!ob.prazo && it.prazo) comp.prazo = it.prazo;
          comp.atualizadoEm = agora;
          atualizarLinha('obras', ob.id, comp);
          vinculados++;
        }
      }
    });
    // a empreiteira também assina a AES (um documento por AES; reenviar não duplica)
    if (bytesAes && req.assinar !== false) {
      const ja = ler('documentos').filter(function (d) { return d.tipo === 'AES' && String(d.aes) === String(a.numero) && norm(d.empreiteira) === norm(a.empreiteira); })[0];
      if (!ja) {
        const idd = 'D' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        const arq = pastaDocs().createFile(Utilities.newBlob(bytesAes, 'application/pdf', 'AES_' + a.numero + '_' + idd + '.pdf'));
        anexar('documentos', { id: idd, obra: '', projeto: a.itens.map(function (it) { return it.projeto; }).join(', '), pep: '', empreiteira: a.empreiteira, tipo: 'AES',
          nome: 'AES_' + a.numero + '.pdf', pdfId: arq.getId(), hash: sha256(bytesAes), enviadoPor: p.responsavel || p.papel, enviadoEm: agora, status: 'aguardando', alteradoEm: agora, parcial: '', medicao: '', aes: a.numero });
        docAes = true;
      }
    }
    marcarAlteracao();
  });
  return { ok: true, novos: novos, atualizados: atualizados, vinculados: vinculados, docAes: docAes };
}
function removerAes(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'sem permissão' };
  let n = 0;
  comTrava(function () {
    const sh = aba('aes'); const L = ler('aes');
    for (let i = L.length - 1; i >= 0; i--) {
      if (L[i].aes === String(req.aes) && !L[i].obra && (!req.item || String(L[i].item) === String(req.item))) {
        const row = buscarLinha('aes', L[i].id); if (row) { sh.deleteRow(row); n++; }
      }
    }
    if (n) marcarAlteracao();
  });
  return { ok: true, removidos: n };
}

/* ============================ armazenamento (Drive da conta + células da planilha) ============================ */
function armazenamento(p) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'sem permissão' };
  const ss = SpreadsheetApp.getActive();
  const abas = ss.getSheets().map(function (sh) { return { nome: sh.getName(), linhas: sh.getMaxRows(), colunas: sh.getMaxColumns() }; });
  const celulas = abas.reduce(function (t, a) { return t + a.linhas * a.colunas; }, 0);
  let usado = null, limite = null;
  try { usado = DriveApp.getStorageUsed(); limite = DriveApp.getStorageLimit(); } catch (e) { }
  return { ok: true, drive: { usado: usado, limite: limite }, planilha: { celulas: celulas, limite: 10000000, abas: abas }, em: agoraIso() };
}

/* ============================ PDE / PLV (pedido da empreiteira → análise do fiscal) ============================ */
function listaFiscais() {
  const vistos = {}; const L = [];
  ler('chaves').forEach(function (r) {
    const nome = String(r.responsavel || '').trim();
    if (normPapel(r.papel) === 'fiscal' && String(r.ativa).toUpperCase() !== 'NÃO' && String(r.ativa).toUpperCase() !== 'NAO' && nome && !vistos[nome]) { vistos[nome] = 1; L.push(nome); }
  });
  return L.sort();
}
function pdesVisiveis(p) {
  const L = ler('pde');
  return p.papel === 'empreiteira' ? L.filter(function (d) { return norm(d.empreiteira) === norm(p.empresa); }) : L;
}
function resumoPde(p) {
  const L = pdesVisiveis(p);
  return { solicitados: L.filter(function (d) { return d.status === 'solicitado'; }).length, devolvidos: L.filter(function (d) { return d.status === 'devolvido'; }).length, total: L.length };
}
function pdePublico(d) {
  const o = {}; COLS_PDE.forEach(function (k) { o[k] = d[k]; });
  try { o.postes = d.postes ? JSON.parse(d.postes) : []; } catch (e) { o.postes = []; }
  return o;
}
function pdes(p, req) {
  let L = pdesVisiveis(p);
  if (req.obra) L = L.filter(function (d) { return d.obra === req.obra; });
  L.sort(function (a, b) { return String(b.solicitadoEm).localeCompare(String(a.solicitadoEm)); });
  return { ok: true, pdes: L.map(pdePublico) };
}
function solicitarPde(p, req) {
  if (p.papel !== 'empreiteira') return { ok: false, erro: 'o pedido de PDE/PLV é feito pela empreiteira' };
  const d = req.pde || {};
  const o = ler('obras').filter(function (x) { return x.id === d.obra; })[0];
  if (!o) return { ok: false, erro: 'obra não encontrada ou já encerrada' };
  if (norm(o.empreiteira) !== norm(p.empresa)) return { ok: false, erro: 'esta obra não é da sua empresa' };
  const falta = [];
  if (TIPOS_PDE.indexOf(d.tipo) < 0) falta.push('tipo');
  if (!d.postes || !d.postes.length) falta.push('postes');
  ['fiscal', 'operacional', 'data', 'horaIni', 'horaFim', 'servicos', 'encarregado', 'telefone'].forEach(function (k) { if (!String(d[k] || '').trim()) falta.push(k); });
  if (!(Number(d.pessoas) > 0)) falta.push('pessoas');
  if (falta.length) return { ok: false, erro: 'preencha: ' + falta.join(', ') };
  if (String(d.horaFim) <= String(d.horaIni)) return { ok: false, erro: 'a hora de término deve ser depois do início' };
  const agora = agoraIso();
  const campos = {
    obra: o.id, projeto: o.projeto, pep: o.pep || '', municipio: o.municipio || '', empreiteira: o.empreiteira, tipo: d.tipo, fiscal: d.fiscal,
    postes: JSON.stringify(d.postes), folhas: d.folhas || '', operacional: d.operacional, data: d.data, horaIni: d.horaIni, horaFim: d.horaFim,
    pessoas: String(Number(d.pessoas)), servicos: d.servicos, encarregado: d.encarregado, telefone: String(d.telefone).replace(/\D/g, ''), obs: d.obs || '',
    status: 'solicitado', motivo: '', solicitadoEm: agora, solicitadoPor: d.nome || p.responsavel || p.empresa, alteradoEm: agora
  };
  let id = d.id, ok = false;
  comTrava(function () {
    const atual = id ? ler('pde').filter(function (x) { return x.id === id; })[0] : null;
    if (atual) {   // correção de um pedido devolvido
      if (atual.status === 'aprovado') return;
      ok = atualizarLinha('pde', id, campos);
    } else {
      id = 'PDE' + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
      campos.id = id; campos.numeroPde = ''; campos.analisadoEm = ''; campos.analisadoPor = '';
      anexar('pde', campos); ok = true;
    }
    if (ok) marcarAlteracao();
  });
  return ok ? { ok: true, id: id } : { ok: false, erro: 'pedido já aprovado não pode ser alterado' };
}
function analisarPde(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'quem analisa o pedido é o fiscal' };
  const d = ler('pde').filter(function (x) { return x.id === req.id; })[0];
  if (!d) return { ok: false, erro: 'pedido não encontrado' };
  if (d.status === 'cancelado') return { ok: false, erro: 'pedido cancelado pela empreiteira' };
  const agora = agoraIso(); let campos;
  if (req.decisao === 'aprovar') campos = { status: 'aprovado', numeroPde: String(req.numeroPde || '').trim(), motivo: '', analisadoEm: agora, analisadoPor: p.responsavel || p.papel, alteradoEm: agora };
  else if (req.decisao === 'devolver') {
    if (!String(req.motivo || '').trim()) return { ok: false, erro: 'informe o motivo da devolução' };
    campos = { status: 'devolvido', motivo: String(req.motivo).trim(), analisadoEm: agora, analisadoPor: p.responsavel || p.papel, alteradoEm: agora };
  } else return { ok: false, erro: 'ação inválida' };
  let ok = false;
  comTrava(function () { ok = atualizarLinha('pde', d.id, campos); marcarAlteracao(); });
  return { ok: ok };
}
function cancelarPde(p, req) {
  const d = pdesVisiveis(p).filter(function (x) { return x.id === req.id; })[0];
  if (!d) return { ok: false, erro: 'pedido não encontrado' };
  if (d.status === 'aprovado' && p.papel === 'empreiteira') return { ok: false, erro: 'pedido já aprovado: fale com o fiscal' };
  let ok = false;
  comTrava(function () { ok = atualizarLinha('pde', d.id, { status: 'cancelado', alteradoEm: agoraIso() }); marcarAlteracao(); });
  return { ok: ok };
}

/* ============================ refazer as imagens da planta a partir do PDF guardado ============================ */
function pdfObra(p, req) {
  if (p.papel === 'empreiteira') return { ok: false, erro: 'sem permissão' };
  const o = acharObraQualquer(req.id);
  if (!o || !o.pdfId) return { ok: false, erro: 'o PDF original desta obra não está guardado' };
  return { ok: true, b64: Utilities.base64Encode(DriveApp.getFileById(o.pdfId).getBlob().getBytes()) };
}
function atualizarPlantas(p, req) {
  if (p.papel !== 'gestor') return { ok: false, erro: 'só o gestor pode alterar a obra' };
  const o = ler('obras').filter(function (x) { return x.id === req.id; })[0];
  if (!o) return { ok: false, erro: 'obra não encontrada ou já encerrada' };
  let folhas = []; try { folhas = o.folhas ? JSON.parse(o.folhas) : []; } catch (e) { }
  const pasta = DriveApp.getFolderById(lerConfig().pastaPlantas);
  const campos = {}; const velhos = [];
  (req.folhas || []).forEach(function (f) {
    const i = Number(f.i);
    if (i > folhas.length) return;
    const arq = pasta.createFile(Utilities.newBlob(Utilities.base64Decode(f.b64), 'image/jpeg', o.id + '_folha' + (i + 1) + '_v' + Date.now() + '.jpg'));
    if (i === 0) { velhos.push(o.plantaId); campos.plantaId = arq.getId(); campos.plantaW = f.w; campos.plantaH = f.h; }
    else { velhos.push(folhas[i - 1].id); folhas[i - 1] = { id: arq.getId(), w: f.w, h: f.h }; }
  });
  campos.folhas = JSON.stringify(folhas); campos.atualizadoEm = agoraIso();
  let ok = false;
  comTrava(function () { ok = atualizarLinha('obras', o.id, campos); marcarAlteracao(); });
  velhos.forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { } });
  return { ok: ok };
}
