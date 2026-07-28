# Manual — Módulo "Reports Regional"

Envia **uma mensagem de WhatsApp por ocorrência** para **um único grupo**, disparada por
toda ocorrência com **afetação alta** (padrão **≥ 70**), de **qualquer empresa**. É o irmão
regional do módulo *Reports por Empresa*: enquanto aquele cobre só as 4 empresas de **Goiânia**
(um grupo por empresa), este é **regional** — um só grupo, recorte por afetação em vez de empresa.

É um módulo **separado**: tem tabela, importador e configurações próprias. Mexer nele **não afeta**
o VIGO nem o módulo de empresas.

Tela: **`/admin/reports-regional`** (Painel Admin → *Reports Regional*)

> 🔑 **O que muda em relação ao de empresas:** as mensagens saem por um **número de WhatsApp
> próprio**, cadastrado numa página separada do reportb2b (**`/regional`**, com senha própria).
> Os grupos das 4 empresas continuam no número atual, sem alteração.

---

## 1. Como funciona

O módulo tem **dois gatilhos independentes** (iguais aos do de empresas):

| Gatilho | Quando dispara | Mensagem |
|---|---|---|
| **Entrada** | A ocorrência entra na base (ABERTO) ou muda para FECHADO | `🚨 Nova Ocorrência — Regional` / `✅ Ocorrência Fechada — Regional` |
| **Escalada** | A ocorrência continua ABERTA por muito tempo | `⏰ Em aberto há 14h 20min — Regional` |

O **corte de afetação** é o gatilho principal: só entra na base (e só vira mensagem) a
ocorrência com **afetação ≥ corte** (padrão 70, editável na tela).

A **escalada** cobra com frequência crescente. Com o padrão:

- passou de **12h** aberta → cobra a cada **2h**
- passou de **24h** aberta → cobra a cada **1h**

Cada faixa tem o **seu próprio checkbox** e liga/desliga sozinha. Com as **duas faixas
desmarcadas** nada é cobrado, mesmo com a escalada ligada (a tela avisa). As faixas, os
intervalos e os dias da semana são todos editáveis na tela.

---

## 2. Ligando pela primeira vez

**A ordem importa.** Ligar o módulo antes de cadastrar o grupo não quebra nada
(a mensagem é descartada, não acumula), mas o teste fica confuso.

1. **Cadastre o número e o grupo** na página nova do reportb2b — ver seção 3.
2. Na tela do módulo, clique em **Enviar teste** e confirme que a mensagem caiu no grupo certo.
3. Confira o aviso de **pendentes** no topo. Se houver, clique em **🔕 Silenciar base atual**.
4. Clique em **Importar agora** (a 1ª importação é *backfill*: carrega a base **sem notificar**).
5. Só então marque **"Módulo ligado"** e salve.

> Ligar o módulo re-arma o backfill automaticamente: a próxima importação depois de ligar
> carrega o período parado **sem notificar**, e só o que entrar dali pra frente vira mensagem.

---

## 3. O número próprio e o grupo (reportb2b)

Este é o passo que difere do módulo de empresas: as mensagens saem por **outro número**.

Página: **`http://<host>:3013/regional`** — tem **senha própria**
(`DASHBOARD_PASSWORD_REGIONAL` no `.env` do `whatsapp-bridge`), separada do dashboard principal.
Quem acessa aqui **não** enxerga o dashboard das 4 empresas.

Passos na página `/regional`:

1. **1 · Número (instância):** dê um nome (ex.: `regionalbot`) → *Criar / Conectar* →
   leia o **QR** no WhatsApp do aparelho do número novo (Configurações → Aparelhos conectados).
   Quando o estado ficar **`open`**, está conectado.
2. **2 · Grupo:** *Carregar grupos* → escolha o grupo de destino.
3. **3 · Salvar** → **Enviar teste**. A mensagem sai pelo número novo.

Por baixo, isso grava no Redis: o grupo (`config:group_jid:regional`) e o **override de
instância** (`config:instance_name:regional`) — é este override que faz o destino `regional`
sair por outro número **sem** mexer nos destinos `empresa_*`, que seguem no número global.

---

## 4. Os campos da tela

### Envio
- **Módulo ligado** — chave geral: importa a base e envia.
- **Avisar nova ocorrência** — liga/desliga o gatilho de entrada.
- **Cobrar ocorrência parada** — liga/desliga a escalada inteira.

### Grupo único
Nota + botão **Enviar teste**. O cadastro do grupo/número é feito na página `/regional`
do reportb2b (seção 3), não aqui.

### Escalada
- **1ª e 2ª faixa** — cada uma com seu checkbox: a partir de quantas horas em aberto, e de
  quanto em quanto tempo cobrar. Faixa desmarcada não cobra nada.
- **Dias** — a cobrança roda **o dia inteiro**, inclusive de madrugada. O único recorte é o
  dia da semana: desmarque Sáb/Dom para não cobrar no fim de semana.

### O que entra na base
- **Afetação mínima** — o gatilho principal. `70` por padrão; `0` = sem corte.
- **Data de corte** — ocorrências abertas **antes** desta data não entram nem geram mensagem.
- **Empresas** — **vazio = todas** (é o normal aqui). Preencha (separadas por vírgula) só
  para restringir.
- **Clusters permitidos** — vazio = todos.
- **Status permitidos** — manda em **duas** coisas: o que sobe para a base **e** o que vira
  mensagem. Só `ABERTO` e `FECHADO` geram aviso (vazio = os dois).

### Origem
- **URL da base** (TBL_OCORRENCIA.TXT) e o **intervalo** (min/máx, em minutos) do ciclo próprio.

---

## 5. A regra de ouro: **nada acumula**

> **Só vira mensagem o que entrar na base enquanto o envio estiver ligado.**

Ocorrência que chega em qualquer uma destas situações é **descartada** — carimbada como
resolvida, sem enviar nada, e **nunca** dispara depois:

- o módulo está desligado;
- *"Avisar nova ocorrência"* está desligado;
- o **grupo ainda não foi cadastrado** na página `/regional`;
- a ocorrência é anterior à **data de corte**;
- a afetação está **abaixo do corte** (nem entra na base).

Por isso **é impossível o grupo receber uma enxurrada de avisos atrasados**, e **ligar o módulo
significa "começar do zero a partir de agora"**.

**A única exceção é falha.** Se o WhatsApp/bridge estiver fora do ar, a ocorrência **continua
pendente** e é reenviada sozinha no próximo ciclo — isso é erro, não pausa, e aí nada se perde.

> ⚠️ A contrapartida: enquanto o grupo não existir, as ocorrências daquele período **não serão
> avisadas nunca**, nem retroativamente. **Cadastre o grupo antes de ligar o módulo.**

---

## 6. Se você limpar a tabela na mão

Se a tabela `report_regional` for esvaziada e reimportada, as linhas voltam **sem** o carimbo de
"já avisado" — e ligar o módulo dispararia uma mensagem para **cada uma**. A tela avisa isso no
topo, em amarelo.

**Antes de ligar, clique em `🔕 Silenciar base atual`.** Isso carimba tudo sem enviar nada.

### ⚠️ Silenciar **não** vale para a escalada

O botão carimba os avisos de **entrada** (`notificado_aberto_em` / `notificado_fechado_em`).
Ele **não toca** em `ultimo_report_em`, o relógio da **escalada**. Consequência: toda ocorrência
**ABERTA** que já passou da faixa e nunca foi cobrada é cobrada **no primeiro ciclo** depois de
ligar. Use a **data de corte** para limitar o que a escalada enxerga, ou zere o relógio na mão:

```sql
UPDATE report_regional SET ultimo_report_em = NOW() WHERE status = 'ABERTO';
```

---

## 7. Operação

```bash
# aplicar/atualizar o schema do módulo (idempotente, não apaga dado)
npm run setup:regional          # = node database/setup-regional.js

# reiniciar o app depois de mudar código
pm2 restart vigo

# rebuild do bridge (depois de mexer no dashboard/worker do whatsapp-bridge)
cd ~/reportb2b/whatsapp-bridge && docker compose up -d --build dashboard worker
```

**Log:** `pm2 logs vigo` — as linhas do módulo aparecem como `[RegionalImport]` e `[ReportRegional]`.

### Grupo não cadastrado → a mensagem é **descartada**

Se o grupo do destino `regional` ainda não existe, o módulo **não guarda** o aviso — carimba a
ocorrência como resolvida e segue:

```
[ReportRegional] sem grupo cadastrado: 3 aviso(s) de ABERTO descartado(s) (não ficam pendentes).
```

Isso é **de propósito** (mesma lógica do de empresas): o grupo **começa limpo**. Na escalada,
o relógio é reiniciado, então a 1ª cobrança vem no intervalo normal.

---

## 8. Onde fica cada coisa

| Arquivo | Papel |
|---|---|
| `views/admin/reports-regional.ejs` | A tela |
| `controllers/adminController.js` | Handlers (`reportsRegional`, `salvarReportsRegional`, …) |
| `services/importadorRegional.js` | Importador próprio do módulo |
| `services/reportRegional.js` | Mensagens, envio, entrada e escalada |
| `models/ReportRegional.js` | Acesso à tabela `report_regional` |
| `database/schema_regional.sql` | Tabela + configs `repreg_*` |
| `database/setup-regional.js` | Aplica o schema (idempotente) |
| `services/scheduler.js` | Agenda o ciclo do módulo (separado do VIGO e do de empresas) |

No **reportb2b** (`whatsapp-bridge`):

| Arquivo | Papel |
|---|---|
| `dashboard/index.js` | Página `/regional` (senha própria) + endpoints `/regional/api/*` |
| `worker/index.js` | **Override de instância por destino** (`config:instance_name:<target>`) |

Configurações do VIGO ficam na tabela `config`, todas com prefixo **`repreg_`**.

---

## 9. Duas armadilhas de fuso (para quem for mexer no código)

Documentado aqui porque **as duas são silenciosas** — não dão erro, só entregam o resultado errado.

1. **O MySQL roda em UTC, mas `data_ocorrencia` é gravada em horário de Brasília.**
   Usar `NOW()` / `TIMESTAMPDIFF` no SQL infla o tempo em aberto em **3 horas** — a escalada de
   ">12h" dispararia com 9h reais. **Toda conta de tempo é feita no Node.**

2. **O pool abre com `dateStrings: true`** (`database/connection.js`), então `DATETIME` chega como
   **string**, nunca `Date`. Um guard do tipo `if (x instanceof Date)` é sempre falso e
   **desliga a escalada inteira sem erro nenhum**. Use o helper `paraDate()` de
   `services/reportRegional.js`.

> ℹ️ Cuidado ao renomear no código: **`afetacao`** é o nome de uma **coluna** do TXT (aparece no
> schema, no model e no importador). Só o prefixo de config mudou (`repaf_` → `repreg_`); o corte
> continua em `repreg_afetacao_minima`.
