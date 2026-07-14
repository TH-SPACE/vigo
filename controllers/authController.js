'use strict';

const Usuario = require('../models/Usuario');
const Auditoria = require('../models/Auditoria');
const Config = require('../models/Config');
const { gerarToken, setAuthCookie, clearAuthCookie } = require('../middlewares/auth');

async function autocadastroAtivo() {
  return String(await Config.get('autocadastro_ativo', '1')) === '1';
}

function flash(res, tipo, msg) {
  res.cookie('flash', JSON.stringify({ tipo, msg }), { httpOnly: false, maxAge: 10000 });
}

// Perfis que um usuário pode escolher no autocadastro. Apenas perfis SEM acesso
// administrativo: 'gm' e 'admin' NUNCA podem ser criados por auto-registro
// (evita escalonamento de privilégio via /cadastro).
const PERFIL_CADASTRO = { vistoriador: 3, analista: 4 };

function payloadDoUsuario(u) {
  return {
    id: u.id, nome: u.nome, email: u.email, perfil: u.perfil,
    cluster: u.cluster, primeiro_login: !!u.primeiro_login,
  };
}

module.exports = {
  async telaLogin(req, res) {
    if (req.user) return res.redirect('/dashboard');
    res.render('auth/login', { titulo: 'Entrar', autocadastro: await autocadastroAtivo() });
  },

  // ── Autocadastro (para testadores) ──
  async telaCadastro(req, res) {
    if (req.user) return res.redirect('/dashboard');
    if (!(await autocadastroAtivo())) {
      flash(res, 'erro', 'O autocadastro está desativado. Solicite acesso a um administrador.');
      return res.redirect('/login');
    }
    res.render('auth/cadastro', { titulo: 'Criar conta' });
  },

  async cadastrar(req, res) {
    if (req.user) return res.redirect('/dashboard');
    if (!(await autocadastroAtivo())) {
      flash(res, 'erro', 'O autocadastro está desativado.');
      return res.redirect('/login');
    }
    const nome  = (req.body.nome  || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const { senha, confirmar } = req.body;
    const perfil_id = PERFIL_CADASTRO[req.body.perfil] || PERFIL_CADASTRO.vistoriador;

    if (!nome || !email) { flash(res, 'erro', 'Informe nome e e-mail.'); return res.redirect('/cadastro'); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { flash(res, 'erro', 'E-mail inválido.'); return res.redirect('/cadastro'); }
    if (!senha || senha.length < 6) { flash(res, 'erro', 'A senha deve ter pelo menos 6 caracteres.'); return res.redirect('/cadastro'); }
    if (senha !== confirmar) { flash(res, 'erro', 'A confirmação de senha não confere.'); return res.redirect('/cadastro'); }
    if (await Usuario.emailExiste(email)) { flash(res, 'erro', 'Já existe uma conta com este e-mail.'); return res.redirect('/cadastro'); }

    const id = await Usuario.cadastrar({ nome, email, senha, perfil_id });
    const u = await Usuario.findById(id);
    setAuthCookie(res, gerarToken(payloadDoUsuario(u)));
    await Usuario.atualizarUltimoAcesso(id);
    await Auditoria.registrar({ usuario: { id: u.id, nome: u.nome, email: u.email }, acao: 'CADASTRO', detalhe: `Perfil: ${u.perfil}`, ip: req.ip });
    flash(res, 'ok', `Bem-vindo(a), ${u.nome.split(' ')[0]}! Sua conta foi criada.`);
    res.redirect('/dashboard');
  },

  async login(req, res) {
    const { email, senha } = req.body;
    const u = await Usuario.findByEmail((email || '').trim().toLowerCase());
    if (!u || u.status !== 'ativo' || !(await Usuario.verificarSenha(u.senha_hash, senha || ''))) {
      flash(res, 'erro', 'E-mail ou senha inválidos.');
      return res.redirect('/login');
    }

    const precisaTrocar = u.primeiro_login;
    const dados = payloadDoUsuario(u);
    dados.primeiro_login = precisaTrocar;

    setAuthCookie(res, gerarToken(dados));
    await Usuario.atualizarUltimoAcesso(u.id);
    await Auditoria.registrar({ usuario: { id: u.id, nome: u.nome, email: u.email }, acao: 'LOGIN', ip: req.ip });

    if (precisaTrocar) return res.redirect('/trocar-senha');
    res.redirect('/dashboard');
  },

  telaTrocarSenha(req, res) {
    if (!req.user) return res.redirect('/login');
    res.render('auth/trocar-senha', { titulo: 'Trocar senha' });
  },

  // Página "Meu perfil": dados do usuário + troca da própria senha.
  async telaPerfil(req, res) {
    if (!req.user) return res.redirect('/login');
    if (req.user.primeiro_login) return res.redirect('/trocar-senha');
    const u = await Usuario.findById(req.user.id);
    if (!u) return res.redirect('/logout');

    res.render('auth/perfil', { titulo: 'Meu perfil', u });
  },

  async trocarSenha(req, res) {
    if (!req.user) return res.redirect('/login');
    const { senha_atual, nova_senha, confirmar } = req.body;
    // De onde veio: do perfil (mantém na app) ou da troca obrigatória.
    const voltarErro = req.body.origem === 'perfil' ? '/perfil' : '/trocar-senha';

    const u = await Usuario.findById(req.user.id);
    if (!u) return res.redirect('/logout');

    if (!(await Usuario.verificarSenha(u.senha_hash, senha_atual || ''))) {
      flash(res, 'erro', 'Senha atual incorreta.');
      return res.redirect(voltarErro);
    }
    if (!nova_senha || nova_senha.length < 6) {
      flash(res, 'erro', 'A nova senha deve ter pelo menos 6 caracteres.');
      return res.redirect(voltarErro);
    }
    if (nova_senha !== confirmar) {
      flash(res, 'erro', 'A confirmação não confere.');
      return res.redirect(voltarErro);
    }
    if (await Usuario.senhaJaUsada(u.id, nova_senha)) {
      flash(res, 'erro', 'Você não pode reutilizar uma das últimas senhas.');
      return res.redirect(voltarErro);
    }

    await Usuario.alterarSenha(u.id, nova_senha);
    await Auditoria.log(req, 'TROCA DE SENHA');

    // Renova o token sem a flag de troca
    const dados = payloadDoUsuario({ ...u, primeiro_login: 0 });
    setAuthCookie(res, gerarToken(dados));
    flash(res, 'ok', 'Senha alterada com sucesso!');
    res.redirect(req.body.origem === 'perfil' ? '/perfil' : '/dashboard');
  },

  async logout(req, res) {
    await Auditoria.log(req, 'LOGOUT');
    clearAuthCookie(res);
    res.redirect('/login');
  },
};
