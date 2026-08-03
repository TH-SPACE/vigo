-- ═══════════════════════════════════════════════════════════════════
--  Módulo REPORTS DE ATRASO
--  Pipeline próprio, isolado do VIGO e dos módulos de empresa/regional:
--  cobra no WhatsApp ocorrência ABERTA há muito tempo, de empresas
--  específicas (ONDACOM, ABILITY), SEM filtro de cluster — ao contrário
--  do módulo de empresas, que hoje só cobre GOIANIA.
--  Só existe o gatilho de ESCALADA: não há aviso de entrada nem de
--  fechamento (isso já é coberto pelo módulo de Reports por Empresa).
--  Idempotente — pode rodar em banco já existente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS report_atraso (
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
  -- Último report da escalada enviado para esta ocorrência. É o único carimbo
  -- do módulo: não há aviso de entrada/fechamento aqui, só cobrança de atraso.
  ultimo_report_em   DATETIME DEFAULT NULL,

  importada_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizada_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_atr_empresa      (empresa),
  INDEX idx_atr_status       (status),
  INDEX idx_atr_data         (data_ocorrencia),
  INDEX idx_atr_escalada     (status, empresa, ultimo_report_em)
);

-- ── Configurações do módulo (namespace repat_*) ──
-- Chaves separadas das do VIGO e dos outros módulos de report.
INSERT IGNORE INTO config (chave, valor) VALUES
  ('repat_ativo','0'),
  ('repat_import_url','https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OCORRENCIA.TXT&caminho=TELEFONICA/2026/'),
  ('repat_intervalo_minimo','10'),
  ('repat_intervalo_maximo','20'),

  -- Filtros de entrada. `repat_clusters_permitidos` vazio = TODOS os clusters —
  -- é essa a diferença deste módulo para o de Reports por Empresa (que hoje
  -- está preso a GOIANIA para as 4 empresas de uma vez).
  ('repat_empresas','ONDACOM,ABILITY'),
  ('repat_clusters_permitidos',''),
  ('repat_data_minima',''),

  -- Escalada de ocorrências em aberto (cada faixa liga/desliga sozinha).
  -- Padrão pedido: parada há mais de 12h, cobra a cada 2h. 2ª faixa desligada.
  ('repat_escalada_ativa','1'),
  ('repat_escalada_faixa1_ativa','1'),
  ('repat_escalada_faixa1_horas','12'),
  ('repat_escalada_faixa1_intervalo','2'),
  ('repat_escalada_faixa2_ativa','0'),
  ('repat_escalada_faixa2_horas','24'),
  ('repat_escalada_faixa2_intervalo','1'),
  ('repat_escalada_dias','0,1,2,3,4,5,6'),   -- cobra o dia inteiro nos dias marcados

  -- Liga/desliga por empresa (o grupo de cada uma é cadastrado no bridge)
  ('repat_empresa_ability_ativo','1'),
  ('repat_empresa_ondacom_ativo','1'),

  -- A primeira importação só popula a tabela com o relógio da escalada já
  -- zerado (sem disparar cobrança para tudo que já estava velho). Depois que
  -- este flag vira 1, a escalada passa a cobrar normalmente.
  ('repat_backfill_feito','0'),
  ('repat_ultima_importacao',''),
  ('repat_ultima_importacao_resultado',''),

  -- Limpeza: quem já fechou (saiu de ABERTO) não serve mais pra nada aqui —
  -- este módulo só cobra atraso de quem está ABERTO. Roda a cada N dias
  -- (repat_limpeza_ultima_em guarda a última execução).
  ('repat_limpeza_ativa','1'),
  ('repat_limpeza_dias','7'),
  ('repat_limpeza_ultima_em','');
