'use strict';

// Importação manual via CLI:  npm run import
require('dotenv').config();
const { importar } = require('./importador');

importar()
  .then(r => { console.log('Resultado:', r); process.exit(0); })
  .catch(e => { console.error('Falha na importação:', e.message); process.exit(1); });
