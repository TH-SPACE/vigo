'use strict';

// Importador da base TBL_OBSERVACAO.TXT
//  Formato: ID_OCORRENCIA|OBSERVACAO|USUARIO|DATA
//  O campo OBSERVACAO pode conter quebras de linha reais (não só <br>).
//  Estratégia de parse: regex não-greedy que ancora pelo padrão de data ao
//  final de cada registro, evitando falsos positivos nas linhas internas.
//
//  O arquivo real chega a centenas de MB. Para não travar o processo (que
//  também serve as páginas web) baixando e alocando tudo de uma vez, o
//  conteúdo é processado em stream: cada pedaço recebido é concatenado a um
//  resto pendente, os registros completos são extraídos, e só o trecho
//  incompleto final fica retido para o próximo pedaço.

const fs     = require('fs');
const { Readable } = require('stream');
const db  = require('../database/connection');
const Observacao = require('../models/Observacao');
const Config     = require('../models/Config');
const { fetchComTimeout, assertUrlImportacaoSegura } = require('./net');

// Captura: 1=ID  2=OBSERVACAO(multi-linha)  3=USUARIO  4=DATA dd/mm/aaaa hh:mm:ss
const RE_REGISTRO = /^(\d+)\|([\s\S]*?)\|([^|\r\n]+)\|(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2})\r?$/gm;

function parseData(v) {
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

async function obterStream() {
  const local = process.env.IMPORT_OBSERVACOES_ARQUIVO_LOCAL;
  if (local && fs.existsSync(local)) {
    return fs.createReadStream(local);
  }
  const url = await Config.get('import_observacoes_url', process.env.IMPORT_OBSERVACOES_URL || '');
  if (!url) throw new Error('URL de importação de observações não configurada (import_observacoes_url).');
  assertUrlImportacaoSegura(url);
  // Arquivo grande (centenas de MB) em stream: timeout alto (10min) só como
  // rede de segurança contra conexão pendurada, sem cortar downloads legítimos.
  const resp = await fetchComTimeout(url, { headers: { 'User-Agent': 'VistoriaOcorrencias/1.0' } }, 600000);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar TBL_OBSERVACAO.`);
  return Readable.fromWeb(resp.body);
}

// Extrai os registros completos do buffer acumulado.
// Devolve os matches e o trecho final ainda incompleto (a reter para o
// próximo pedaço do stream).
function extrairRegistros(buffer) {
  const matches = [];
  RE_REGISTRO.lastIndex = 0;
  let m, fimUltimo = 0;
  while ((m = RE_REGISTRO.exec(buffer)) !== null) {
    matches.push(m);
    fimUltimo = RE_REGISTRO.lastIndex;
  }
  return { matches, resto: buffer.slice(fimUltimo) };
}

async function importarObservacoes() {
  const inicio = Date.now();
  console.log(`[ImportadorObs] ${new Date().toLocaleString('pt-BR')} — iniciando importação de observações...`);

  // Carrega todos os IDs de ocorrências que temos no banco (conjunto pequeno).
  const [ocRows] = await db.query('SELECT id_ocorrencia FROM ocorrencias');
  const existentes = new Set(ocRows.map(r => String(r.id_ocorrencia)));

  if (!existentes.size) {
    console.log('[ImportadorObs] Nenhuma ocorrência no banco — importação pulada.');
    return { lidas: 0, filtradas: 0, inseridas: 0, duracao_ms: Date.now() - inicio };
  }

  const stream = await obterStream();

  let carry = '';
  let lidas = 0;
  const filtrados = [];

  const processarMatches = (matches) => {
    for (const m of matches) {
      lidas++;
      const id = m[1];
      if (!existentes.has(id)) continue;
      filtrados.push({
        id_ocorrencia:   id,
        observacao:      m[2].trim(),
        usuario:         m[3].trim(),
        data_observacao: parseData(m[4]),
      });
    }
  };

  for await (const chunk of stream) {
    // 'latin1'/'binary' mapeia byte->código 1:1, então não há risco de
    // cortar um caractere multibyte na fronteira entre pedaços do stream.
    carry += chunk.toString('latin1');
    const { matches, resto } = extrairRegistros(carry);
    processarMatches(matches);
    carry = resto;
  }
  // Processa o que sobrou no final (última linha sem quebra, etc.).
  processarMatches(extrairRegistros(carry).matches);

  const inseridas = await Observacao.substituirParaOcorrencias(filtrados);

  const duracao_ms = Date.now() - inicio;
  const resumo = { lidas, filtradas: filtrados.length, inseridas, duracao_ms };

  await Config.set('ultima_importacao_observacoes', new Date().toISOString());
  await Config.set('ultima_importacao_observacoes_resultado',
    `filtradas=${filtrados.length} inseridas=${inseridas} (${duracao_ms}ms)`);

  console.log(`[ImportadorObs] lidas=${lidas} filtradas=${filtrados.length} inseridas=${inseridas} em ${duracao_ms}ms`);
  return resumo;
}

module.exports = { importarObservacoes };
