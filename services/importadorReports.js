'use strict';

// Importador do módulo de Reports por Empresa.
//
// Pipeline PRÓPRIO, isolado do VIGO: lê o mesmo TBL_OCORRENCIA.TXT, mas com
// filtros próprios (config rep_*) e grava em `report_ocorrencias`. O importador
// do VIGO (services/importador.js) continua intocado, com o recorte dele
// (ABILITY / GOIANIA / afetação > 300) na tabela `ocorrencias`.
//
// Aqui sobem as 4 empresas inteiras — todos os clusters, todos os status.

const fs     = require('fs');
const Config = require('../models/Config');
const Report = require('../models/ReportOcorrencia');
const { fetchComTimeout, assertUrlImportacaoSegura } = require('./net');
const { processarNotificacoes, agoraBrasilia } = require('./reportEmpresas');

const COLUNAS = Report.COLUNAS_TXT;
const DATAS = new Set(['data_ocorrencia', 'data_previsao', 'data_encerramento']);

// "23/06/2026 16:39:51" -> "2026-06-23 16:39:51" (ou null)
function parseData(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function up(v) { return String(v || '').trim().toUpperCase(); }

function montarRegistro(campos, idx) {
  const reg = {};
  for (const col of COLUNAS) {
    let v = idx[col] >= 0 ? campos[idx[col]] : null;
    v = v == null ? null : v.trim();
    if (v === '') v = null;
    if (DATAS.has(col)) v = parseData(v);
    else if (col === 'afetacao') v = parseInt(v, 10) || 0;
    reg[col] = v;
  }
  return reg;
}

async function obterConteudo() {
  const local = process.env.IMPORT_ARQUIVO_LOCAL;
  if (local && fs.existsSync(local)) return fs.readFileSync(local, 'latin1');

  const url = await Config.get('rep_import_url', process.env.IMPORT_URL);
  if (!url) throw new Error('URL de importação do módulo de reports não configurada.');
  assertUrlImportacaoSegura(url);
  const resp = await fetchComTimeout(url, { headers: { 'User-Agent': 'VistoriaOcorrencias/1.0' } }, 60000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar a base.`);
  return Buffer.from(await resp.arrayBuffer()).toString('latin1');
}

async function importar() {
  const inicio = Date.now();

  const empresas    = await Config.getLista('rep_empresas');
  const clusters    = await Config.getLista('rep_clusters_permitidos');
  const status      = await Config.getLista('rep_status_permitidos');
  const afetacaoMin = parseInt(await Config.get('rep_afetacao_minima', '0'), 10) || 0;
  const backfillFeito = String(await Config.get('rep_backfill_feito', '0')) === '1';
  const dmStr = await Config.get('rep_data_minima', '');
  const dataMinima = /^\d{4}-\d{2}-\d{2}$/.test(String(dmStr || '')) ? dmStr : null;

  const conteudo = await obterConteudo();
  const linhas = conteudo.split(/\r?\n/).filter(l => l.length);
  if (!linhas.length) throw new Error('Arquivo vazio.');

  const header = linhas[0].split('|').map(h => h.trim().toLowerCase());
  const idx = {};
  for (const col of COLUNAS) idx[col] = header.indexOf(col);
  if (idx.id_ocorrencia < 0) throw new Error('Cabeçalho inesperado: coluna id_ocorrencia ausente.');

  // A empresa de uma ocorrência não muda, então ela delimita a base do módulo
  // tanto para linha nova quanto para linha já conhecida.
  const daEmpresa = campos => !empresas.length || empresas.includes(up(campos[idx.empresa]));

  // Já os demais filtros valem SÓ para decidir se uma ocorrência NOVA entra.
  // Quem já está na tabela é sempre sincronizado, mesmo que deixe de passar no
  // filtro — senão uma ocorrência importada como ABERTO (com status_permitidos
  // = ABERTO) nunca receberia o UPDATE que a fecha: ficaria ABERTA para sempre
  // na base e a escalada cobraria ela eternamente.
  function entraComoNova(campos) {
    if (clusters.length && !clusters.includes(up(campos[idx.cluster]))) return false;
    if (status.length   && !status.includes(up(campos[idx.status])))    return false;
    if (afetacaoMin > 0 && (parseInt(campos[idx.afetacao], 10) || 0) < afetacaoMin) return false;
    if (dataMinima) {
      const d = parseData(campos[idx.data_ocorrencia]);
      if (!d || d.slice(0, 10) < dataMinima) return false;
    }
    return true;
  }

  const candidatos = [];
  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i].split('|');
    if (!campos[idx.id_ocorrencia]) continue;
    if (!daEmpresa(campos)) continue;
    candidatos.push(campos);
  }

  // Quem já está na tabela (UPDATE, preservando os carimbos de aviso) vs. novo (INSERT).
  const CHUNK = 500;
  const ids = candidatos.map(c => String(c[idx.id_ocorrencia]).trim());
  const conhecidos = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const m = await Report.statusPorId(ids.slice(i, i + CHUNK));
    for (const k of m.keys()) conhecidos.add(k);
  }

  const novos   = [];
  const antigos = [];
  for (const campos of candidatos) {
    const id = String(campos[idx.id_ocorrencia]).trim();
    if (conhecidos.has(id))          antigos.push(montarRegistro(campos, idx)); // sempre sincroniza
    else if (entraComoNova(campos))  novos.push(montarRegistro(campos, idx));
  }
  const registros = [...novos, ...antigos];

  // 1ª importação: a tabela é populada mas TUDO entra já carimbado como avisado.
  // Sem isto, o primeiro ciclo despejaria dezenas de milhares de mensagens.
  const carimbo = backfillFeito ? null : agoraBrasilia();

  for (let i = 0; i < novos.length; i += CHUNK) {
    await Report.inserirNovas(novos.slice(i, i + CHUNK), carimbo);
  }
  for (let i = 0; i < antigos.length; i += CHUNK) {
    await Report.atualizarTxt(antigos.slice(i, i + CHUNK));
  }

  // Carimbar só o que foi inserido agora não basta: se a tabela for esvaziada e
  // recarregada, as linhas voltam sem carimbo. No backfill, marca a base INTEIRA.
  if (!backfillFeito) await Report.marcarTudoComoAvisado(carimbo);

  // Conta as linhas que mandamos, não o affectedRows: o ON DUPLICATE KEY UPDATE
  // devolve 2 por linha alterada, o que daria um número maior que o total lido.
  const inseridos   = novos.length;
  const atualizados = antigos.length;

  if (!backfillFeito) {
    await Config.set('rep_backfill_feito', '1');
    console.log(`[ReportImport] Backfill inicial: ${inseridos} ocorrência(s) carregada(s) sem notificar.`);
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  const resultado = backfillFeito
    ? `${registros.length} lidas · ${inseridos} novas · ${atualizados} atualizadas · ${seg}s`
    : `Carga inicial: ${inseridos} ocorrências carregadas (sem notificar) · ${seg}s`;

  await Config.set('rep_ultima_importacao', agoraBrasilia());
  await Config.set('rep_ultima_importacao_resultado', resultado);
  console.log(`[ReportImport] ${resultado}`);

  // Dispara os avisos de entrada (novas / recém-fechadas) já neste ciclo.
  const { enviadas } = await processarNotificacoes();

  return { lidas: registros.length, inseridos, atualizados, notificadas: enviadas, resultado };
}

module.exports = { importar };
