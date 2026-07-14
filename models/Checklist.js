'use strict';

const db = require('../database/connection');

const Checklist = {
  async listar(somenteAtivas = false) {
    const sql = somenteAtivas
      ? `SELECT * FROM checklist_perguntas WHERE ativo = 1 ORDER BY ordem, id`
      : `SELECT * FROM checklist_perguntas ORDER BY ordem, id`;
    const [rows] = await db.query(sql);
    return rows;
  },

  async criar({ pergunta, obrigatoria = 0, ordem = 0 }) {
    const [r] = await db.query(
      `INSERT INTO checklist_perguntas (pergunta, obrigatoria, ordem) VALUES (?,?,?)`,
      [pergunta, obrigatoria ? 1 : 0, ordem]);
    return r.insertId;
  },

  async atualizar(id, { pergunta, ativo, obrigatoria, ordem }) {
    await db.query(
      `UPDATE checklist_perguntas SET pergunta=?, ativo=?, obrigatoria=?, ordem=? WHERE id=?`,
      [pergunta, ativo ? 1 : 0, obrigatoria ? 1 : 0, ordem || 0, id]);
  },

  async excluir(id) {
    await db.query(`DELETE FROM checklist_perguntas WHERE id=?`, [id]);
  },

  async possuiRespostas(id) {
    const [rows] = await db.query(
      `SELECT 1 FROM checklist_respostas WHERE pergunta_id=? LIMIT 1`, [id]);
    return rows.length > 0;
  },

  // Exclusão forçada: apaga também as respostas já registradas para essa
  // pergunta (perde o histórico dessas respostas nas vistorias/correções).
  async excluirComRespostas(id) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(`DELETE FROM checklist_respostas WHERE pergunta_id=?`, [id]);
      await conn.query(`DELETE FROM checklist_perguntas WHERE id=?`, [id]);
      await conn.commit();
      return r.affectedRows;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  // Grava as respostas de uma vistoria/correção
  async salvarRespostas(origem, origem_id, respostas) {
    if (!respostas?.length) return;
    const values = respostas.map(r => [origem, origem_id, r.pergunta_id, r.resposta, r.observacao || null]);
    await db.query(
      `INSERT INTO checklist_respostas (origem, origem_id, pergunta_id, resposta, observacao) VALUES ?`,
      [values]);
  },

  async limparRespostas(origem, origem_id) {
    await db.query(`DELETE FROM checklist_respostas WHERE origem=? AND origem_id=?`, [origem, origem_id]);
  },

  async respostasDe(origem, origem_id) {
    const [rows] = await db.query(
      `SELECT cr.*, cp.pergunta
         FROM checklist_respostas cr
         JOIN checklist_perguntas cp ON cp.id = cr.pergunta_id
        WHERE cr.origem = ? AND cr.origem_id = ?
        ORDER BY cp.ordem, cp.id`,
      [origem, origem_id]);
    return rows;
  },
};

module.exports = Checklist;
