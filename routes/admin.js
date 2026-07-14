'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { requireLogin, requireAdminOuGm } = require('../middlewares/auth');
const admin = require('../controllers/adminController');

const planilha = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireLogin, requireAdminOuGm);

// Painel Admin (hub)
router.get('/', admin.hub);

// Auditoria
router.get('/auditoria',           admin.auditoria);
router.post('/auditoria/retencao', admin.salvarRetencaoAuditoria);
router.post('/auditoria/limpar',   admin.limparAuditoria);

// Usuários
router.get('/usuarios',                  admin.usuarios);
router.post('/usuarios',                 admin.criarUsuario);
router.post('/usuarios/massa',           planilha.single('planilha'), admin.criarUsuariosMassa);
router.post('/usuarios/:id/editar',      admin.editarUsuario);
router.post('/usuarios/:id/status',      admin.alterarStatusUsuario);
router.post('/usuarios/:id/resetar',     admin.resetarSenhaUsuario);

// Configuração de importação
router.get('/config',          admin.config);
router.post('/config',         admin.salvarConfig);
router.post('/config/importar',             admin.importarAgora);
router.post('/config/importar-observacoes',   admin.importarObservacoesAgora);

// WhatsApp
router.get('/whatsapp',                  admin.whatsapp);
router.post('/whatsapp',                 admin.salvarWhatsapp);
router.post('/whatsapp/teste',           admin.whatsappTeste);
router.post('/whatsapp/teste-aberta',    admin.whatsappTesteAberta);
router.post('/whatsapp/report-abertos',  admin.reportAbertosAgora);
router.post('/whatsapp/resumo',          admin.whatsappResumoAgora);

// Reports por Empresa (módulo separado: tabela report_ocorrencias, configs rep_*)
router.get('/reports-empresas',                   admin.reportsEmpresas);
router.post('/reports-empresas',                  admin.salvarReportsEmpresas);
router.post('/reports-empresas/importar',         admin.reportsImportarAgora);
router.post('/reports-empresas/silenciar',        admin.reportsMarcarAvisadas);
router.post('/reports-empresas/testar/:empresa',  admin.reportsTestar);

// Analytics
router.get('/analytics',          admin.analytics);
router.get('/analytics/exportar', admin.exportarBase);

// Causas
router.get('/causas',             admin.causas);
router.post('/causas',            admin.criarCausa);
router.post('/causas/:id/editar', admin.editarCausa);
router.post('/causas/:id/excluir', admin.excluirCausa);

// Checklist
router.get('/checklist',             admin.checklist);
router.post('/checklist',            admin.criarPergunta);
router.post('/checklist/:id/editar', admin.editarPergunta);
router.post('/checklist/:id/excluir', admin.excluirPergunta);

// Gerenciamento da base
router.get('/base',         admin.base);
router.post('/base/limpar', admin.limparBase);

// Ocorrências
router.get('/ocorrencias',              admin.ocorrencias);
router.post('/ocorrencias/nova',                admin.criarOcorrenciaManual);
router.post('/ocorrencias/:id/cancelar',        admin.cancelarOcorrencia);
router.post('/ocorrencias/:id/encerrar',        admin.encerrarOcorrencia);
router.post('/ocorrencias/:id/resetar-vistoria', admin.resetarVistoria);
router.post('/ocorrencias/:id/excluir',         admin.excluirOcorrencia);

module.exports = router;
