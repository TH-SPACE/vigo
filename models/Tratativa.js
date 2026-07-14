'use strict';

const db = require('../database/connection');

const Tratativa = {
  async criar({ ocorrencia_id, usuario_id, observacao }) {
    const [r] = await db.query(
      `INSERT INTO tratativas (ocorrencia_id, usuario_id, observacao) VALUES (?,?,?)`,
      [ocorrencia_id, usuario_id, observacao]);
    return r.insertId;
  },

  // Mais recente primeiro
  async porOcorrencia(ocorrencia_id) {
    const [rows] = await db.query(
      `SELECT t.*, u.nome AS usuario_nome, p.nome AS perfil
         FROM tratativas t
         JOIN usuarios u ON u.id = t.usuario_id
         JOIN perfis  p ON p.id = u.perfil_id
        WHERE t.ocorrencia_id = ?
        ORDER BY t.criado_em DESC`, [ocorrencia_id]);
    return rows;
  },
};

module.exports = Tratativa;
