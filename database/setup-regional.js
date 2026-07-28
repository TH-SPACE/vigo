'use strict';

// Aplica o schema do módulo de Reports Regional no banco já existente.
//   node database/setup-regional.js
// É idempotente (CREATE TABLE IF NOT EXISTS / INSERT IGNORE): pode rodar de novo
// sem apagar dado nem sobrescrever configuração já ajustada na tela.

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema_regional.sql'), 'utf8');

  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'vistoria_ocorrencias',
    multipleStatements: true,
    charset:  'utf8mb4',
  });

  console.log('▶  Aplicando schema_regional.sql ...');
  await conn.query(sql);

  const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM report_regional');
  const [[backfill]]  = await conn.query("SELECT valor FROM config WHERE chave = 'repreg_backfill_feito'");

  console.log('✅  Tabela report_regional pronta.');
  console.log(`      registros:  ${total}`);
  console.log(`      backfill:   ${backfill?.valor === '1' ? 'já feito' : 'pendente (1ª importação não notifica)'}`);

  await conn.end();
  process.exit(0);
}

main().catch(err => {
  console.error('❌  Erro na migração:', err.message);
  process.exit(1);
});
