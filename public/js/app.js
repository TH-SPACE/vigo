'use strict';

/* ---------- Alternador de tema (claro/escuro) ---------- */
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-tema-toggle]')) return;
  const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
  const novo = escuro ? 'light' : 'dark';
  if (novo === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('tema', novo); } catch (_) {}
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', novo === 'dark' ? '#1d1730' : '#660099');
});

/* ---------- Preview de fotos (câmera/galeria) ---------- */
document.addEventListener('change', (e) => {
  const input = e.target;
  if (input.type !== 'file' || !input.files?.length) return;
  const slot = input.closest('.foto-slot');
  if (!slot) return;
  const file = input.files[0];
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  let img = slot.querySelector('img.preview');
  if (!img) {
    img = document.createElement('img');
    img.className = 'preview';
    slot.querySelector('.foto-drop').appendChild(img);
  }
  img.src = url;
  slot.classList.add('preenchido');
});

/* ---------- Modal genérico de confirmação ---------- */
function abrirModal(opts) {
  const bg = document.getElementById('modalConfirm');
  if (!bg) return;
  bg.querySelector('[data-fig]').src = opts.fig || '/svg/vivo-chat-duvida-cinza-centro-320x320.svg';
  bg.querySelector('[data-titulo]').textContent = opts.titulo || 'Confirmar';
  bg.querySelector('[data-msg]').textContent = opts.msg || '';
  const sim = bg.querySelector('[data-sim]');
  sim.textContent = opts.simLabel || 'SIM';
  sim.className = 'btn ' + (opts.simClasse || 'rosa');
  sim.onclick = () => {
    sim.classList.add('is-loading');
    const sp = document.createElement('span'); sp.className = 'btn-spin'; sim.prepend(sp);
    opts.onSim && opts.onSim();
  };
  bg.querySelector('[data-nao]').onclick = fecharModal;
  bg.classList.add('aberto');
}
function fecharModal() {
  document.getElementById('modalConfirm')?.classList.remove('aberto');
}
document.addEventListener('click', (e) => {
  const bg = document.getElementById('modalConfirm');
  if (e.target === bg) fecharModal();
});

/* ---------- Assumir ocorrência (card → modal) ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-assumir]');
  if (!el) return;
  e.preventDefault();
  const url = el.getAttribute('data-assumir');
  const id  = el.getAttribute('data-id') || '';
  abrirModal({
    fig: '/svg/vivo-homem-ferramentas-320x320.svg',
    titulo: 'Deseja assumir esta ordem?',
    msg: 'Ocorrência ' + id + ' será atribuída a você para vistoria.',
    simLabel: 'SIM, ASSUMIR', simClasse: 'rosa',
    onSim: () => {
      const f = document.createElement('form');
      f.method = 'POST'; f.action = url; document.body.appendChild(f); f.submit();
    },
  });
});

/* ---------- Confirmação em formulários (data-confirm) ---------- */
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !form.dataset.confirmado) {
    e.preventDefault();
    abrirModal({
      fig: form.dataset.confirmFig || '/svg/vivo-chat-duvida-cinza-centro-320x320.svg',
      titulo: form.dataset.confirmTitulo || 'Confirmar ação',
      msg: form.dataset.confirm,
      simLabel: form.dataset.confirmSim || 'CONFIRMAR',
      simClasse: form.dataset.confirmClasse || 'perigo',
      onSim: () => { form.dataset.confirmado = '1'; form.submit(); },
    });
    return;
  }
  // feedback visual: spinner no botão + trava contra duplo envio
  const btn = form.querySelector('button[type=submit]');
  if (btn && !btn.classList.contains('is-loading')) {
    btn.classList.add('is-loading');
    const sp = document.createElement('span');
    sp.className = 'btn-spin';
    btn.prepend(sp);
    setTimeout(() => { btn.disabled = true; }, 0); // desabilita após o envio iniciar
  }
  // tela de carregamento (envios que podem demorar, ex.: upload de fotos)
  if (form.hasAttribute('data-loading')) mostrarCarregando(form.getAttribute('data-loading') || 'Enviando…');
});

/* ---------- Tela de carregamento (overlay) ---------- */
function mostrarCarregando(msg) {
  if (document.getElementById('carregando')) return;
  const ov = document.createElement('div');
  ov.id = 'carregando';
  ov.className = 'carregando';
  ov.innerHTML = '<div class="carregando-box"><div class="spinner"></div><p>' + (msg || 'Enviando…') + '</p></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('on'));
}

/* ---------- TA badge: clique para copiar para a área de transferência ---------- */
document.addEventListener('click', (e) => {
  const badge = e.target.closest('.ta-badge[data-ta]');
  if (!badge) return;
  e.preventDefault();
  e.stopPropagation();
  const ta  = badge.getAttribute('data-ta');
  const num = badge.querySelector('.ta-num');

  function feedback() {
    badge.classList.add('copiado');
    if (num) num.textContent = 'Copiado ✓';
    setTimeout(() => { badge.classList.remove('copiado'); if (num) num.textContent = ta; }, 1800);
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(ta).then(feedback).catch(feedback);
  } else {
    const tf = document.createElement('textarea');
    tf.value = ta; tf.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(tf); tf.select(); document.execCommand('copy');
    document.body.removeChild(tf);
    feedback();
  }
});

/* ---------- Tooltips / dicas (dica-bubble) ---------- */
(function () {
  let tip = null;
  let hideTimer = null;

  function ensureTip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'dica-bubble';
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }

  function posTip(el) {
    const t = ensureTip();
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const maxW = 200;
    const margin = 10;

    // Centraliza no elemento mas clampa para não sair da viewport (evita scroll horizontal)
    let cx = r.left + r.width / 2;
    cx = Math.max(maxW / 2 + margin, Math.min(vw - maxW / 2 - margin, cx));
    t.style.left = Math.round(cx) + 'px';
    t.style.transform = 'translateX(-50%)';

    if (r.top > 70) {
      t.style.top = '';
      t.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    } else {
      t.style.bottom = '';
      t.style.top = (r.bottom + 8) + 'px';
    }
  }

  function show(el) {
    clearTimeout(hideTimer);
    const text = el.getAttribute('data-dica');
    if (!text) return;
    const t = ensureTip();
    t.textContent = text;
    t.hidden = false;
    posTip(el);
    requestAnimationFrame(() => t.classList.add('on'));
  }

  function hide() {
    if (!tip) return;
    tip.classList.remove('on');
    hideTimer = setTimeout(() => { if (tip) tip.hidden = true; }, 160);
  }

  document.addEventListener('mouseenter', (e) => {
    if (!(e.target instanceof Element)) return;
    const el = e.target.closest('[data-dica]');
    if (el) show(el);
  }, true);

  document.addEventListener('mouseleave', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-dica]')) hide();
  }, true);

  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest('[data-dica]');
    if (!el) return;
    show(el);
    setTimeout(hide, 2200);
  }, { passive: true });

  document.addEventListener('click', () => hide());
  document.addEventListener('scroll', () => hide(), { passive: true });
})();

/* ---------- Status tags: enriquecer com dicas explicativas ---------- */
(function () {
  const dicas = {
    'PENDENTE': 'Nenhum supervisor assumiu ainda — disponível na fila',
    'VISTORIA SUPERVISOR': 'Supervisor atribuído — vistoria em andamento',
    'AGUARDANDO CORRECAO': 'Vistoria concluída — analista deve enviar a correção',
    'CORRECAO ENVIADA': 'Correção registrada e enviada — ocorrência encerrada',
    'CANCELADA': 'Ocorrência cancelada — não será processada',
  };
  document.querySelectorAll('.tag').forEach(function (tag) {
    const txt = tag.textContent.trim().toUpperCase();
    if (dicas[txt] && !tag.hasAttribute('data-dica')) {
      tag.setAttribute('data-dica', dicas[txt]);
      tag.style.cursor = 'default';
    }
  });
})();

/* ---------- Cards: animação escalonada na entrada ---------- */
(function () {
  const cards = document.querySelectorAll('.cards .card');
  cards.forEach(function (card, i) {
    card.style.animationDelay = Math.min(i * 45, 380) + 'ms';
  });
})();

/* ---------- Flash: auto-dismiss após 7s ---------- */
(function () {
  document.querySelectorAll('.flash').forEach(function (el) {
    setTimeout(function () {
      el.classList.add('saindo');
      setTimeout(function () { el.remove(); }, 320);
    }, 7000);
  });
})();

/* ---------- Filtro de texto ao vivo na fila de ocorrências ---------- */
(function () {
  const input = document.getElementById('fila-busca-input');
  if (!input) return;
  const container = document.getElementById('fila-cards');
  if (!container) return;
  const cards = [...container.querySelectorAll('.card')];

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    cards.forEach(c => { c.hidden = q ? !c.textContent.toLowerCase().includes(q) : false; });
  });
})();

/* ---------- Toggle de linhas editáveis (admin) ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (!t) return;
  const alvo = document.querySelector(t.getAttribute('data-toggle'));
  if (alvo) alvo.hidden = !alvo.hidden;
});

/* ---------- PWA: service worker, instalação e bloqueio de zoom ---------- */
(function () {
  // 1) Service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // 2) Bloqueio de zoom no iOS (ignora user-scalable=no; reforçamos via JS)
  document.addEventListener('gesturestart',  (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend',    (e) => e.preventDefault());

  // 3) Banner de instalação
  const KEY = 'pwa_dismiss';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const get = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const set = () => { try { localStorage.setItem(KEY, '1'); } catch (_) {} };
  if (standalone || get()) return;

  function montar(corpoHTML, onInstall) {
    if (document.getElementById('pwa-banner')) return;
    const el = document.createElement('div');
    el.id = 'pwa-banner';
    el.className = 'pwa-banner';
    el.innerHTML =
      '<img src="/icons/icon-192.png" alt="" class="pwa-ic">' +
      '<div class="pwa-tx">' + corpoHTML + '</div>' +
      (onInstall ? '<button class="btn rosa sm" data-pwa-install type="button">Instalar</button>' : '') +
      '<button class="pwa-x" data-pwa-close aria-label="Fechar" type="button">✕</button>';
    document.body.appendChild(el);
    el.querySelector('[data-pwa-close]').addEventListener('click', () => { el.remove(); set(); });
    if (onInstall) el.querySelector('[data-pwa-install]').addEventListener('click', () => onInstall(el));
    requestAnimationFrame(() => el.classList.add('on'));
  }

  // Android / Chrome / Edge
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); prompt = e;
    montar('<b>Instalar o app</b><span>Adicione à tela inicial para acesso rápido.</span>',
      async (el) => { el.remove(); set(); if (prompt) { prompt.prompt(); await prompt.userChoice; prompt = null; } });
  });
  window.addEventListener('appinstalled', () => { set(); const b = document.getElementById('pwa-banner'); if (b) b.remove(); });

  // iOS (não dispara beforeinstallprompt → instruímos pelo Safari)
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
  if (isIOS) {
    setTimeout(() => {
      if (isSafari) montar('<b>Instale no seu iPhone</b><span>Toque em Compartilhar e depois “Adicionar à Tela de Início”.</span>', null);
      else montar('<b>Abra no Safari para instalar</b><span>No iPhone, abra este site no Safari e adicione à tela inicial.</span>', null);
    }, 1600);
  }
})();
