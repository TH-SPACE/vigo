'use strict';

// Bus de eventos para Server-Sent Events.
// O importador emite 'importacao' quando novas ocorrências chegam;
// a rota /api/notificacoes/stream repassa para todos os clientes conectados.
const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(500);
module.exports = bus;
