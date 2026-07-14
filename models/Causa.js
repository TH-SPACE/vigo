'use strict';

const db = require('../database/connection');

const Causa = {
  async listar(somenteAtivas = false) {
    const sql = somenteAtivas
      ? `SELECT * FROM causas WHERE ativo = 1 ORDER BY nome`
      : `SELECT * FROM causas ORDER BY nome`;
    const [rows] = await db.query(sql);
    return rows;
  },

  async criar(nome) {
    const [r] = await db.query(`INSERT INTO causas (nome) VALUES (?)`, [nome]);
    return r.insertId;
  },

  async atualizar(id, { nome, ativo }) {
    await db.query(`UPDATE causas SET nome=?, ativo=? WHERE id=?`, [nome, ativo ? 1 : 0, id]);
  },

  async excluir(id) {
    await db.query(`DELETE FROM causas WHERE id=?`, [id]);
  },
};

module.exports = Causa;
