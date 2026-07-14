'use strict';

const db = require('../database/connection');

const Observacao = {
  async porOcorrencia(id) {
    const [rows] = await db.query(
      `SELECT id, observacao, usuario, data_observacao
         FROM observacoes_ocorrencia
        WHERE id_ocorrencia = ?
        ORDER BY data_observacao ASC`, [id]);
    return rows;
  },

  // Adiciona uma única observação avulsa (ex.: digitada manualmente pelo admin).
  async adicionar(id_ocorrencia, observacao, usuario, data_observacao) {
    await db.query(
      `INSERT INTO observacoes_ocorrencia (id_ocorrencia, observacao, usuario, data_observacao)
       VALUES (?,?,?,?)`,
      [id_ocorrencia, observacao, usuario, data_observacao]);
  },

  // Substitui todas as observações das ocorrências presentes nos registros.
  // Faz DELETE + INSERT por ocorrência para manter dados sempre sincronizados.
  async substituirParaOcorrencias(registros) {
    if (!registros.length) return 0;

    const porOc = new Map();
    for (const r of registros) {
      if (!porOc.has(r.id_ocorrencia)) porOc.set(r.id_ocorrencia, []);
      porOc.get(r.id_ocorrencia).push(r);
    }

    let total = 0;
    for (const [id_ocorrencia, obs] of porOc) {
      await db.query(`DELETE FROM observacoes_ocorrencia WHERE id_ocorrencia = ?`, [id_ocorrencia]);
      if (obs.length) {
        const values = obs.map(o => [id_ocorrencia, o.observacao, o.usuario, o.data_observacao]);
        const [res] = await db.query(
          `INSERT INTO observacoes_ocorrencia (id_ocorrencia, observacao, usuario, data_observacao) VALUES ?`,
          [values]);
        total += res.affectedRows;
      }
    }
    return total;
  },
};

module.exports = Observacao;
