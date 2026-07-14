'use strict';

const db = require('../database/connection');

const Vistoria = {
  async criar({ ocorrencia_id, vistoriador_id, causa_id, sugestao_correcao, correcao_definitiva }) {
    const [r] = await db.query(
      `INSERT INTO vistorias (ocorrencia_id, vistoriador_id, causa_id, sugestao_correcao, correcao_definitiva)
       VALUES (?,?,?,?,?)`,
      [ocorrencia_id, vistoriador_id, causa_id || null, sugestao_correcao,
       correcao_definitiva === 'SIM' ? 'SIM' : 'NAO']);
    return r.insertId;
  },

  async porOcorrencia(ocorrencia_id) {
    const [[row]] = await db.query(
      `SELECT v.*, c.nome AS causa_nome, u.nome AS vistoriador_nome
         FROM vistorias v
         LEFT JOIN causas c   ON c.id = v.causa_id
         LEFT JOIN usuarios u ON u.id = v.vistoriador_id
        WHERE v.ocorrencia_id = ?
        ORDER BY v.criado_em DESC LIMIT 1`, [ocorrencia_id]);
    return row || null;
  },

  async atualizar(id, { causa_id, sugestao_correcao, correcao_definitiva }) {
    await db.query(
      `UPDATE vistorias SET causa_id=?, sugestao_correcao=?, correcao_definitiva=? WHERE id=?`,
      [causa_id || null, sugestao_correcao, correcao_definitiva === 'SIM' ? 'SIM' : 'NAO', id]);
  },

  async deletar(id) {
    await db.query(`DELETE FROM vistorias WHERE id=?`, [id]);
  },
};

module.exports = Vistoria;
