'use strict';

// Importador do módulo de Reports Regional.
//
// Pipeline PRÓPRIO, isolado do VIGO e do módulo de empresas: lê o mesmo
// TBL_OCORRENCIA.TXT, mas com filtros próprios (config repreg_*) e grava em
// `report_regional`. O recorte que define o módulo é a AFETAÇÃO (>= corte, default
// 70), regional (qualquer empresa); o aviso vai para um único grupo (target `regional`).

const fs     = require('fs');
const Config = require('../models/Config');
const Report = require('../models/ReportRegional');
const { fetchComTimeout, assertUrlImportacaoSegura } = require('./net');
const { processarNotificacoes, agoraBrasilia } = require('./reportRegional');

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

  const url = await Config.get('repreg_import_url', process.env.IMPORT_URL);
  if (!url) throw new Error('URL de importação do módulo regional não configurada.');
  assertUrlImportacaoSegura(url);
  const resp = await fetchComTimeout(url, { headers: { 'User-Agent': 'VistoriaOcorrencias/1.0' } }, 60000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar a base.`);
  return Buffer.from(await resp.arrayBuffer()).toString('latin1');
}

async function importar() {
  const inicio = Date.now();

  const empresas    = await Config.getLista('repreg_empresas');       // vazio = todas
  const clusters    = await Config.getLista('repreg_clusters_permitidos');
  const status      = await Config.getLista('repreg_status_permitidos');
  const afetacaoMin = parseInt(await Config.get('repreg_afetacao_minima', '70'), 10) || 0;
  const backfillFeito = String(await Config.get('repreg_backfill_feito', '0')) === '1';
  const dmStr = await Config.get('repreg_data_minima', '');
  const dataMinima = /^\d{4}-\d{2}-\d{2}$/.test(String(dmStr || '')) ? dmStr : null;

  const conteudo = await obterConteudo();
  const linhas = conteudo.split(/\r?\n/).filter(l => l.length);
  if (!linhas.length) throw new Error('Arquivo vazio.');

  const header = linhas[0].split('|').map(h => h.trim().toLowerCase());
  const idx = {};
  for (const col of COLUNAS) idx[col] = header.indexOf(col);
  if (idx.id_ocorrencia < 0) throw new Error('Cabeçalho inesperado: coluna id_ocorrencia ausente.');

  // A afetação não é um recorte estável como a empresa (pode ser corrigida), então
  // aqui o candidato é qualquer linha; os filtros (incl. afetação) decidem só a
  // entrada de linha NOVA. Quem já está na tabela é sempre sincronizado, mesmo que
  // deixe de passar no filtro — senão uma ABERTA importada nunca receberia o UPDATE
  // que a fecha e a escalada a cobraria eternamente.
  function entraComoNova(campos) {
    if (empresas.length && !empresas.includes(up(campos[idx.empresa])))  return false;
    if (clusters.length && !clusters.includes(up(campos[idx.cluster])))  return false;
    if (status.length   && !status.includes(up(campos[idx.status])))     return false;
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

  const inseridos   = novos.length;
  const atualizados = antigos.length;

  if (!backfillFeito) {
    await Config.set('repreg_backfill_feito', '1');
    console.log(`[RegionalImport] Backfill inicial: ${inseridos} ocorrência(s) carregada(s) sem notificar.`);
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  const resultado = backfillFeito
    ? `${registros.length} lidas · ${inseridos} novas · ${atualizados} atualizadas · ${seg}s`
    : `Carga inicial: ${inseridos} ocorrências carregadas (sem notificar) · ${seg}s`;

  await Config.set('repreg_ultima_importacao', agoraBrasilia());
  await Config.set('repreg_ultima_importacao_resultado', resultado);
  console.log(`[RegionalImport] ${resultado}`);

  // Dispara os avisos de entrada (novas / recém-fechadas) já neste ciclo.
  const { enviadas } = await processarNotificacoes();

  return { lidas: registros.length, inseridos, atualizados, notificadas: enviadas, resultado };
}

module.exports = { importar };
