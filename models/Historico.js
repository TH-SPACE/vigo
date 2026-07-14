'use strict';

const db = require('../database/connection');

const Historico = {
  async registrar({ ocorrencia_id, usuario = null, acao, status_anterior = null, status_novo = null, observacao = null }) {
    await db.query(
      `INSERT INTO historico
         (ocorrencia_id, usuario_id, usuario_nome, perfil, acao, status_anterior, status_novo, observacao)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ocorrencia_id, usuario?.id || null, usuario?.nome || null, usuario?.perfil || null,
       acao, status_anterior, status_novo, observacao]);
  },

  async porOcorrencia(ocorrencia_id) {
    const [rows] = await db.query(
      `SELECT * FROM historico WHERE ocorrencia_id = ? ORDER BY criado_em DESC`, [ocorrencia_id]);
    return rows;
  },
};

module.exports = Historico;
