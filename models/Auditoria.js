'use strict';

const db = require('../database/connection');

const Auditoria = {
  // Registra uma ação. Nunca lança erro (não pode quebrar a ação principal).
  async registrar({ usuario = null, email = null, acao, detalhe = null, ip = null }) {
    try {
      await db.query(
        `INSERT INTO auditoria (usuario_id, usuario_email, acao, detalhe, ip)
         VALUES (?,?,?,?,?)`,
        [usuario?.id || null, usuario?.email || email || null, acao, detalhe, ip]);
    } catch (e) {
      console.error('[Auditoria] falha ao registrar:', e.message);
    }
  },

  // Atalho a partir do request (pega usuário logado e IP).
  log(req, acao, detalhe = null) {
    return this.registrar({ usuario: req.user || null, acao, detalhe, ip: req.ip });
  },

  async listar({ limit = 300, acao = null, busca = null } = {}) {
    const where = [];
    const params = [];
    if (acao)  { where.push('acao = ?'); params.push(acao); }
    if (busca) {
      where.push('(usuario_email LIKE ? OR detalhe LIKE ? OR acao LIKE ?)');
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    }
    params.push(limit);
    const [rows] = await db.query(
      `SELECT * FROM auditoria
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY criado_em DESC LIMIT ?`, params);
    return rows;
  },

  async acoesDistintas() {
    const [rows] = await db.query(`SELECT DISTINCT acao FROM auditoria ORDER BY acao`);
    return rows.map(r => r.acao);
  },

  async total() {
    const [[r]] = await db.query(`SELECT COUNT(*) AS n FROM auditoria`);
    return Number(r.n) || 0;
  },

  // Remove registros mais antigos que `dias`. Retorna quantos foram apagados.
  // `dias <= 0` significa "guardar para sempre": NUNCA apaga. Antes o guard era
  // `d < 0`, então dias=0 caía no DELETE com `INTERVAL 0 DAY` (criado_em < NOW())
  // e varria o log inteiro a cada ciclo de importação — a auditoria vivia vazia.
  async limparAntigas(dias) {
    const d = parseInt(dias, 10);
    if (isNaN(d) || d <= 0) return 0;
    const [r] = await db.query(
      `DELETE FROM auditoria WHERE criado_em < (NOW() - INTERVAL ? DAY)`, [d]);
    return r.affectedRows || 0;
  },
};

module.exports = Auditoria;
