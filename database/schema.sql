-- ============================================================
--  VISTORIA DE OCORRÊNCIAS – Schema MariaDB
-- ============================================================

CREATE DATABASE IF NOT EXISTS vistoria_ocorrencias
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vistoria_ocorrencias;

-- ─── Perfis de acesso ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS perfis (
  id   TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(20) NOT NULL UNIQUE
);
-- 1 admin · 2 gm (Grand Master) · 3 vistoriador · 4 analista
INSERT IGNORE INTO perfis (id, nome) VALUES
  (1,'admin'),(2,'gm'),(3,'vistoriador'),(4,'analista');

-- ─── Usuários ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome                  VARCHAR(120)  NOT NULL,
  email                 VARCHAR(120)  NOT NULL UNIQUE,
  matricula             VARCHAR(30)   DEFAULT NULL,
  cluster               VARCHAR(60)   NOT NULL DEFAULT 'GOIANIA',
  perfil_id             TINYINT UNSIGNED NOT NULL DEFAULT 3,
  senha_hash            VARCHAR(255)  NOT NULL,
  status                ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  primeiro_login        TINYINT(1)    NOT NULL DEFAULT 1,
  senha_alterada_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso         DATETIME      DEFAULT NULL,
  criado_em             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (perfil_id) REFERENCES perfis(id),
  INDEX idx_status    (status),
  INDEX idx_matricula (matricula),
  INDEX idx_perfil    (perfil_id)
);

-- ─── Histórico de senhas (evita reutilização) ──────────────
CREATE TABLE IF NOT EXISTS historico_senhas (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  criado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_usuario (usuario_id)
);

-- ─── Ocorrências (espelha TODAS as 43 colunas do TXT) ──────
--  Colunas do arquivo TBL_OCORRENCIA.TXT (delimitador "|"):
--  ID_OCORRENCIA|MUNICIPIO|BAIRRO|CLUSTER|EMPRESA|ARMARIO|CAUSA|STATUS|
--  FLUXO|DISTRIBUICAO_INICIAL|DISTRIBUICAO_FINAL|DATA_OCORRENCIA|
--  DATA_PREVISAO|DATA_ENCERRAMENTO|IONIX|SAS|TA|CONTRATO|REDE|UF|
--  DATA_IONIX|ID_EMPRESA|LOGRADOURO|NUMERO_LOGRADOURO|AREA_SOLICITANTE|
--  REGIONAL|ORDEM_DE_REDE|TRANSBORDO|ANO|TIPO_SERVICO|
--  CODIGO_BLOQUEIO_TRAFEGO|DATA_CODIGO_BLOQUEIO_TRAFEGO|
--  USUARIO_CODIGO_BLOQUEIO_TRAFEGO|ODS|DATA_ODS|USUARIO_ODS|FIBRASIL|
--  SUB_STATUS|SUB_CAUSA|AFETACAO|ID_SUSPEITA|HUNTER|INFLUENCIADOR
CREATE TABLE IF NOT EXISTS ocorrencias (
  id_ocorrencia                    BIGINT UNSIGNED PRIMARY KEY,
  municipio                        VARCHAR(120),
  bairro                           VARCHAR(120),
  cluster                          VARCHAR(60),
  empresa                          VARCHAR(60),
  armario                          VARCHAR(60),
  causa                            VARCHAR(120),
  status                           VARCHAR(40),
  fluxo                            VARCHAR(60),
  distribuicao_inicial             VARCHAR(20),
  distribuicao_final               VARCHAR(20),
  data_ocorrencia                  DATETIME      DEFAULT NULL,
  data_previsao                    DATETIME      DEFAULT NULL,
  data_encerramento                DATETIME      DEFAULT NULL,
  ionix                            VARCHAR(20),
  sas                              VARCHAR(40),
  ta                               VARCHAR(40),
  contrato                         VARCHAR(60),
  rede                             VARCHAR(40),
  uf                               VARCHAR(4),
  data_ionix                       DATETIME      DEFAULT NULL,
  id_empresa                       VARCHAR(10),
  logradouro                       VARCHAR(255),
  numero_logradouro                VARCHAR(20),
  area_solicitante                 VARCHAR(40),
  regional                         VARCHAR(60),
  ordem_de_rede                    VARCHAR(40),
  transbordo                       VARCHAR(40),
  ano                              VARCHAR(6),
  tipo_servico                     VARCHAR(80),
  codigo_bloqueio_trafego          VARCHAR(40),
  data_codigo_bloqueio_trafego     DATETIME      DEFAULT NULL,
  usuario_codigo_bloqueio_trafego  VARCHAR(80),
  ods                              VARCHAR(40),
  data_ods                         DATETIME      DEFAULT NULL,
  usuario_ods                      VARCHAR(80),
  fibrasil                         VARCHAR(40),
  sub_status                       VARCHAR(80),
  sub_causa                        VARCHAR(80),
  afetacao                         INT           DEFAULT 0,
  id_suspeita                      VARCHAR(20),
  hunter                           VARCHAR(20),
  influenciador                    VARCHAR(20),

  -- ── Controle de fluxo operacional (NÃO vem do TXT) ──
  status_tratativa  ENUM('PENDENTE','VISTORIA SUPERVISOR','AGUARDANDO CORRECAO',
                         'CORRECAO ENVIADA','CANCELADA')
                    NOT NULL DEFAULT 'PENDENTE',
  vistoriador_id    INT UNSIGNED  DEFAULT NULL,
  assumida_em       DATETIME      DEFAULT NULL,
  analista_id       INT UNSIGNED  DEFAULT NULL,
  importada_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizada_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (vistoriador_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (analista_id)    REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_status_tratativa (status_tratativa),
  INDEX idx_cluster          (cluster),
  INDEX idx_empresa          (empresa),
  INDEX idx_status           (status),
  INDEX idx_afetacao         (afetacao),
  INDEX idx_ta               (ta),
  INDEX idx_data_ocorrencia  (data_ocorrencia)
);

-- ─── Causas (dropdown da vistoria, configurável) ───────────
CREATE TABLE IF NOT EXISTS causas (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome      VARCHAR(120) NOT NULL UNIQUE,
  ativo     TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO causas (nome) VALUES
  ('Ataque De Animais'),
  ('Carga Alta'),
  ('Descarga Elétrica'),
  ('Desgaste Material'),
  ('Encontrado Ok'),
  ('Falha De Mão De Obra Anterior'),
  ('Fibra/Splitter Invertida'),
  ('Furto'),
  ('Obra De Terceiros'),
  ('Poda De Arvore'),
  ('Queda De Arvore'),
  ('Queimada'),
  ('Troca De Poste Concessionária'),
  ('Vandalismo');

-- ─── Checklist (perguntas configuráveis) ───────────────────
CREATE TABLE IF NOT EXISTS checklist_perguntas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pergunta    VARCHAR(255) NOT NULL,
  ativo       TINYINT(1)   NOT NULL DEFAULT 1,
  obrigatoria TINYINT(1)   NOT NULL DEFAULT 0,
  ordem       INT          NOT NULL DEFAULT 0,
  criado_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO checklist_perguntas (id, pergunta, ordem) VALUES
  (1,'Alteração de rota aérea?',1),
  (2,'Rebaixamento de cabo em tubulação Vivo?',2),
  (3,'Rebaixamento de cabo em tubulação Vtal?',3),
  (4,'Alteamento da rede?',4);

-- ─── Vistorias (formulário do vistoriador) ─────────────────
CREATE TABLE IF NOT EXISTS vistorias (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ocorrencia_id        BIGINT UNSIGNED NOT NULL,
  vistoriador_id       INT UNSIGNED NOT NULL,
  causa_id             INT UNSIGNED DEFAULT NULL,
  sugestao_correcao    TEXT NOT NULL,
  correcao_definitiva  ENUM('SIM','NAO') NOT NULL DEFAULT 'NAO',
  criado_em            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ocorrencia_id)  REFERENCES ocorrencias(id_ocorrencia) ON DELETE CASCADE,
  FOREIGN KEY (vistoriador_id) REFERENCES usuarios(id),
  FOREIGN KEY (causa_id)       REFERENCES causas(id),
  INDEX idx_ocorrencia (ocorrencia_id)
);

-- ─── Correções (formulário do analista) ────────────────────
CREATE TABLE IF NOT EXISTS correcoes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ocorrencia_id BIGINT UNSIGNED NOT NULL,
  analista_id   INT UNSIGNED NOT NULL,
  observacao    TEXT,
  criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id_ocorrencia) ON DELETE CASCADE,
  FOREIGN KEY (analista_id)   REFERENCES usuarios(id),
  INDEX idx_ocorrencia (ocorrencia_id)
);

-- ─── Respostas de checklist (vistoria OU correção) ─────────
CREATE TABLE IF NOT EXISTS checklist_respostas (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  origem       ENUM('vistoria','correcao') NOT NULL,
  origem_id    INT UNSIGNED NOT NULL,
  pergunta_id  INT UNSIGNED NOT NULL,
  resposta     ENUM('SIM','NAO') NOT NULL,
  observacao   VARCHAR(255) DEFAULT NULL,
  FOREIGN KEY (pergunta_id) REFERENCES checklist_perguntas(id),
  INDEX idx_origem (origem, origem_id)
);

-- ─── Fotos (vistoria OU correção) ──────────────────────────
CREATE TABLE IF NOT EXISTS fotos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  origem     ENUM('vistoria','correcao') NOT NULL,
  origem_id  INT UNSIGNED NOT NULL,
  rotulo     VARCHAR(60) NOT NULL,
  arquivo    VARCHAR(255) NOT NULL,
  criado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_origem (origem, origem_id)
);

-- ─── Tratativas (analista – não altera status) ─────────────
CREATE TABLE IF NOT EXISTS tratativas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ocorrencia_id BIGINT UNSIGNED NOT NULL,
  usuario_id    INT UNSIGNED NOT NULL,
  observacao    TEXT NOT NULL,
  criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id_ocorrencia) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id)    REFERENCES usuarios(id),
  INDEX idx_ocorrencia (ocorrencia_id)
);

-- ─── Histórico completo da ocorrência ──────────────────────
CREATE TABLE IF NOT EXISTS historico (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ocorrencia_id   BIGINT UNSIGNED NOT NULL,
  usuario_id      INT UNSIGNED DEFAULT NULL,
  usuario_nome    VARCHAR(120),
  perfil          VARCHAR(20),
  acao            VARCHAR(60) NOT NULL,
  status_anterior VARCHAR(40),
  status_novo     VARCHAR(40),
  observacao      TEXT,
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ocorrencia_id) REFERENCES ocorrencias(id_ocorrencia) ON DELETE CASCADE,
  INDEX idx_ocorrencia (ocorrencia_id),
  INDEX idx_criado_em  (criado_em)
);

-- ─── Configurações (chave/valor) ───────────────────────────
CREATE TABLE IF NOT EXISTS config (
  chave     VARCHAR(60) PRIMARY KEY,
  valor     TEXT,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO config (chave, valor) VALUES
  ('import_url','https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OCORRENCIA.TXT&caminho=TELEFONICA/2026/'),
  ('intervalo_minimo','10'),
  ('intervalo_maximo','25'),
  ('afetacao_minima','300'),
  ('empresas_permitidas','ABILITY'),
  ('clusters_permitidos','GOIANIA'),
  ('status_permitidos','ABERTO,FECHADO'),
  ('import_ativo','1'),
  ('ultima_importacao',''),
  ('ultima_importacao_resultado',''),
  ('auditoria_retencao_dias','15'),
  ('autocadastro_ativo','1'),
  ('import_observacoes_url','https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OBSERVACAO.TXT&caminho=TELEFONICA/2026/'),
  ('import_observacoes_ativo','1'),
  ('ultima_importacao_observacoes',''),
  ('ultima_importacao_observacoes_resultado',''),
  ('whatsapp_report_abertos_ativo','0'),
  ('whatsapp_report_abertos_intervalo','60'),
  ('whatsapp_report_abertos_ultimo_envio','');

-- ─── Observações importadas (TBL_OBSERVACAO.TXT) ──────────
CREATE TABLE IF NOT EXISTS observacoes_ocorrencia (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_ocorrencia    BIGINT UNSIGNED NOT NULL,
  observacao       TEXT,
  usuario          VARCHAR(120),
  data_observacao  DATETIME,
  FOREIGN KEY (id_ocorrencia) REFERENCES ocorrencias(id_ocorrencia) ON DELETE CASCADE,
  INDEX idx_id_ocorrencia   (id_ocorrencia),
  INDEX idx_data_observacao (data_observacao)
);

-- ─── Auditoria geral (ações administrativas) ───────────────
CREATE TABLE IF NOT EXISTS auditoria (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id     INT UNSIGNED,
  usuario_email  VARCHAR(120),
  acao           VARCHAR(60) NOT NULL,
  detalhe        TEXT,
  ip             VARCHAR(45),
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_criado_em (criado_em)
);
