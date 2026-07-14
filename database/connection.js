'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:            process.env.DB_HOST     || 'localhost',
  user:            process.env.DB_USER     || 'root',
  password:        process.env.DB_PASSWORD || '',
  database:        process.env.DB_NAME     || 'vistoria_ocorrencias',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:          0,
  timezone:       '-03:00',
  charset:        'utf8mb4',
  dateStrings:    true,
});

pool.getConnection()
  .then(conn => { conn.release(); console.log('✅  Pool MariaDB OK'); })
  .catch(err  => console.error('❌  Falha no pool MariaDB:', err.message));

module.exports = pool;
