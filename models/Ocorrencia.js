'use strict';

const db = require('../database/connection');

// Colunas que vêm do TXT, na MESMA ordem do cabeçalho do arquivo.
const COLUNAS_TXT = [
  'id_ocorrencia','municipio','bairro','cluster','empresa','armario','causa','status',
  'fluxo','distribuicao_inicial','distribuicao_final','data_ocorrencia','data_previsao',
  'data_encerramento','ionix','sas','ta','contrato','rede','uf','data_ionix','id_empresa',
  'logradouro','numero_logradouro','area_solicitante','regional','ordem_de_rede','transbordo',
  'ano','tipo_servico','codigo_bloqueio_trafego','data_codigo_bloqueio_trafego',
  'usuario_codigo_bloqueio_trafego','ods','data_ods','usuario_ods','fibrasil','sub_status',
  'sub_causa','afetacao','id_suspeita','hunter','influenciador',
];

// Status de tratativa considerados "ativos" (ainda em operação).
const ATIVOS = "('PENDENTE','VISTORIA SUPERVISOR','AGUARDANDO CORRECAO')";
// Ocorrências criadas manualmente pelo admin/GM (sem origem no TXT importado)
// recebem IDs a partir desta faixa — bem acima do maior ID real da Vivo (na
// casa de 10^6), então nunca colidem com uma importação futura.
const ID_MANUAL_MIN = 9000000000;
// A partir de quantos clientes afetados a ocorrência é considerada crítica.
const CRITICA_AFETACAO = 1000;

// Monta cláusula WHERE + params para filtros de listagem.
function buildWhere(filtros) {
  const where = [];
  const params = [];
  if (filtros.meu_id) {
    where.push("((o.vistoriador_id = ? OR o.analista_id = ?) AND o.status_tratativa <> 'CANCELADA')");
    params.push(filtros.meu_id, filtros.meu_id);
  } else if (filtros.status_tratativa) { where.push('o.status_tratativa = ?'); params.push(filtros.status_tratativa); }
  if (filtros.cluster)   { where.push('o.cluster = ?');   params.push(filtros.cluster); }
  if (filtros.empresa)   { where.push('o.empresa = ?');   params.push(filtros.empresa); }
  if (filtros.status)    { where.push('o.status = ?');    params.push(filtros.status); }
  if (filtros.municipio) { where.push('o.municipio = ?'); params.push(filtros.municipio); }
  if (filtros.armario)    { where.push('o.armario = ?');      params.push(filtros.armario); }
  if (filtros.data_minima){ where.push('o.data_ocorrencia >= ?'); params.push(filtros.data_minima); }
  if (filtros.busca) {
    where.push('(o.id_ocorrencia = ? OR o.ta LIKE ? OR o.municipio LIKE ? OR o.armario LIKE ?)');
    const id = /^\d+$/.test(filtros.busca) ? filtros.busca : 0;
    params.push(id, `%${filtros.busca}%`, `%${filtros.busca}%`, `%${filtros.busca}%`);
  }
  return { where, params };
}

const Ocorrencia = {
  COLUNAS_TXT,
  CRITICA_AFETACAO,
  ID_MANUAL_MIN,

  async analytics(dias = 30) {
    const [[statusRows], [porDia], [porCluster], [porCausa], [porVistoriador], [[totais]]] = await Promise.all([
      db.query(`SELECT status_tratativa, COUNT(*) AS total FROM ocorrencias GROUP BY status_tratativa ORDER BY total DESC`),
      db.query(`SELECT DATE(data_ocorrencia) AS dia, COUNT(*) AS total FROM ocorrencias WHERE data_ocorrencia >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY dia ORDER BY dia`, [dias]),
      db.query(`SELECT COALESCE(NULLIF(cluster,''), 'Sem cluster') AS cluster, COUNT(*) AS total FROM ocorrencias GROUP BY cluster ORDER BY total DESC LIMIT 15`),
      db.query(`SELECT causa, COUNT(*) AS total FROM ocorrencias WHERE causa IS NOT NULL AND causa != '' GROUP BY causa ORDER BY total DESC LIMIT 10`),
      db.query(`SELECT u.nome, COUNT(*) AS total FROM ocorrencias o JOIN usuarios u ON u.id = o.vistoriador_id WHERE o.vistoriador_id IS NOT NULL GROUP BY o.vistoriador_id, u.nome ORDER BY total DESC LIMIT 10`),
      db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(afetacao),0) AS afetacao_total, COALESCE(MAX(afetacao),0) AS afetacao_max, COALESCE(AVG(afetacao),0) AS afetacao_media FROM ocorrencias`),
    ]);
    return { porStatus: statusRows, porDia, porCluster, porCausa, porVistoriador, totais };
  },

  async ultimaPorDataOcorrencia() {
    const [[row]] = await db.query(
      `SELECT id_ocorrencia, municipio, bairro, armario, ta, cluster, causa,
              empresa, status, logradouro, numero_logradouro, afetacao, data_ocorrencia
         FROM ocorrencias
        ORDER BY data_ocorrencia DESC
        LIMIT 1`);
    return row || null;
  },

  async ultimaAbertaPorDataOcorrencia() {
    const [[row]] = await db.query(
      `SELECT id_ocorrencia, municipio, bairro, armario, ta, cluster, causa,
              empresa, status, logradouro, numero_logradouro, afetacao, data_ocorrencia
         FROM ocorrencias
        WHERE status = 'ABERTO'
        ORDER BY data_ocorrencia DESC
        LIMIT 1`);
    return row || null;
  },

  // Devolve um Set com os IDs já existentes dentre os informados.
  async existentes(ids) {
    if (!ids.length) return new Set();
    const [rows] = await db.query(
      `SELECT id_ocorrencia FROM ocorrencias WHERE id_ocorrencia IN (?)`, [ids]);
    return new Set(rows.map(r => String(r.id_ocorrencia)));
  },

  // Devolve um Map id_ocorrencia -> status atual (da base). Usado pelo
  // importador para detectar, antes do UPDATE, se o status mudou para CANCELADO.
  async statusPorId(ids) {
    if (!ids.length) return new Map();
    const [rows] = await db.query(
      `SELECT id_ocorrencia, status FROM ocorrencias WHERE id_ocorrencia IN (?)`, [ids]);
    return new Map(rows.map(r => [String(r.id_ocorrencia), r.status]));
  },

  // Insere em lote ocorrências novas (status_tratativa = PENDENTE).
  // registros: array de objetos já com chaves = COLUNAS_TXT.
  async inserirNovas(registros) {
    if (!registros.length) return 0;
    const cols = COLUNAS_TXT.join(',');
    const values = registros.map(r => COLUNAS_TXT.map(c => r[c] ?? null));
    const [res] = await db.query(
      `INSERT INTO ocorrencias (${cols}) VALUES ?`, [values]);
    return res.affectedRows;
  },

  // Atualiza apenas os campos do TXT (preserva fluxo/tratativa/histórico).
  async atualizarTxt(reg) {
    const cols = COLUNAS_TXT.filter(c => c !== 'id_ocorrencia');
    const set = cols.map(c => `${c} = ?`).join(', ');
    const params = cols.map(c => reg[c] ?? null);
    params.push(reg.id_ocorrencia);
    await db.query(`UPDATE ocorrencias SET ${set} WHERE id_ocorrencia = ?`, params);
  },

  async buscarPorId(id) {
    const [[row]] = await db.query(
      `SELECT o.*, v.nome AS vistoriador_nome, a.nome AS analista_nome
         FROM ocorrencias o
         LEFT JOIN usuarios v ON v.id = o.vistoriador_id
         LEFT JOIN usuarios a ON a.id = o.analista_id
        WHERE o.id_ocorrencia = ? LIMIT 1`, [id]);
    return row || null;
  },

  // Listagem para os cards. filtros: { status_tratativa, busca, cluster, empresa, status, limit, offset }
  async listar(filtros = {}) {
    const { where, params } = buildWhere(filtros);
    const sql = `
      SELECT o.id_ocorrencia, o.ta, o.empresa, o.cluster, o.afetacao, o.status,
             o.status_tratativa, o.municipio, o.bairro, o.armario,
             o.logradouro, o.numero_logradouro, o.data_ocorrencia,
             o.vistoriador_id, v.nome AS vistoriador_nome
        FROM ocorrencias o
        LEFT JOIN usuarios v ON v.id = o.vistoriador_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.data_ocorrencia DESC, o.afetacao DESC
       LIMIT ? OFFSET ?`;
    params.push(filtros.limit || 300, filtros.offset || 0);
    const [rows] = await db.query(sql, params);
    return rows;
  },

  // Total de registros que satisfazem os filtros (sem LIMIT/OFFSET).
  async contar(filtros = {}) {
    const { where, params } = buildWhere(filtros);
    const [[r]] = await db.query(
      `SELECT COUNT(*) AS total FROM ocorrencias o
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);
    return Number(r.total) || 0;
  },

  // Contagem agrupada para a tela de gerenciamento da base.
  async contarBase() {
    const [[r]] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status_tratativa = 'CORRECAO ENVIADA') AS finalizadas,
        SUM(status_tratativa = 'CANCELADA')        AS canceladas,
        SUM(status_tratativa IN ('CORRECAO ENVIADA','CANCELADA')) AS encerradas
      FROM ocorrencias`);
    return {
      total:       Number(r.total)       || 0,
      finalizadas: Number(r.finalizadas) || 0,
      canceladas:  Number(r.canceladas)  || 0,
      encerradas:  Number(r.encerradas)  || 0,
    };
  },

  // Apaga em massa. tipo: 'encerradas' | 'tudo'.
  // ON DELETE CASCADE garante que vistorias, correcoes, historico e fotos são removidos junto.
  async limparBase(tipo) {
    let sql;
    if (tipo === 'encerradas') {
      sql = "DELETE FROM ocorrencias WHERE status_tratativa IN ('CORRECAO ENVIADA','CANCELADA')";
    } else if (tipo === 'tudo') {
      sql = 'DELETE FROM ocorrencias';
    } else {
      return 0;
    }
    const [r] = await db.query(sql);
    return r.affectedRows || 0;
  },

  // Números-chave para o painel operacional.
  async metricas() {
    const [[r]] = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status_tratativa IN ${ATIVOS} THEN afetacao ELSE 0 END),0) AS clientes,
         SUM(status_tratativa IN ${ATIVOS})                              AS ativas,
         SUM(status = 'ABERTO')                                          AS abertas,
         SUM(status = 'FECHADO')                                         AS fechadas,
         SUM(status_tratativa IN ${ATIVOS} AND afetacao >= ?)           AS criticas,
         SUM(status_tratativa = 'PENDENTE')                             AS pendentes,
         SUM(status_tratativa = 'VISTORIA SUPERVISOR')                  AS em_vistoria,
         SUM(status_tratativa = 'AGUARDANDO CORRECAO')                  AS aguardando,
         COUNT(DISTINCT CASE WHEN status_tratativa = 'VISTORIA SUPERVISOR'
               THEN vistoriador_id END)                                 AS vistoriadores
       FROM ocorrencias`, [CRITICA_AFETACAO]);
    return {
      clientes:      Number(r.clientes)      || 0,
      ativas:        Number(r.ativas)        || 0,
      abertas:       Number(r.abertas)       || 0,
      fechadas:      Number(r.fechadas)      || 0,
      criticas:      Number(r.criticas)      || 0,
      pendentes:     Number(r.pendentes)     || 0,
      em_vistoria:   Number(r.em_vistoria)   || 0,
      aguardando:    Number(r.aguardando)    || 0,
      vistoriadores: Number(r.vistoriadores) || 0,
      criticaAfetacao: CRITICA_AFETACAO,
    };
  },

  // Alertas operacionais: ocorrências CRÍTICAS ainda PENDENTES (sem supervisor).
  async alertas(limit = 15) {
    const [itens] = await db.query(
      `SELECT id_ocorrencia, municipio, armario, afetacao, ta
         FROM ocorrencias
        WHERE status_tratativa = 'PENDENTE' AND afetacao >= ?
        ORDER BY afetacao DESC, data_ocorrencia ASC
        LIMIT ?`, [CRITICA_AFETACAO, limit]);
    const [[c]] = await db.query(
      `SELECT COUNT(*) AS total FROM ocorrencias
        WHERE status_tratativa = 'PENDENTE' AND afetacao >= ?`, [CRITICA_AFETACAO]);
    return { itens, total: Number(c.total) || 0 };
  },

  // Últimas ocorrências ativas entrantes (por data de ocorrência) — destaque do painel.
  async ultimasAtivas(limit = 6) {
    const [rows] = await db.query(
      `SELECT o.id_ocorrencia, o.municipio, o.armario, o.afetacao, o.ta,
              o.status, o.status_tratativa, o.logradouro, o.bairro,
              v.nome AS vistoriador_nome
         FROM ocorrencias o
         LEFT JOIN usuarios v ON v.id = o.vistoriador_id
        WHERE o.status_tratativa IN ${ATIVOS}
        ORDER BY o.data_ocorrencia DESC
        LIMIT ?`, [limit]);
    return rows;
  },

  async contarPorStatusTratativa() {
    const [rows] = await db.query(
      `SELECT status_tratativa, COUNT(*) AS total FROM ocorrencias GROUP BY status_tratativa`);
    const out = {};
    for (const r of rows) out[r.status_tratativa] = r.total;
    return out;
  },

  // Total de ocorrências vinculadas ao usuário (vistoriador ou analista), para a aba "Minhas".
  async contarMinhas(usuarioId) {
    const [[r]] = await db.query(
      `SELECT COUNT(*) AS total FROM ocorrencias
        WHERE (vistoriador_id = ? OR analista_id = ?) AND status_tratativa <> 'CANCELADA'`,
      [usuarioId, usuarioId]);
    return Number(r.total) || 0;
  },

  // Atômico: só assume se ainda estiver PENDENTE. Evita a corrida em que dois
  // vistoriadores assumem a mesma ocorrência (o segundo UPDATE sobrescreveria o
  // primeiro). Retorna true se ESTE chamador conseguiu assumir.
  async assumir(id, vistoriadorId) {
    const [r] = await db.query(
      `UPDATE ocorrencias
          SET status_tratativa = 'VISTORIA SUPERVISOR', vistoriador_id = ?, assumida_em = NOW()
        WHERE id_ocorrencia = ? AND status_tratativa = 'PENDENTE'`, [vistoriadorId, id]);
    return r.affectedRows > 0;
  },

  // Devolve para a fila: volta a PENDENTE e desfaz o vínculo do vistoriador.
  async devolverParaFila(id) {
    await db.query(
      `UPDATE ocorrencias
          SET status_tratativa = 'PENDENTE', vistoriador_id = NULL, assumida_em = NULL
        WHERE id_ocorrencia = ?`, [id]);
  },

  // Alterna ABERTO <-> FECHADO. Restrito a ocorrências manuais (ID_MANUAL_MIN):
  // nas importadas, o campo `status` reflete a base da Vivo e seria sobrescrito
  // no próximo ciclo de importação de qualquer forma.
  async alternarStatus(id) {
    const [r] = await db.query(
      `UPDATE ocorrencias
          SET status = CASE WHEN status = 'ABERTO' THEN 'FECHADO' ELSE 'ABERTO' END
        WHERE id_ocorrencia = ? AND id_ocorrencia >= ?`, [id, ID_MANUAL_MIN]);
    return r.affectedRows > 0;
  },

  async mudarStatusTratativa(id, novo, { analista_id } = {}) {
    if (analista_id !== undefined) {
      await db.query(
        `UPDATE ocorrencias SET status_tratativa = ?, analista_id = ? WHERE id_ocorrencia = ?`,
        [novo, analista_id, id]);
    } else {
      await db.query(
        `UPDATE ocorrencias SET status_tratativa = ? WHERE id_ocorrencia = ?`, [novo, id]);
    }
  },

  async excluir(id) {
    await db.query(`DELETE FROM ocorrencias WHERE id_ocorrencia = ?`, [id]);
  },

  async proximoIdManual() {
    const [[r]] = await db.query(
      `SELECT MAX(id_ocorrencia) AS mx FROM ocorrencias WHERE id_ocorrencia >= ?`,
      [ID_MANUAL_MIN]);
    return r.mx ? Number(r.mx) + 1 : ID_MANUAL_MIN + 1;
  },

  // Cria uma ocorrência avulsa, digitada manualmente (não veio do TXT importado).
  async criarManual({ armario, municipio, uf, cluster, empresa, status, sub_status,
                       tipo_servico, fluxo, ta, afetacao, data_ocorrencia }) {
    const id = await this.proximoIdManual();
    await db.query(
      `INSERT INTO ocorrencias
         (id_ocorrencia, municipio, cluster, empresa, armario, status, sub_status,
          tipo_servico, fluxo, ta, uf, afetacao, data_ocorrencia)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, municipio, cluster, empresa, armario, status, sub_status,
       tipo_servico, fluxo, ta, uf, afetacao, data_ocorrencia]);
    return id;
  },

  // Valores distintos para popular filtros. Opcionalmente limitado a um
  // status_tratativa (para os dropdowns da tela inicial respeitarem o perfil).
  async distintos(coluna, statusTratativa = null) {
    const permitidas = ['cluster', 'empresa', 'status', 'municipio', 'armario'];
    if (!permitidas.includes(coluna)) return [];
    const where = [`${coluna} IS NOT NULL`, `${coluna} <> ''`];
    const params = [];
    if (statusTratativa) { where.push('status_tratativa = ?'); params.push(statusTratativa); }
    const [rows] = await db.query(
      `SELECT DISTINCT ${coluna} AS v FROM ocorrencias WHERE ${where.join(' AND ')} ORDER BY ${coluna}`, params);
    return rows.map(r => r.v);
  },
};

module.exports = Ocorrencia;
