'use strict';

require('dotenv').config();
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');
const helmet       = require('helmet');

const { carregarUsuario } = require('./middlewares/auth');
const { iniciarScheduler } = require('./services/scheduler');

const app = express();

// Versão de assets (fura cache do navegador quando editamos CSS/JS).
// Em desenvolvimento recalcula a cada request (o nodemon não reinicia ao
// editar só o CSS); em produção calcula uma vez na subida.
const ASSET_FILES = ['public/css/app.css', 'public/js/app.js', 'public/js/painel.js', 'public/js/notificacoes.js'];
function computeAssetVer() {
  try {
    let max = 0;
    for (const f of ASSET_FILES) {
      const m = fs.statSync(path.join(__dirname, f)).mtimeMs;
      if (m > max) max = m;
    }
    return Math.floor(max).toString(36);
  } catch { return Date.now().toString(36); }
}
const DEV = process.env.NODE_ENV !== 'production';
const ASSET_VER = computeAssetVer();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));
app.use(morgan('dev'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Injeta usuário (JWT) e helpers em todas as views
app.use(carregarUsuario);
// Mapa visual dos status de tratativa (classe CSS + rótulo)
const STATUS_META = {
  'PENDENTE':            { cls: 'pendente',   card: 's-pendente',   label: 'Pendente Vistoria' },
  'VISTORIA SUPERVISOR': { cls: 'vistoria',   card: 's-vistoria',   label: 'Em Vistoria'        },
  'AGUARDANDO CORRECAO': { cls: 'aguardando', card: 's-aguardando', label: 'Aguardando Correção' },
  'CORRECAO ENVIADA':    { cls: 'enviada',    card: 's-enviada',    label: 'Correção Enviada'   },
  'CANCELADA':           { cls: 'cancelada',  card: 's-cancelada',  label: 'Cancelada'          },
};
app.use((req, res, next) => {
  res.locals.assetVer = DEV ? computeAssetVer() : ASSET_VER;
  res.locals.path = req.path;
  res.locals.statusMeta = (s) => STATUS_META[s] || { cls: 'status', card: '' };
  res.locals.fmtData = (d) => {
    if (!d) return '—';
    const dt = new Date(d.replace ? d.replace(' ', 'T') : d);
    if (isNaN(dt)) return d;
    return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  next();
});

// Rotas
app.use('/',                    require('./routes/auth'));
app.use('/painel',              require('./routes/painel'));
app.use('/dashboard',           require('./routes/dashboard'));
app.use('/ocorrencias',         require('./routes/ocorrencias'));
app.use('/admin',               require('./routes/admin'));
app.use('/analytics',           require('./routes/analytics'));
app.use('/api/notificacoes',    require('./routes/notificacoes'));

app.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { titulo: 'Página não encontrada', mensagem: 'A página que você buscou não existe.', code: 404 });
});

// Erro global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { titulo: 'Erro interno', mensagem: 'Ocorreu um erro inesperado.', code: 500 });
});

iniciarScheduler();

const PORT = process.env.PORT || 3392;
app.listen(PORT, () => {
  const line = '─'.repeat(46);
  console.log(`\n\x1b[35m╭${line}╮\x1b[0m`);
  console.log(`\x1b[35m│\x1b[0m  \x1b[1m\x1b[35m🟣 VIGO · Vistoria de Ocorrências de Grande Vulto\x1b[0m             \x1b[35m│\x1b[0m`);
  console.log(`\x1b[35m├${line}┤\x1b[0m`);
  console.log(`\x1b[35m│\x1b[0m  🌐 http://localhost:\x1b[1m${PORT}\x1b[0m`);
  console.log(`\x1b[35m│\x1b[0m  🗄️  ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log(`\x1b[35m│\x1b[0m  📅 ${new Date().toLocaleString('pt-BR')}`);
  console.log(`\x1b[35m╰${line}╯\x1b[0m\n`);
});
