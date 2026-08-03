'use strict';

const db = require('../database/connection');

// Módulo REPORTS DE ATRASO — tabela própria `report_atraso`.
// Espelha models/ReportOcorrencia.js, mas só existe o gatilho de escalada: não
// há notificado_aberto_em/notificado_fechado_em porque este módulo não avisa
// entrada nem fechamento (isso já é coberto pelo módulo de Reports por Empresa).
// O único carimbo é `ultimo_report_em`, o relógio da cobrança de atraso.
//
// ATENÇÃO AO FUSO: o servidor MySQL roda em UTC, mas `data_ocorrencia` vem do TXT
// em horário de Brasília e é gravada sem fuso. Por isso NOW()/TIMESTAMPDIFF do
// MySQL NÃO servem para medir tempo em aberto — adiantariam tudo em 3h. Toda conta
// de tempo é feita no Node (ver services/reportAtraso.js), e todo carimbo gravado
// aqui chega pronto do chamador em horário de Brasília.

// Colunas que vêm do TXT (mesmo subconjunto dos outros módulos de report).
const COLUNAS_TXT = [
  'id_ocorrencia', 'municipio', 'bairro', 'cluster', 'empresa', 'armario',
  'causa', 'status', 'data_ocorrencia', 'data_previsao', 'data_encerramento',
  'ta', 'uf', 'logradouro', 'numero_logradouro', 'sub_status', 'sub_causa',
  'afetacao',
];

const ReportAtraso = {
  COLUNAS_TXT,

  async total() {
    const [[r]] = await db.query('SELECT COUNT(*) AS total FROM report_atraso');
    return Number(r.total);
  },

  // id_ocorrencia -> status atual. O importador usa para saber quais linhas já
  // são conhecidas (UPDATE) e quais são novas (INSERT).
  async statusPorId(ids) {
    if (!ids.length) return new Map();
    const [rows] = await db.query(
      'SELECT id_ocorrencia, status FROM report_atraso WHERE id_ocorrencia IN (?)',
      [ids]);
    return new Map(rows.map(r => [String(r.id_ocorrencia), r]));
  },

  // Insere em lote. Só entram ocorrências ABERTAS (ver importadorAtraso.js).
  // `ultimoReportEm` != null carimba o relógio da escalada já "zerado" — usado
  // no backfill, para não cobrar de uma vez tudo que já estava velho quando o
  // módulo foi ligado.
  async inserirNovas(registros, ultimoReportEm = null) {
    if (!registros.length) return 0;
    const cols   = [...COLUNAS_TXT, 'ultimo_report_em'];
    const values = registros.map(r => [...COLUNAS_TXT.map(c => r[c] ?? null), ultimoReportEm]);
    const [res] = await db.query(
      `INSERT INTO report_atraso (${cols.join(',')}) VALUES ?
       ON DUPLICATE KEY UPDATE id_ocorrencia = id_ocorrencia`, [values]);
    return res.affectedRows;
  },

  // Sincroniza os campos do TXT de quem já está na tabela, preservando o
  // relógio da escalada. É isto que faz uma ocorrência que fechou sair de
  // `abertas()` no próximo ciclo, mesmo sem aviso de fechamento.
  async atualizarTxt(registros) {
    if (!registros.length) return 0;
    const cols   = [...COLUNAS_TXT];
    const values = registros.map(r => cols.map(c => r[c] ?? null));
    const updates = cols.filter(c => c !== 'id_ocorrencia')
      .map(c => `${c} = VALUES(${c})`).join(', ');
    const [res] = await db.query(
      `INSERT INTO report_atraso (${cols.join(',')}) VALUES ?
       ON DUPLICATE KEY UPDATE ${updates}`, [values]);
    return res.affectedRows;
  },

  // Zera o relógio de quem nunca foi cobrado, sem enviar nada. Usada no backfill
  // e pelo botão da tela — rede de segurança para quando a tabela é esvaziada e
  // recarregada (as linhas voltam sem carimbo e disparariam cobrança para todo
  // mundo de uma vez, incluindo ocorrência aberta há meses).
  async zerarRelogioPendente(agora) {
    const [res] = await db.query(
      `UPDATE report_atraso SET ultimo_report_em = ?
        WHERE status = 'ABERTO' AND ultimo_report_em IS NULL`,
      [agora]);
    return res.affectedRows;
  },

  // Abertas de uma lista de empresas, com filtro opcional de cluster e data
  // mínima. O tempo em aberto é calculado no Node (fuso), não aqui.
  async abertas(empresas, clusters, dataMinima) {
    if (!empresas.length) return [];
    const params = [empresas];
    let sql = `SELECT * FROM report_atraso
                WHERE status = 'ABERTO' AND empresa IN (?) AND data_ocorrencia IS NOT NULL`;
    if (clusters && clusters.length) { sql += ' AND cluster IN (?)'; params.push(clusters); }
    if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
    sql += ' ORDER BY data_ocorrencia ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async marcarReportEnviado(ids, agora) {
    if (!ids.length) return;
    await db.query(
      'UPDATE report_atraso SET ultimo_report_em = ? WHERE id_ocorrencia IN (?)', [agora, ids]);
  },

  // Números da tela de configuração: quantas abertas e quantas no total por empresa.
  async resumoPorEmpresa(empresas) {
    if (!empresas.length) return [];
    const [rows] = await db.query(
      `SELECT empresa,
              COUNT(*) AS total,
              SUM(status = 'ABERTO') AS abertas
         FROM report_atraso
        WHERE empresa IN (?)
        GROUP BY empresa`, [empresas]);
    return rows;
  },

  async buscarPorId(id) {
    const [[row]] = await db.query(
      'SELECT * FROM report_atraso WHERE id_ocorrencia = ? LIMIT 1', [id]);
    return row || null;
  },

  // Usada pelo botão "Enviar teste" da tela: pega uma aberta da empresa.
  async umaAberta(empresa) {
    const [[row]] = await db.query(
      `SELECT * FROM report_atraso
        WHERE empresa = ? AND status = 'ABERTO'
        ORDER BY data_ocorrencia ASC LIMIT 1`, [empresa]);
    return row || null;
  },

  // Remove quem já fechou (saiu de ABERTO). Uma vez fechada, a linha não serve
  // mais pra nada aqui — este módulo só cobra atraso de quem está ABERTO, não
  // avisa fechamento, então não há motivo para guardar histórico de fechadas.
  async limparFechadas() {
    const [r] = await db.query(`DELETE FROM report_atraso WHERE status != 'ABERTO'`);
    return r.affectedRows || 0;
  },
};

module.exports = ReportAtraso;
