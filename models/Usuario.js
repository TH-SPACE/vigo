'use strict';

const db     = require('../database/connection');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS   = 12;
const HISTORICO_MAX = 5;

function senhaInicialDeMatricula(matricula) {
  const digitos = String(matricula || '').replace(/\D/g, '');
  return digitos.slice(-4) || '0000';
}

const Usuario = {
  senhaInicialDeMatricula,

  async findByEmail(email) {
    const [[row]] = await db.query(
      `SELECT u.*, p.nome AS perfil
         FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
        WHERE u.email = ? LIMIT 1`, [email]);
    return row || null;
  },

  async findById(id) {
    const [[row]] = await db.query(
      `SELECT u.*, p.nome AS perfil
         FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
        WHERE u.id = ? LIMIT 1`, [id]);
    return row || null;
  },

  async findAll() {
    const [rows] = await db.query(
      `SELECT u.id, u.nome, u.email, u.matricula, u.cluster, u.status,
              u.primeiro_login, u.ultimo_acesso, u.criado_em, p.nome AS perfil, p.id AS perfil_id
         FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
        ORDER BY u.criado_em DESC`);
    return rows;
  },

  async emailExiste(email) {
    const [[row]] = await db.query(`SELECT id FROM usuarios WHERE email = ?`, [email]);
    return !!row;
  },

  async create({ nome, email, matricula = null, cluster = 'GOIANIA', perfil_id = 3, senha = null }) {
    const senhaClara = senha || senhaInicialDeMatricula(matricula);
    const hash = await bcrypt.hash(senhaClara, SALT_ROUNDS);
    const [r] = await db.query(
      `INSERT INTO usuarios (nome, email, matricula, cluster, perfil_id, senha_hash, status, primeiro_login)
       VALUES (?,?,?,?,?,?, 'ativo', 1)`,
      [nome, email, matricula, cluster, perfil_id, hash]);
    await db.query(`INSERT INTO historico_senhas (usuario_id, senha_hash) VALUES (?,?)`, [r.insertId, hash]);
    return r.insertId;
  },

  // Autocadastro (tela de login): cria a conta já ativa, com a senha
  // escolhida pelo usuário, sem troca obrigatória e sem senha expirada.
  async cadastrar({ nome, email, senha, cluster = 'GOIANIA', perfil_id = 3 }) {
    const hash = await bcrypt.hash(senha, SALT_ROUNDS);
    const [r] = await db.query(
      `INSERT INTO usuarios (nome, email, cluster, perfil_id, senha_hash, status, primeiro_login, senha_alterada_em)
       VALUES (?,?,?,?,?, 'ativo', 0, NOW())`,
      [nome, email, cluster, perfil_id, hash]);
    await db.query(`INSERT INTO historico_senhas (usuario_id, senha_hash) VALUES (?,?)`, [r.insertId, hash]);
    return r.insertId;
  },

  async atualizar(id, { nome, email, matricula, cluster, perfil_id }) {
    await db.query(
      `UPDATE usuarios SET nome=?, email=?, matricula=?, cluster=?, perfil_id=? WHERE id=?`,
      [nome, email, matricula, cluster, perfil_id, id]);
  },

  async alterarStatus(id, status) {
    await db.query(`UPDATE usuarios SET status=? WHERE id=?`, [status, id]);
  },

  async atualizarUltimoAcesso(id) {
    await db.query(`UPDATE usuarios SET ultimo_acesso = NOW() WHERE id = ?`, [id]);
  },

  verificarSenha(hash, senha) {
    return bcrypt.compare(senha, hash);
  },

  async senhaJaUsada(usuario_id, novaSenha) {
    const [hist] = await db.query(
      `SELECT senha_hash FROM historico_senhas
        WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT ?`,
      [usuario_id, HISTORICO_MAX]);
    for (const h of hist) {
      if (await bcrypt.compare(novaSenha, h.senha_hash)) return true;
    }
    return false;
  },

  async alterarSenha(usuario_id, novaSenha) {
    const hash = await bcrypt.hash(novaSenha, SALT_ROUNDS);
    await db.query(
      `UPDATE usuarios SET senha_hash=?, senha_alterada_em=NOW(), primeiro_login=0 WHERE id=?`,
      [hash, usuario_id]);
    await db.query(`INSERT INTO historico_senhas (usuario_id, senha_hash) VALUES (?,?)`, [usuario_id, hash]);
    await db.query(
      `DELETE FROM historico_senhas WHERE usuario_id=? AND id NOT IN (
         SELECT id FROM (SELECT id FROM historico_senhas WHERE usuario_id=? ORDER BY criado_em DESC LIMIT ?) t)`,
      [usuario_id, usuario_id, HISTORICO_MAX]);
  },

  // Reseta para a senha inicial (4 últimos da matrícula) e força troca.
  async resetarSenha(usuario_id, matricula) {
    const senhaTemp = senhaInicialDeMatricula(matricula);
    const hash = await bcrypt.hash(senhaTemp, SALT_ROUNDS);
    await db.query(
      `UPDATE usuarios SET senha_hash=?, senha_alterada_em=NOW(), primeiro_login=1 WHERE id=?`,
      [hash, usuario_id]);
    await db.query(`INSERT INTO historico_senhas (usuario_id, senha_hash) VALUES (?,?)`, [usuario_id, hash]);
    return senhaTemp;
  },
};

module.exports = Usuario;
