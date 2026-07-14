'use strict';

const db = require('../database/connection');

const Foto = {
  // fotos: array de { rotulo, arquivo }
  async salvar(origem, origem_id, fotos) {
    if (!fotos?.length) return;
    const values = fotos.map(f => [origem, origem_id, f.rotulo, f.arquivo]);
    await db.query(
      `INSERT INTO fotos (origem, origem_id, rotulo, arquivo) VALUES ?`, [values]);
  },

  async listar(origem, origem_id) {
    const [rows] = await db.query(
      `SELECT * FROM fotos WHERE origem = ? AND origem_id = ? ORDER BY id`, [origem, origem_id]);
    return rows;
  },

  async substituirPorRotulo(origem, origem_id, rotulo, arquivo) {
    await db.query(`DELETE FROM fotos WHERE origem=? AND origem_id=? AND rotulo=?`, [origem, origem_id, rotulo]);
    await db.query(`INSERT INTO fotos (origem, origem_id, rotulo, arquivo) VALUES (?,?,?,?)`, [origem, origem_id, rotulo, arquivo]);
  },

  async deletarDe(origem, origem_id) {
    await db.query(`DELETE FROM fotos WHERE origem=? AND origem_id=?`, [origem, origem_id]);
  },
};

module.exports = Foto;
