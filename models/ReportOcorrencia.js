'use strict';

const db = require('../database/connection');

// ATENÇÃO AO FUSO: o servidor MySQL roda em UTC, mas `data_ocorrencia` vem do TXT
// em horário de Brasília e é gravada sem fuso. Por isso NOW()/TIMESTAMPDIFF do
// MySQL NÃO servem para medir tempo em aberto — adiantariam tudo em 3h (a escalada
// de ">12h" dispararia com 9h reais). Toda conta de tempo é feita no Node, e todo
// carimbo gravado aqui chega pronto do chamador em horário de Brasília.

// Colunas que vêm do TXT (subconjunto do que o VIGO importa — aqui só interessa
// o necessário para montar a mensagem e calcular a escalada).
const COLUNAS_TXT = [
  'id_ocorrencia', 'municipio', 'bairro', 'cluster', 'empresa', 'armario',
  'causa', 'status', 'data_ocorrencia', 'data_previsao', 'data_encerramento',
  'ta', 'uf', 'logradouro', 'numero_logradouro', 'sub_status', 'sub_causa',
  'afetacao',
];

const ReportOcorrencia = {
  COLUNAS_TXT,

  async total() {
    const [[r]] = await db.query('SELECT COUNT(*) AS total FROM report_ocorrencias');
    return Number(r.total);
  },

  // id_ocorrencia -> status atual. O importador usa para saber, antes do UPDATE,
  // quais ocorrências acabaram de mudar de status (ex.: ABERTO -> FECHADO).
  async statusPorId(ids) {
    if (!ids.length) return new Map();
    const [rows] = await db.query(
      'SELECT id_ocorrencia, status, notificado_fechado_em FROM report_ocorrencias WHERE id_ocorrencia IN (?)',
      [ids]);
    return new Map(rows.map(r => [String(r.id_ocorrencia), r]));
  },

  // Insere em lote. `notificadoEm` != null marca as linhas como "já avisadas" —
  // é o que impede a primeira importação (backfill) de disparar 37 mil mensagens.
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
      `INSERT INTO report_ocorrencias (${cols.join(',')}) VALUES ?
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
      `INSERT INTO report_ocorrencias (${cols.join(',')}) VALUES ?
       ON DUPLICATE KEY UPDATE ${updates}`, [values]);
    return res.affectedRows;
  },

  // Carimba TODA a base como "já avisada", sem enviar nada. Usada no backfill e
  // pelo botão da tela — é a rede de segurança para quando a tabela é recarregada
  // (ex.: limpeza manual + reimportação), caso em que as linhas voltam sem carimbo
  // e virariam milhares de mensagens de uma vez ao ligar o módulo.
  // Silencia só o evento que está pendente AGORA, conforme o status da linha:
  //   ABERTO  -> carimba a entrada; o fechamento fica NULL de propósito, para que
  //              o "✅ Ocorrência Fechada" ainda saia quando ela fechar de verdade.
  //   demais  -> carimba os dois (nada mais vai acontecer com ela).
  // Carimbar o fechamento de uma ocorrência ainda ABERTA enterraria o aviso de
  // encerramento dela para sempre, deixando a história pela metade no grupo.
  async marcarTudoComoAvisado(agora) {
    const [res] = await db.query(
      `UPDATE report_ocorrencias
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
      'SELECT COUNT(*) AS total FROM report_ocorrencias WHERE notificado_aberto_em IS NULL');
    return Number(r.total);
  },

  // Carimba, SEM enviar, tudo que está pendente e não seria enviado agora — o
  // oposto exato de `pendentesNotificacao`. É o que garante a regra "nada acumula":
  // só sobrevive como pendente aquilo que será mesmo enviado neste ciclo.
  // `manterEmpresas` + `manterDesde` descrevem o que NÃO deve ser descartado.
  // Linha sem data_ocorrencia é descartada (nunca seria enviada de qualquer forma).
  async descartarPendentes(status, agora, manterEmpresas = [], manterDesde = null) {
    const col = status === 'FECHADO' ? 'notificado_fechado_em' : 'notificado_aberto_em';
    const params = [agora, status];
    let sql = `UPDATE report_ocorrencias SET ${col} = ? WHERE status = ? AND ${col} IS NULL`;

    if (manterEmpresas.length) {
      sql += ' AND NOT (empresa IN (?) AND data_ocorrencia IS NOT NULL';
      params.push(manterEmpresas);
      if (manterDesde) { sql += ' AND data_ocorrencia >= ?'; params.push(`${manterDesde} 00:00:00`); }
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
      `UPDATE report_ocorrencias SET ${col} = ? WHERE id_ocorrencia IN (?)`, [agora, ids]);
  },

  // Ocorrências ABERTAS de uma empresa que ainda não foram avisadas na entrada.
  // dataMinima limita o quanto para trás o módulo olha.
  async pendentesNotificacao(status, empresas, dataMinima) {
    if (!empresas.length) return [];
    const col = status === 'FECHADO' ? 'notificado_fechado_em' : 'notificado_aberto_em';
    const params = [status, empresas];
    let sql = `SELECT * FROM report_ocorrencias
                WHERE status = ? AND empresa IN (?) AND ${col} IS NULL`;
    if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
    sql += ' ORDER BY data_ocorrencia ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // Abertas de uma empresa. O tempo em aberto é calculado no Node (fuso), não aqui.
  async abertas(empresas, dataMinima) {
    if (!empresas.length) return [];
    const params = [empresas];
    let sql = `SELECT * FROM report_ocorrencias
                WHERE status = 'ABERTO' AND empresa IN (?) AND data_ocorrencia IS NOT NULL`;
    if (dataMinima) { sql += ' AND data_ocorrencia >= ?'; params.push(`${dataMinima} 00:00:00`); }
    sql += ' ORDER BY data_ocorrencia ASC';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async marcarReportEnviado(ids, agora) {
    if (!ids.length) return;
    await db.query(
      'UPDATE report_ocorrencias SET ultimo_report_em = ? WHERE id_ocorrencia IN (?)', [agora, ids]);
  },

  // Números da tela de configuração: quantas abertas e quantas no total por empresa.
  async resumoPorEmpresa(empresas) {
    if (!empresas.length) return [];
    const [rows] = await db.query(
      `SELECT empresa,
              COUNT(*) AS total,
              SUM(status = 'ABERTO') AS abertas
         FROM report_ocorrencias
        WHERE empresa IN (?)
        GROUP BY empresa`, [empresas]);
    return rows;
  },

  async buscarPorId(id) {
    const [[row]] = await db.query(
      'SELECT * FROM report_ocorrencias WHERE id_ocorrencia = ? LIMIT 1', [id]);
    return row || null;
  },

  // Usada pelo botão "Enviar teste" da tela: pega uma aberta da empresa.
  async umaAberta(empresa) {
    const [[row]] = await db.query(
      `SELECT * FROM report_ocorrencias
        WHERE empresa = ? AND status = 'ABERTO'
        ORDER BY data_ocorrencia DESC LIMIT 1`, [empresa]);
    return row || null;
  },
};

module.exports = ReportOcorrencia;
