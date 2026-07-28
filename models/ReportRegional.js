'use strict';

const db = require('../database/connection');

// Módulo REPORTS REGIONAL — tabela própria `report_regional`, grupo único.
// Espelha models/ReportOcorrencia.js, mas SEM a dimensão empresa: aqui o recorte
// é a afetação (>= corte), regional (qualquer empresa), e o aviso vai para um só grupo.
//
// ATENÇÃO AO FUSO: o servidor MySQL roda em UTC, mas `data_ocorrencia` vem do TXT
// em horário de Brasília e é gravada sem fuso. Por isso NOW()/TIMESTAMPDIFF do
// MySQL NÃO servem para medir tempo em aberto — adiantariam tudo em 3h. Toda conta
// de tempo é feita no Node, e todo carimbo gravado aqui chega pronto do chamador
// em horário de Brasília.

// Colunas que vêm do TXT (mesmo subconjunto do módulo de empresas).
const COLUNAS_TXT = [
  'id_ocorrencia', 'municipio', 'bairro', 'cluster', 'empresa', 'armario',
  'causa', 'status', 'data_ocorrencia', 'data_previsao', 'data_encerramento',
  'ta', 'uf', 'logradouro', 'numero_logradouro', 'sub_status', 'sub_causa',
  'afetacao',
];

const ReportRegional = {
  COLUNAS_TXT,

  async total() {
    const [[r]] = await db.query('SELECT COUNT(*) AS total FROM report_regional');
    return Number(r.total);
  },

  // id_ocorrencia -> linha (status atual). O importador usa para saber, antes do
  // UPDATE, quais ocorrências já são conhecidas.
  async statusPorId(ids) {
    if (!ids.length) return new Map();
    const [rows] = await db.query(
      'SELECT id_ocorrencia, status, notificado_fechado_em FROM report_regional WHERE id_ocorrencia IN (?)',
      [ids]);
    return new Map(rows.map(r => [String(r.id_ocorrencia), r]));
  },

  // Insere em lote. `notificadoEm` != null marca as linhas como "já avisadas" —
  // é o que impede a primeira importação (backfill) de disparar uma enxurrada.
  async inserirNovas(registros, notificadoEm = null) {
    if (!registros.length) return 0;
    const cols   = [...COLUNAS_TXT, 'notificado_aberto_em', 'notificado_fechado_em'];
    const values = registros.map(r => [
      ...COLUNAS_TXT.map(c => r[c] ?? null),
      notificadoEm,
      // Mesma regra do botão de silenciar: numa carga que não notifica, a linha que
      // entra ABERTA fica com o fechamento em NULL, para que o "✅ Ocorrência Fechada"
      // ainda saia quando ela fechar. Só o histórico já encerrado nasce 100% mudo.
      String(r.status || '').toUpperCase() === 'ABERTO' ? null : notificadoEm,
    ]);
    const [res] = await db.query(
      `INSERT INTO report_regional (${cols.join(',')}) VALUES ?
       ON DUPLICATE KEY UPDATE id_ocorrencia = id_ocorrencia`, [values]);
    return res.affectedRows;
  },

  // Sincroniza os campos do TXT de quem já está na tabela, preservando os
  // carimbos de notificação.
  async atualizarTxt(registros) {
    if (!registros.length) return 0;
    const cols   = [...COLUNAS_TXT];
    const values = registros.map(r => cols.map(c => r[c] ?? null));
    const updates = cols.filter(c => c !== 'id_ocorrencia')
      .map(c => `${c} = VALUES(${c})`).join(', ');
    const [res] = await db.query(
      `INSERT INTO report_regional (${cols.join(',')}) VALUES ?
       ON DUPLICATE KEY UPDATE ${updates}`, [values]);
    return res.affectedRows;
  },

  // Carimba TODA a base como "já avisada", sem enviar nada. Usada no backfill e
  // pelo botão da tela — rede de segurança para quando a tabela é recarregada.
  // Silencia só o evento pendente AGORA (mesma regra do módulo de empresas):
  //   ABERTO  -> carimba a entrada; o fechamento fica NULL de propósito.
  //   demais  -> carimba os dois (nada mais vai acontecer com ela).
  async marcarTudoComoAvisado(agora) {
    const [res] = await db.query(
      `UPDATE report_regional
          SET notificado_aberto_em  = COALESCE(notificado_aberto_em, ?),
              notificado_fechado_em = CASE
                WHEN status = 'ABERTO' THEN notificado_fechado_em
                ELSE COALESCE(notificado_fechado_em, ?)
              END
        WHERE notificado_aberto_em IS NULL
           OR (status <> 'ABERTO' AND notificado_fechado_em IS NULL)`,
      [agora, agora]);
    return res.affectedRows;
  },

  async pendentesTotal() {
    const [[r]] = await db.query(
      'SELECT COUNT(*) AS total FROM report_regional WHERE notificado_aberto_em IS NULL');
    return Number(r.total);
  },

  // Carimba, SEM enviar, tudo que está pendente e não seria enviado agora — o
  // oposto de `pendentesNotificacao`. Garante a regra "nada acumula": só sobrevive
  // como pendente aquilo que será mesmo enviado neste ciclo.
  //   enviar=false  -> descarta todos os pendentes deste status.
  //   enviar=true   -> mantém os com data_ocorrencia válida [e >= dataMinima];
  //                    descarta o resto (linha sem data nunca seria enviada).
  async descartarPendentes(status, agora, { enviar = false, dataMinima = null } = {}) {
    const col = status === 'FECHADO' ? 'notificado_fechado_em' : 'notificado_aberto_em';
    const params = [agora, status];
    let sql = `UPDATE report_regional SET ${col} = ? WHERE status = ? AND ${col} IS NULL`;

    if (enviar) {
      sql += ' AND NOT (data_ocorrencia IS NOT NULL';
      if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
      sql += ')';
    }
    const [res] = await db.query(sql, params);
    return res.affectedRows;
  },

  // `agora` chega como "YYYY-MM-DD HH:MM:SS" de Brasília (ver nota de fuso no topo).
  async marcarNotificado(ids, campo, agora) {
    if (!ids.length) return;
    const col = campo === 'FECHADO' ? 'notificado_fechado_em' : 'notificado_aberto_em';
    await db.query(
      `UPDATE report_regional SET ${col} = ? WHERE id_ocorrencia IN (?)`, [agora, ids]);
  },

  // Ocorrências de um status ainda não avisadas na entrada. dataMinima limita o
  // quanto para trás o módulo olha.
  async pendentesNotificacao(status, dataMinima) {
    const col = status === 'FECHADO' ? 'notificado_fechado_em' : 'notificado_aberto_em';
    const params = [status];
    let sql = `SELECT * FROM report_regional WHERE status = ? AND ${col} IS NULL`;
    if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
    sql += ' ORDER BY data_ocorrencia ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // Abertas. O tempo em aberto é calculado no Node (fuso), não aqui.
  async abertas(dataMinima) {
    const params = [];
    let sql = `SELECT * FROM report_regional
                WHERE status = 'ABERTO' AND data_ocorrencia IS NOT NULL`;
    if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
    sql += ' ORDER BY data_ocorrencia ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async marcarReportEnviado(ids, agora) {
    if (!ids.length) return;
    await db.query(
      'UPDATE report_regional SET ultimo_report_em = ? WHERE id_ocorrencia IN (?)', [agora, ids]);
  },

  // Números da tela: total na base e quantas abertas.
  async resumo() {
    const [[r]] = await db.query(
      `SELECT COUNT(*) AS total, SUM(status = 'ABERTO') AS abertas FROM report_regional`);
    return { total: Number(r.total || 0), abertas: Number(r.abertas || 0) };
  },

  async buscarPorId(id) {
    const [[row]] = await db.query(
      'SELECT * FROM report_regional WHERE id_ocorrencia = ? LIMIT 1', [id]);
    return row || null;
  },

  // Usada pelo botão "Enviar teste" da tela: pega a aberta mais recente.
  async umaAberta() {
    const [[row]] = await db.query(
      `SELECT * FROM report_regional
        WHERE status = 'ABERTO'
        ORDER BY data_ocorrencia DESC LIMIT 1`);
    return row || null;
  },
};

module.exports = ReportRegional;
