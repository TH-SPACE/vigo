-- ═══════════════════════════════════════════════════════════════════
--  Módulo REPORTS REGIONAL
--  Pipeline próprio, isolado do VIGO e do módulo de empresas: tabela e
--  configs separadas. Enquanto "Reports por Empresa" cobre só as 4
--  empresas de Goiânia, este módulo é REGIONAL: gatilho por afetação alta
--  (>= 70, corte configurável), de QUALQUER empresa, avisado em UM único
--  grupo de WhatsApp (cadastrado na página /regional do reportb2b, target
--  `regional`). Idempotente — pode rodar em banco já existente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS report_regional (
  id_ocorrencia      BIGINT UNSIGNED PRIMARY KEY,
  municipio          VARCHAR(120),
  bairro             VARCHAR(120),
  cluster            VARCHAR(60),
  empresa            VARCHAR(60),
  armario            VARCHAR(60),
  causa              VARCHAR(120),
  status             VARCHAR(40),
  data_ocorrencia    DATETIME     DEFAULT NULL,
  data_previsao      DATETIME     DEFAULT NULL,
  data_encerramento  DATETIME     DEFAULT NULL,
  ta                 VARCHAR(40),
  uf                 VARCHAR(4),
  logradouro         VARCHAR(255),
  numero_logradouro  VARCHAR(20),
  sub_status         VARCHAR(80),
  sub_causa          VARCHAR(80),
  afetacao           INT          DEFAULT 0,

  -- ── Controle de notificação (NÃO vem do TXT) ──
  -- Carimbos de "já avisei sobre isto", para nunca repetir o mesmo aviso.
  notificado_aberto_em   DATETIME DEFAULT NULL,
  notificado_fechado_em  DATETIME DEFAULT NULL,
  -- Último report da escalada (>12h / >24h) enviado para esta ocorrência.
  ultimo_report_em       DATETIME DEFAULT NULL,

  importada_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizada_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_reg_status       (status),
  INDEX idx_reg_data         (data_ocorrencia),
  INDEX idx_reg_afetacao     (afetacao),
  INDEX idx_reg_notif_aberto (notificado_aberto_em),
  INDEX idx_reg_escalada     (status, ultimo_report_em)
);

-- ── Configurações do módulo (namespace repreg_*) ──
-- Chaves separadas das do VIGO e das do módulo de empresas (rep_*): mexer aqui
-- não altera nenhuma das outras importações.
INSERT IGNORE INTO config (chave, valor) VALUES
  ('repreg_ativo','0'),
  ('repreg_import_url','https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OCORRENCIA.TXT&caminho=TELEFONICA/2026/'),
  ('repreg_intervalo_minimo','10'),
  ('repreg_intervalo_maximo','20'),

  -- Filtros de entrada (vazio = sem restrição). A afetação mínima é o gatilho
  -- principal do módulo: só entra (e só vira mensagem) o que tiver afetação >= corte.
  -- `repreg_status_permitidos` manda em duas coisas de uma vez: o que sobe para a
  -- base E quais status geram mensagem (só ABERTO e FECHADO geram; vazio = os dois).
  ('repreg_empresas',''),                -- vazio = todas as empresas
  ('repreg_clusters_permitidos',''),
  ('repreg_status_permitidos',''),
  ('repreg_afetacao_minima','70'),

  -- Notificação por ocorrência (1 mensagem por ocorrência, ao entrar)
  ('repreg_notificacao_ativa','1'),
  ('repreg_data_minima',''),             -- só notifica ocorrências a partir desta data

  -- Escalada de ocorrências em aberto (cada faixa liga/desliga sozinha)
  ('repreg_escalada_ativa','1'),
  ('repreg_escalada_faixa1_ativa','1'),
  ('repreg_escalada_faixa1_horas','12'),
  ('repreg_escalada_faixa1_intervalo','2'),
  ('repreg_escalada_faixa2_ativa','1'),
  ('repreg_escalada_faixa2_horas','24'),
  ('repreg_escalada_faixa2_intervalo','1'),
  ('repreg_escalada_dias','0,1,2,3,4,5,6'),   -- cobra o dia inteiro nos dias marcados

  -- A primeira importação só popula a tabela (sem disparar uma enxurrada).
  -- Depois que este flag vira 1, os avisos passam a sair em tempo real.
  ('repreg_backfill_feito','0'),
  ('repreg_ultima_importacao',''),
  ('repreg_ultima_importacao_resultado',''),

  -- Limpeza: quem já fechou (saiu de ABERTO) não serve mais pra nada aqui.
  -- Só espera o carimbo de aviso (notificado_fechado_em) para status
  -- literalmente 'FECHADO' — ver nota em models/ReportRegional.js#limparFechadas.
  -- Roda a cada N dias (repreg_limpeza_ultima_em guarda a última execução).
  ('repreg_limpeza_ativa','1'),
  ('repreg_limpeza_dias','7'),
  ('repreg_limpeza_ultima_em','');
