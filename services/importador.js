'use strict';

// Importador da base TBL_OCORRENCIA.TXT
//  1. Baixa o TXT (ou lê arquivo local em testes — IMPORT_ARQUIVO_LOCAL)
//  2. Aplica os filtros configuráveis (afetação, status, empresa, cluster)
//  3. Insere ocorrências novas (PENDENTE) e atualiza as existentes (só campos do TXT)

const fs   = require('fs');
const Ocorrencia = require('../models/Ocorrencia');
const Config     = require('../models/Config');
const Historico  = require('../models/Historico');
const { fetchComTimeout, assertUrlImportacaoSegura } = require('./net');

const COLUNAS = Ocorrencia.COLUNAS_TXT;
const DATAS = new Set([
  'data_ocorrencia','data_previsao','data_encerramento',
  'data_ionix','data_codigo_bloqueio_trafego','data_ods',
]);

// "23/06/2026 16:39:51" -> "2026-06-23 16:39:51" (ou null)
function parseData(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function up(v) { return String(v || '').trim().toUpperCase(); }

// Converte uma linha (array de campos) + mapa de índice em objeto pronto p/ o banco.
function montarRegistro(campos, idxPorColuna) {
  const reg = {};
  for (const col of COLUNAS) {
    let v = campos[idxPorColuna[col]];
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
  if (local && fs.existsSync(local)) {
    return fs.readFileSync(local, 'latin1');
  }
  const url = await Config.get('import_url', process.env.IMPORT_URL);
  if (!url) throw new Error('URL de importação não configurada.');
  assertUrlImportacaoSegura(url);
  // 60s: a base TXT costuma ser pequena; timeout só protege contra conexão pendurada.
  const resp = await fetchComTimeout(url, { headers: { 'User-Agent': 'VistoriaOcorrencias/1.0' } }, 60000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar a base.`);
  const buf = Buffer.from(await resp.arrayBuffer());
  // A base costuma vir em latin1 (acentuação do português)
  return buf.toString('latin1');
}

async function importar({ usuario = null } = {}) {
  const inicio = Date.now();
  console.log(`[Importador] ${new Date().toLocaleString('pt-BR')} — iniciando importação de ocorrências...`);

  // Filtros configuráveis
  const afetacaoMin  = parseInt(await Config.get('afetacao_minima', '300'), 10) || 0;
  const empresas     = await Config.getLista('empresas_permitidas');
  const clusters     = await Config.getLista('clusters_permitidos');
  const status       = await Config.getLista('status_permitidos');
  const dmStr        = await Config.get('data_minima_ocorrencia', '');
  const dataMinima   = dmStr && /^\d{4}-\d{2}-\d{2}$/.test(dmStr) ? dmStr : null;

  const conteudo = await obterConteudo();
  const linhas = conteudo.split(/\r?\n/).filter(l => l.length);
  if (!linhas.length) throw new Error('Arquivo vazio.');

  const header = linhas[0].split('|').map(h => h.trim().toLowerCase());
  const idx = {};
  for (const col of COLUNAS) idx[col] = header.indexOf(col);
  if (idx.id_ocorrencia < 0) throw new Error('Cabeçalho inesperado: coluna id_ocorrencia ausente.');

  // Monta os registros de todas as linhas válidas da base (sem aplicar
  // filtro ainda — os filtros abaixo servem só para decidir se uma
  // ocorrência NOVA entra no sistema; uma já existente é sempre atualizada).
  function passaFiltros(campos) {
    const afet = parseInt(campos[idx.afetacao], 10) || 0;
    if (afet <= afetacaoMin) return false;
    if (status.length   && !status.includes(up(campos[idx.status])))    return false;
    if (empresas.length && !empresas.includes(up(campos[idx.empresa]))) return false;
    if (clusters.length && !clusters.includes(up(campos[idx.cluster]))) return false;
    if (dataMinima) {
      const dataConv = parseData(campos[idx.data_ocorrencia]);
      if (!dataConv || dataConv.slice(0, 10) < dataMinima) return false;
    }
    return true;
  }

  let lidas = 0;
  const linhasValidas = [];
  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i].split('|');
    if (!campos[idx.id_ocorrencia]) continue;
    lidas++;
    linhasValidas.push(campos);
  }

  // Descobre quais já estão na base local (em lotes para o IN(...))
  const CHUNK = 1000;
  const todosIds = linhasValidas.map(campos => String(campos[idx.id_ocorrencia]).trim());
  const existentes = new Set();
  for (let i = 0; i < todosIds.length; i += CHUNK) {
    const s = await Ocorrencia.existentes(todosIds.slice(i, i + CHUNK));
    for (const id of s) existentes.add(id);
  }

  const novos = [];
  const antigos = [];
  for (const campos of linhasValidas) {
    const id = String(campos[idx.id_ocorrencia]).trim();
    if (existentes.has(id)) {
      antigos.push(montarRegistro(campos, idx));   // já está no sistema: sempre sincroniza
    } else if (passaFiltros(campos)) {
      novos.push(montarRegistro(campos, idx));     // novo: só entra se passar nos filtros
    }
  }
  // Insere novos em lotes
  let inseridos = 0;
  for (let i = 0; i < novos.length; i += CHUNK) {
    inseridos += await Ocorrencia.inserirNovas(novos.slice(i, i + CHUNK));
  }
  // Histórico das novas
  for (const r of novos) {
    await Historico.registrar({
      ocorrencia_id: r.id_ocorrencia, usuario, acao: 'IMPORTADA',
      status_novo: 'PENDENTE', observacao: 'Ocorrência importada da base.',
    });
  }

  // Notifica clientes SSE conectados (atualização em tempo real)
  if (inseridos > 0) {
    try { require('./sse').emit('importacao', { inseridos }); } catch {}
  }

  // Notificação WhatsApp para cada nova ocorrência (fire-and-forget)
  if (novos.length > 0) {
    const notifNovaAtiva = String(await Config.get('whatsapp_notificacao_nova_ativo', '1')) === '1';
    const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
    const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
    if (notifNovaAtiva && webhookUrl) {
      const payload = {
        ocorrencias: novos.map(r => ({
          id_ocorrencia:     r.id_ocorrencia,
          municipio:         r.municipio,
          empresa:           r.empresa,
          status:            r.status,
          armario:           r.armario,
          ta:                r.ta,
          cluster:           r.cluster,
          afetacao:          r.afetacao,
          causa:             r.causa,
          logradouro:        r.logradouro,
          numero_logradouro: r.numero_logradouro,
          bairro:            r.bairro,
          data_ocorrencia:   r.data_ocorrencia,
        })),
      };
      fetchComTimeout(webhookUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
        },
        body: JSON.stringify(payload),
      }, 15000)
        .then(r => r.json())
        .then(d => console.log(`[WhatsApp] ${d.enqueued ?? 0} notificação(ões) enfileiradas`))
        .catch(e => console.warn('[WhatsApp] Falha ao notificar:', e.message));
    }
  }

  // Detecta ocorrências cujo status (da base) está virando CANCELADO nesta
  // importação — precisa ser calculado ANTES do UPDATE abaixo, que sobrescreve
  // o status atual com o valor novo do TXT.
  const statusAnteriores = await Ocorrencia.statusPorId(antigos.map(r => r.id_ocorrencia));
  const canceladasAgora = antigos.filter(r =>
    up(r.status) === 'CANCELADO' && up(statusAnteriores.get(String(r.id_ocorrencia))) !== 'CANCELADO');

  // Atualiza existentes (só campos do TXT)
  let atualizados = 0;
  for (const r of antigos) { await Ocorrencia.atualizarTxt(r); atualizados++; }

  // Notificação WhatsApp: ocorrência(s) cujo status virou CANCELADO nesta importação (fire-and-forget)
  if (canceladasAgora.length > 0) {
    const notifCanceladaAtiva = String(await Config.get('whatsapp_notificacao_cancelada_ativo', '1')) === '1';
    const webhookUrl   = process.env.WHATSAPP_WEBHOOK_URL;
    const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
    if (notifCanceladaAtiva && webhookUrl) {
      const linhas = [`🚫 *Ocorrência(s) com status alterado para CANCELADO*`, ``];
      for (const r of canceladasAgora) {
        const local = [r.municipio, r.bairro].filter(Boolean).join(' / ') || '—';
        linhas.push(`🔴 *#${r.id_ocorrencia}* — ${local}`);
        linhas.push(`   🏢 ${r.empresa || '—'}  |  🔧 TA: ${r.ta || '—'}  |  📦 ${r.armario || '—'}`);
      }
      fetchComTimeout(webhookUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
        },
        body: JSON.stringify({ text: linhas.join('\n'), linkPreview: false }),
      }, 15000)
        .then(r => r.json())
        .then(() => console.log(`[WhatsApp] ${canceladasAgora.length} notificação(ões) de cancelamento enviada(s)`))
        .catch(e => console.warn('[WhatsApp] Falha ao notificar cancelamento:', e.message));
    }
  }

  const resumo = {
    lidas, aceitos: novos.length + antigos.length, inseridos, atualizados,
    duracao_ms: Date.now() - inicio,
    em: new Date().toISOString(),
  };

  await Config.set('ultima_importacao', resumo.em);
  await Config.set('ultima_importacao_resultado',
    `aceitas=${resumo.aceitos} novas=${resumo.inseridos} atualizadas=${resumo.atualizados} (${resumo.duracao_ms}ms)`);

  console.log(`[Importador] lidas=${lidas} aceitas=${resumo.aceitos} novas=${inseridos} atualizadas=${atualizados} em ${resumo.duracao_ms}ms`);
  return resumo;
}

module.exports = { importar, parseData };
