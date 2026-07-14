'use strict';

const multer = require('multer');
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

const MAX_SIZE_MB   = parseInt(process.env.UPLOAD_MAX_MB   || '12');
const PHOTO_WIDTH   = parseInt(process.env.PHOTO_MAX_WIDTH || '1280');
const PHOTO_QUALITY = parseInt(process.env.PHOTO_QUALITY   || '80');

const EXT_OK = ['jpg', 'jpeg', 'png', 'webp'];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (!file.mimetype.startsWith('image/') || !EXT_OK.includes(ext)) {
    return cb(new Error('Formato inválido. Use jpg, jpeg, png ou webp.'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
});

// tipo: 'vistorias' | 'correcoes'
function dirMes(tipo) {
  const agora = new Date();
  const ano   = agora.getFullYear();
  const mes   = String(agora.getMonth() + 1).padStart(2, '0');
  const dir   = path.join(__dirname, '..', 'uploads', tipo, String(ano), mes);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, ano, mes };
}

// Comprime cada arquivo para WebP, nome único, devolve o caminho relativo p/ o banco.
async function processarFoto(file, tipo) {
  const { dir, ano, mes } = dirMes(tipo);
  const nome = `${uuidv4()}.webp`;
  const dest = path.join(dir, nome);
  await sharp(file.buffer)
    .rotate() // respeita orientação EXIF (fotos de celular)
    .resize({ width: PHOTO_WIDTH, withoutEnlargement: true })
    .webp({ quality: PHOTO_QUALITY })
    .toFile(dest);
  return `${tipo}/${ano}/${mes}/${nome}`;
}

module.exports = { upload, processarFoto };
