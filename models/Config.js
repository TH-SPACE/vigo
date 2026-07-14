'use strict';

const db = require('../database/connection');

const Config = {
  async get(chave, padrao = null) {
    const [[row]] = await db.query(`SELECT valor FROM config WHERE chave = ?`, [chave]);
    return row ? row.valor : padrao;
  },

  async getAll() {
    const [rows] = await db.query(`SELECT chave, valor FROM config`);
    const obj = {};
    for (const r of rows) obj[r.chave] = r.valor;
    return obj;
  },

  async set(chave, valor) {
    await db.query(
      `INSERT INTO config (chave, valor) VALUES (?,?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [chave, valor == null ? '' : String(valor)]);
  },

  async setMany(obj) {
    for (const [k, v] of Object.entries(obj)) await this.set(k, v);
  },

  // Lista CSV → array limpo em maiúsculas
  async getLista(chave) {
    const v = await this.get(chave, '');
    return String(v || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  },
};

module.exports = Config;
