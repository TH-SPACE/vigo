# Sistema de Vistorias de Ocorrências
 
## Objetivo
 
Desenvolver um sistema web Mobile First para gestão de vistorias e correções de ocorrências importadas automaticamente de uma base TXT.
 
O sistema deve permitir:
 
- Importação automática de ocorrências.
- Controle de fluxo operacional.
- Vistoria em campo.
- Registro de tratativas.
- Envio de evidências fotográficas.
- Controle de usuários e permissões.
- Administração completa através de painel administrativo.
 
---
 
# Stack Tecnológica
 
## Backend
 
- Node.js
- Express.js
- JWT Authentication
- Multer (Upload de Arquivos)
- Sharp (Compressão de Imagens)
- Node Cron ou Scheduler próprio
 
## Frontend
 
- HTML5
- CSS3
- JavaScript Vanilla
- EJS
 
## Banco de Dados
 
- MariaDB / MySQL
 
## Infraestrutura
 
- Ubuntu Server
- PM2
- Nginx (Reverse Proxy)
- SSL HTTPS
 
## Armazenamento
 
Local no servidor Linux.
 
```txt
/uploads
/uploads/vistorias
/uploads/correcoes
/uploads/vistorias/{ANO}/{MES}
/uploads/correcoes/{ANO}/{MES}
```
 
---
 
# Importação Automática
 
## Origem da Base
 
URL:
 
```txt
https://oltm.vivo.com.br/sigma_fsp/v2/up/baixa.php?file=TBL_OCORRENCIA.TXT&caminho=TELEFONICA/2026/
```
 
O arquivo retornado é um TXT contendo ocorrências.
 
---
 
## Atualização da Base
 
A aplicação deve executar um processo automático que:
 
1. Baixa o TXT.
2. Processa os registros.
3. Atualiza o banco de dados.
 
O intervalo deve ser aleatório entre:
 
```txt
10 e 25 minutos
```
 
mas totalmente configurável pelo Painel Administrativo.
 
Configurações:
 
- intervalo_minimo
- intervalo_maximo
 
---
 
# Critérios de Importação
 
Inicialmente importar somente ocorrências com:
 
```txt
AFETACAO > 300
STATUS = ABERTO ou FECHADO
EMPRESA = ABILITY
CLUSTER = GOIANIA
```
 
Todos os critérios devem ser configuráveis através do Painel Admin.
 
---
 
# Atualização das Ocorrências
 
## Nova ocorrência
 
Quando o ID da ocorrência não existir:
 
Criar registro.
 
Status inicial:
 
```txt
STATUS_TRATATIVA = PENDENTE
```
 
---
 
## Ocorrência existente
 
Quando o ID já existir:
 
Atualizar dados recebidos do TXT.
 
Preservar:
 
- histórico
- vistorias
- tratativas
- correções
 
Não sobrescrever STATUS_TRATATIVA.
 
---
 
# Perfis de Acesso
 
## Admin
 
Permissões totais.
 
Pode:
 
- editar tudo
- excluir tudo
- criar usuários
- redefinir senha
- configurar sistema
- excluir ocorrências
- alterar parâmetros
 
---
 
## Grand Master (GM)
 
Administrador limitado.
 
Pode:
 
- consultar tudo
- editar configurações operacionais
- gerenciar usuários
 
Não pode:
 
- excluir dados críticos
- excluir registros históricos
 
---
 
## Vistoriador
 
Responsável pela vistoria operacional.
 
Pode:
 
- visualizar fila pendente
- assumir ocorrência
- preencher vistoria
- anexar evidências
 
---
 
## Analista
 
Responsável por tratativa e correção.
 
Pode:
 
- visualizar ocorrências aguardando correção
- registrar tratativas
- enviar correções
- anexar evidências
 
---
 
# Login
 
Autenticação:
 
```txt
Email + Senha
```
 
Utilizar JWT.
 
---
 
# Cadastro de Usuários
 
O Admin poderá:
 
## Cadastro Individual
 
Informar:
 
- Nome
- Email
- Matrícula
- Cluster
- Perfil
 
---
 
## Cadastro em Massa
 
Upload de planilha contendo:
 
```txt
Nome
Email
Matricula
Cluster
```
 
---
 
## Senha Inicial
 
Os 4 últimos números da matrícula.
 
Exemplo:
 
```txt
12345678
 
Senha: 5678
```
 
---
 
## Primeiro Login
 
Obrigatório trocar senha.
 
Campo:
 
```txt
primeiro_login = true
```
 
---
 
## Expiração de Senha
 
Expira a cada:
 
```txt
120 dias
```
 
Após esse período obrigar troca de senha.
 
---
 
## Recuperação de Senha
 
Não haverá recuperação automática.
 
Somente Admin pode redefinir.
 
---
 
# Fluxo da Ocorrência
 
## Status Possíveis
 
```txt
PENDENTE
VISTORIA SUPERVISOR
AGUARDANDO CORRECAO
CORRECAO ENVIADA
FINALIZADA
CANCELADA
```
 
---
 
# Tela Inicial
 
Exibir em formato Card.
 
Cada card deve mostrar:
 
- ID Ocorrência
- TA
- Empresa
- Cluster
- Afetação
- Status
- Status Tratativa
- Data Abertura
 
A informação TA deve possuir destaque visual.
 
---
 
# Fluxo do Vistoriador
 
Visualiza apenas:
 
```txt
STATUS_TRATATIVA = PENDENTE
```
 
---
 
# Assumir Ocorrência
 
Ao clicar no card:
 
Exibir modal:
 
```txt
Deseja assumir esta ordem?
```
 
Botões:
 
```txt
SIM
NÃO
```
 
---
 
## Se SIM
 
Atualizar:
 
```txt
STATUS_TRATATIVA = VISTORIA SUPERVISOR
```
 
Registrar:
 
- usuário
- data
- hora
 
Abrir formulário da vistoria.
 
---
 
## Se NÃO
 
Retornar para listagem.
 
---
 
# Formulário de Vistoria
 
Campos:
 
## Causa
 
Dropdown.
 
Tabela configurável pelo Admin.
 
---
 
## Sugestão de Correção
 
Textarea obrigatório.
 
---
 
## Correção Definitiva
 
Opções:
 
```txt
SIM
NAO
```
 
---
 
# Checklist
 
Título:
 
```txt
Soluções Possíveis para Evitar Reincidência
```
 
Perguntas:
 
```txt
Alteração de rota aérea?
Rebaixamento de cabo em tubulação Vivo?
Rebaixamento de cabo em tubulação Vtal?
Alteamento da rede?
```
 
Cada item contém:
 
- Resposta Sim/Não
- Observação Opcional
 
---
 
# Fotos Obrigatórias da Vistoria
 
1. Foto da Causa
2. Foto Panorâmica
3. Foto do Local
 
---
 
# Upload
 
Permitir:
 
- câmera
- galeria
 
Dispositivos:
 
- Android
- iPhone
 
---
 
# Finalização da Vistoria
 
Ao salvar:
 
Alterar status para:
 
```txt
AGUARDANDO CORRECAO
```
 
Registrar:
 
- usuário
- data
- hora
 
---
 
# Fluxo do Analista
 
Visualiza apenas:
 
```txt
AGUARDANDO CORRECAO
```
 
---
 
# Detalhes da Ocorrência
 
Deve exibir:
 
- Dados importados
- Dados da vistoria
- Fotos
- Checklist
- Sugestão do vistoriador
- Histórico completo
 
---
 
# Ação: Informar Tratativa
 
Botão:
 
```txt
INFORMAR TRATATIVA
```
 
Campos:
 
- Observação
 
Ao salvar:
 
Criar registro histórico.
 
Não altera status.
 
Pode incluir inúmeras tratativas.
 
---
 
# Histórico de Tratativas
 
Campos:
 
- Usuário
- Perfil
- Data
- Hora
- Observação
 
Ordenação:
 
Mais recente primeiro.
 
---
 
# Ação: Enviar Correção
 
Botão:
 
```txt
ENVIAR CORRECAO
```
 
Campos:
 
- Checklist
- Fotos
- Observação
 
---
 
# Checklist da Correção
 
Mesmo checklist da vistoria.
 
Perguntas:
 
```txt
Alteração de rota aérea?
Rebaixamento de cabo em tubulação Vivo?
Rebaixamento de cabo em tubulação Vtal?
Alteamento da rede?
```
 
Cada item:
 
- Sim/Não
- Observação
 
---
 
# Fotos Obrigatórias da Correção
 
1. Evidência 1
2. Evidência 2
3. Evidência 3
 
---
 
# Envio da Correção
 
Ao salvar:
 
```txt
STATUS_TRATATIVA = CORRECAO ENVIADA
```
 
Registrar:
 
- usuário
- data
- hora
 
---
 
# Painel Administrativo
 
## Usuários
 
- Criar
- Editar
- Inativar
- Reativar
- Resetar senha
- Alterar perfil
 
---
 
## Ocorrências
 
- Consultar
- Editar
- Cancelar
- Excluir
 
(Apenas Admin pode excluir)
 
---
 
## Configuração de Importação
 
Permitir configuração de:
 
```txt
URL
Intervalo mínimo
Intervalo máximo
Afetação mínima
Empresas permitidas
Clusters permitidos
Status permitidos
```
 
---
 
## Causas
 
CRUD completo.
 
Campos:
 
```txt
Nome
Ativo
```
 
---
 
## Checklist
 
CRUD completo.
 
Permitir:
 
- Criar pergunta
- Editar pergunta
- Ativar
- Inativar
- Tornar obrigatória
 
---
 
# Upload de Arquivos
 
Formatos permitidos:
 
```txt
jpg
jpeg
png
webp
```
 
---
 
# Regras de Upload
 
Obrigatório:
 
- Nome único
- Compressão automática
- Validação de tamanho
- Validação de extensão
 
Salvar apenas caminho no banco.
 
---
 
# Requisitos Mobile
 
Sistema Mobile First.
 
Compatibilidade:
 
- Android
- iOS
 
Características:
 
- Layout semelhante a aplicativo
- Sem zoom acidental
- Botões grandes
- Cards clicáveis
- Upload por câmera
- Upload por galeria
 
---
 
 
---
 
# Regras de Negócio
 
1. Toda ocorrência nova inicia como PENDENTE.
2. Apenas Vistoriador assume ocorrência.
3. Ao assumir, muda para VISTORIA SUPERVISOR.
4. Ao finalizar vistoria, muda para AGUARDANDO CORRECAO.
5. Apenas Analista vê AGUARDANDO CORRECAO.
6. Analista pode registrar várias tratativas.
7. Correção enviada muda status para CORRECAO ENVIADA.
8. Fotos de vistoria obrigatórias.
9. Fotos de correção obrigatórias.
10. Filtros de importação configuráveis.
11. Causas configuráveis.
12. Senha expira em 120 dias.
13. Troca obrigatória no primeiro login.
14. Uploads devem ser comprimidos.
15. Sistema deve ser totalmente responsivo.
 