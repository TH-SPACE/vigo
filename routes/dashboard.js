'use strict';

const express = require('express');
const router  = express.Router();
const { requireLogin } = require('../middlewares/auth');
const dashboard = require('../controllers/dashboardController');

router.get('/', requireLogin, dashboard.index);

module.exports = router;
