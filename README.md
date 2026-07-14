# Sistema de Vistoria de Ocorrências

Sistema web **Mobile First + Desktop** para gestão de vistorias e correções de ocorrências
importadas automaticamente da base `TBL_OCORRENCIA.TXT`.

Stack: **Node.js + Express + EJS + MariaDB**, autenticação **JWT** (cookie httpOnly),
upload com **Multer + Sharp** (compressão automática para WebP).

## Como rodar

```bash
npm install
node database/setup.js     # cria tabelas + usuário admin
npm start                  # produção  (ou: npm run dev)
```

App em `http://localhost:3392` (porta configurável no `.env`).

### Credenciais iniciais (admin)

| campo | valor |
|-------|-------|
| e-mail | `admin@telefonica.com` |


Troca de senha é **obrigatória no 1º login**. A senha inicial de qualquer usuário é
sempre os **4 últimos dígitos da matrícula**.

## Importação da base

- O `scheduler` baixa o TXT e atualiza o banco em **intervalos aleatórios** entre
  `intervalo_minimo` e `intervalo_maximo` minutos (10–25 por padrão), tudo configurável
  no Painel Admin → Importação.
- Critérios de importação configuráveis: afetação mínima, empresas, clusters e status.
  Padrão do spec: `AFETACAO > 300`, `STATUS = ABERTO/FECHADO`, `EMPRESA = ABILITY`, `CLUSTER = GOIANIA`.
- A tabela `ocorrencias` espelha **as 43 colunas** do arquivo TXT.
- Ocorrência nova → `STATUS_TRATATIVA = PENDENTE`. Ocorrência existente → atualiza só os
  campos do TXT, **preservando** histórico/vistorias/tratativas/correções e **sem
  sobrescrever** `STATUS_TRATATIVA`.

### Importação manual / teste local

```bash
# Usa a URL configurada (precisa de internet):
npm run import

# Ou aponta para um arquivo local (defina no .env):
IMPORT_ARQUIVO_LOCAL=/caminho/TBL_OCORRENCIA.TXT npm run import
```

## Fluxo da ocorrência

```
PENDENTE
  └─ vistoriador assume ──► VISTORIA SUPERVISOR
                                └─ vistoria salva ──► AGUARDANDO CORRECAO
                                                          └─ analista envia correção ──► CORRECAO ENVIADA
```

Admin/GM podem **cancelar** de qualquer status antes do encerramento.

## Perfis e acessos

Há quatro perfis. Todos os usuários logados acessam o **Painel Operacional** (`/painel`),
a **fila de ocorrências** (`/dashboard`) e os **detalhes** de qualquer ocorrência
(`/ocorrencias/:id`). As diferenças estão nas ações disponíveis.

---

### admin

Acesso irrestrito. É o único perfil capaz de **excluir** dados permanentemente.

| Área | O que pode fazer |
|------|-----------------|
| Painel / Fila | Tudo, sem filtro de status |
| Ocorrências | Assumir, devolver, preencher vistoria, registrar tratativa, preencher correção |
| Admin → Ocorrências | Encerrar (Correção Enviada), cancelar, resetar vistoria e **excluir** ocorrências |
| Admin → Usuários | Criar (individual ou planilha), editar, ativar/desativar, resetar senha |
| Admin → Causas | Criar, editar e **excluir** |
| Admin → Checklist | Criar, editar e **excluir** perguntas |
| Admin → Config | Alterar parâmetros de importação, disparar importação manual |
| Admin → Auditoria | Visualizar log, alterar retenção, limpar registros antigos |
| Admin → Base | Limpar ocorrências encerradas ou toda a base |

---

### gm (Grand Master)

Visão gerencial completa. Acessa toda a área `/admin` **exceto** as ações de exclusão
permanente (causas, checklist, ocorrências). Não opera vistorias nem correções.

| Área | O que pode fazer |
|------|-----------------|
| Painel / Fila | Tudo, sem filtro de status |
| Ocorrências | Visualizar detalhes, registrar tratativa |
| Admin → Ocorrências | Encerrar (Correção Enviada), cancelar, resetar vistoria (**não** excluir) |
| Admin → Usuários | Criar, editar, ativar/desativar, resetar senha |
| Admin → Causas | Criar, editar (**não** excluir) |
| Admin → Checklist | Criar, editar (**não** excluir perguntas) |
| Admin → Config | Alterar parâmetros de importação, disparar importação manual |
| Admin → Auditoria | Visualizar log, alterar retenção, limpar registros antigos |
| Admin → Base | Limpar ocorrências encerradas ou toda a base |

---

### vistoriador

Atua na linha de frente. Vê na fila as ocorrências `PENDENTE` (disponíveis para assumir)
e as suas próprias em `AGUARDANDO CORRECAO` (para editar a vistoria se necessário).

| Área | O que pode fazer |
|------|-----------------|
| Painel | Visualizar KPIs |
| Fila | Ocorrências `PENDENTE` + suas próprias `AGUARDANDO CORRECAO` |
| Ocorrências | Visualizar detalhes, **assumir**, **devolver** para fila, preencher **vistoria** (3 fotos), **editar vistoria** enquanto aguarda o analista |
| Admin | Sem acesso |

---

### analista

Recebe as ocorrências após a vistoria e registra a correção técnica.

| Área | O que pode fazer |
|------|-----------------|
| Painel | Visualizar KPIs |
| Fila | Apenas ocorrências `AGUARDANDO CORRECAO` |
| Ocorrências | Visualizar detalhes, registrar **tratativa**, preencher **correção** (até 3 fotos) |
| Admin | Sem acesso |

---

## Estrutura

```
database/   schema.sql (43 colunas) · setup.js · connection.js
models/     Ocorrencia · Usuario · Vistoria · Correcao · Tratativa · Causa · Checklist · Foto · Historico · Config
services/   importador.js · scheduler.js
controllers/ auth · dashboard · ocorrencias · admin
routes/     auth · dashboard · painel · ocorrencias · admin
views/      EJS responsivas (mobile bottom-nav + desktop topbar)
public/     css/app.css · js/app.js · js/painel.js · svg/ (pack Vivo)
uploads/    fotos comprimidas (vistorias/correcoes/{ANO}/{MES})
```
