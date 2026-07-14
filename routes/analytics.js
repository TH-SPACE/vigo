'use strict';

const express  = require('express');
const router   = express.Router();
const { requireLogin } = require('../middlewares/auth');
const admin    = require('../controllers/adminController');

router.use(requireLogin);

router.get('/',         admin.analytics);
router.get('/exportar', admin.exportarBase);

module.exports = router;
