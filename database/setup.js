'use strict';

// Executa o schema.sql e cria um usuário Admin inicial.
//   node database/setup.js

require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  // Conecta sem selecionar database para permitir CREATE DATABASE.
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset:  'utf8mb4',
  });

  console.log('▶  Executando schema.sql ...');
  await conn.query(schema);
  console.log('✅  Schema aplicado.');

  await conn.changeUser({ database: process.env.DB_NAME || 'vistoria_ocorrencias' });

  // Módulo de Reports por Empresa (tabela e configs próprias, isoladas do VIGO).
  console.log('▶  Executando schema_reports.sql ...');
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema_reports.sql'), 'utf8'));
  console.log('✅  Módulo de reports aplicado.');

  // ── Admin inicial ──
  const ADMIN_EMAIL     = 'admin@telefonica.com';
  const ADMIN_MATRICULA = '12345678';
  const ADMIN_SENHA     = ADMIN_MATRICULA.slice(-4); // 5678 (regra de senha inicial)

  const [[existe]] = await conn.query('SELECT id FROM usuarios WHERE email = ?', [ADMIN_EMAIL]);
  if (!existe) {
    const hash = await bcrypt.hash(ADMIN_SENHA, SALT_ROUNDS);
    const [r] = await conn.query(
      `INSERT INTO usuarios (nome, email, matricula, cluster, perfil_id, senha_hash, status, primeiro_login)
       VALUES (?,?,?,?,?,?, 'ativo', 1)`,
      ['Administrador', ADMIN_EMAIL, ADMIN_MATRICULA, 'GOIANIA', 1, hash]
    );
    await conn.query('INSERT INTO historico_senhas (usuario_id, senha_hash) VALUES (?,?)', [r.insertId, hash]);
    console.log('✅  Admin criado:');
    console.log(`      email:    ${ADMIN_EMAIL}`);
    console.log(`      senha:    ${ADMIN_SENHA}   (troca obrigatória no 1º login)`);
  } else {
    console.log('ℹ️   Admin já existe — pulei a criação.');
  }

  await conn.end();
  console.log('\n🎉  Setup concluído.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌  Erro no setup:', err.message);
  process.exit(1);
});
