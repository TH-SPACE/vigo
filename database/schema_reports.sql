-- ═══════════════════════════════════════════════════════════════════
--  Módulo REPORTS POR EMPRESA
--  Pipeline próprio, isolado do VIGO: tabela e configs separadas.
--  O VIGO continua importando só ABILITY/GOIANIA/afetação>300 para
--  `ocorrencias`; este módulo sobe as 4 empresas inteiras para
--  `report_ocorrencias` e notifica um grupo de WhatsApp por empresa.
--  Idempotente — pode rodar em banco já existente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS report_ocorrencias (
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

  INDEX idx_rep_empresa      (empresa),
  INDEX idx_rep_status       (status),
  INDEX idx_rep_data         (data_ocorrencia),
  INDEX idx_rep_notif_aberto (notificado_aberto_em),
  INDEX idx_rep_escalada     (status, empresa, ultimo_report_em)
);

-- ── Configurações do módulo (namespace rep_*) ──
-- Chaves separadas das do VIGO: mexer aqui não altera a importação principal.
INSERT IGNORE INTO config (chave, valor) VALUES
  ('rep_ativo','0'),
  ('rep_import_url','https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OCORRENCIA.TXT&caminho=TELEFONICA/2026/'),
  ('rep_intervalo_minimo','10'),
  ('rep_intervalo_maximo','20'),

  -- Filtros de entrada (vazio = sem restrição).
  -- `rep_status_permitidos` manda em duas coisas de uma vez: o que sobe para a
  -- base E quais status geram mensagem (só ABERTO e FECHADO geram; vazio = os dois).
  ('rep_empresas','ABILITY,ONDACOM,TELEMONT,TEL'),
  ('rep_clusters_permitidos',''),
  ('rep_status_permitidos',''),
  ('rep_afetacao_minima','0'),

  -- Notificação por ocorrência (1 mensagem por ocorrência, ao entrar)
  ('rep_notificacao_ativa','1'),
  ('rep_data_minima',''),             -- só notifica ocorrências a partir desta data

  -- Escalada de ocorrências em aberto (cada faixa liga/desliga sozinha)
  ('rep_escalada_ativa','1'),
  ('rep_escalada_faixa1_ativa','1'),
  ('rep_escalada_faixa1_horas','12'),
  ('rep_escalada_faixa1_intervalo','2'),
  ('rep_escalada_faixa2_ativa','1'),
  ('rep_escalada_faixa2_horas','24'),
  ('rep_escalada_faixa2_intervalo','1'),
  ('rep_escalada_dias','0,1,2,3,4,5,6'),   -- cobra o dia inteiro nos dias marcados

  -- Liga/desliga por empresa (o grupo de cada uma é cadastrado no bridge)
  ('rep_empresa_ability_ativo','1'),
  ('rep_empresa_ondacom_ativo','1'),
  ('rep_empresa_telemont_ativo','1'),
  ('rep_empresa_tel_ativo','1'),

  -- A primeira importação só popula a tabela (sem disparar 37 mil mensagens).
  -- Depois que este flag vira 1, os avisos passam a sair em tempo real.
  ('rep_backfill_feito','0'),
  ('rep_ultima_importacao',''),
  ('rep_ultima_importacao_resultado','');
