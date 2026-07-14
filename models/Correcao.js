'use strict';

const db = require('../database/connection');

const Correcao = {
  async criar({ ocorrencia_id, analista_id, observacao }) {
    const [r] = await db.query(
      `INSERT INTO correcoes (ocorrencia_id, analista_id, observacao) VALUES (?,?,?)`,
      [ocorrencia_id, analista_id, observacao || null]);
    return r.insertId;
  },

  async porOcorrencia(ocorrencia_id) {
    const [rows] = await db.query(
      `SELECT c.*, u.nome AS analista_nome
         FROM correcoes c
         LEFT JOIN usuarios u ON u.id = c.analista_id
        WHERE c.ocorrencia_id = ?
        ORDER BY c.criado_em DESC`, [ocorrencia_id]);
    return rows;
  },
};

module.exports = Correcao;
