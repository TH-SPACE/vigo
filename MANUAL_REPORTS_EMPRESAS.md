# Manual — Módulo "Reports por Empresa"

Envia **uma mensagem de WhatsApp por ocorrência** para o grupo da empresa responsável
(ABILITY, ONDACOM, TELEMONT, TEL). É um módulo **separado** do VIGO: tem tabela, importador
e configurações próprias. Mexer nele **não afeta** a fila de vistorias nem a importação do VIGO.

Tela: **`/admin/reports-empresas`** (Painel Admin → *Reports por Empresa*)

---

## 1. Como funciona

O módulo tem **dois gatilhos independentes**:

| Gatilho | Quando dispara | Mensagem |
|---|---|---|
| **Entrada** | A ocorrência entra na base (ABERTO) ou muda para FECHADO | `🚨 Nova Ocorrência` / `✅ Ocorrência Fechada` |
| **Escalada** | A ocorrência continua ABERTA por muito tempo | `⏰ Em aberto há 14h 20min` |

A **escalada** cobra com frequência crescente. Com o padrão:

- passou de **12h** aberta → cobra a cada **2h**
- passou de **24h** aberta → cobra a cada **1h**

Cada faixa tem o **seu próprio checkbox** e liga/desliga sozinha. Desmarcando a 1ª e deixando
só a 2ª em `24h / a cada 2h`, o módulo cobra **apenas** o que estiver aberto há 24h ou mais,
de 2 em 2 horas — o que está aberto há menos de 24h é ignorado.

Com as **duas faixas desmarcadas** nada é cobrado, mesmo com a escalada ligada (a tela avisa).

As faixas, os intervalos, o horário e os dias da semana são todos editáveis na tela.

---

## 2. Ligando pela primeira vez

**A ordem importa.** Ligar o módulo antes de cadastrar os grupos não quebra nada
(a mensagem falha e é reenviada depois), mas o teste fica confuso.

1. **Cadastre os 4 grupos** no dashboard do reportb2b (`whatsapp-bridge`), nos cards:
   - `Empresa · ABILITY` · `Empresa · ONDACOM` · `Empresa · TELEMONT` · `Empresa · TEL`
2. Na tela do módulo, clique em **Enviar teste** em cada empresa e confirme que a
   mensagem caiu no grupo certo.
3. Confira o aviso de **pendentes** (ver seção 5). Se houver, clique em
   **🔕 Marcar base atual como já avisada**.
4. Só então marque **"Ligar o módulo"** e salve.

---

## 3. Os campos da tela

### Empresas e grupos
Uma empresa = um grupo. O checkbox liga/desliga cada uma sem mexer nas outras.
O nome do destino (`empresa_ability`, etc.) é o que amarra com o card do dashboard.

### Notificação de entrada
- **Notificar cada nova ocorrência** — liga/desliga o gatilho de entrada.
- **Data de corte** — ocorrências abertas **antes** desta data não entram na base nem geram
  mensagem. É a trava contra avisar coisa velha.

### Escalada
- **Ativar cobrança** — liga/desliga o gatilho de escalada inteiro.
- **1ª e 2ª faixa** — cada uma com seu checkbox: a partir de quantas horas em aberto, e de
  quanto em quanto tempo cobrar. Faixa desmarcada não cobra nada — é assim que se pede
  "só as de 24h ou mais": desmarque a 1ª, deixe a 2ª em `24h / a cada 2h`.
- **Dias** — a cobrança roda **o dia inteiro**, inclusive de madrugada. Não há janela de
  horário. O único recorte é o dia da semana: desmarque Sáb/Dom para não cobrar no fim de
  semana. Dia desmarcado = módulo quieto o dia todo.

### Filtros de entrada
Controlam **o que sobe para a base**.

- **Empresas** — uma por grupo. Ao adicionar uma nova aqui, cadastre o grupo dela no dashboard.
- **Clusters permitidos** — ⚠️ **cuidado, ver seção 6**. Vazio = todos.
- **Status permitidos** — manda em **duas** coisas: o que sobe para a base **e** o que vira
  mensagem. Só `ABERTO` e `FECHADO` geram aviso (vazio = os dois). Deixe só `ABERTO` para
  avisar a entrada e **não** avisar o fechamento.
- **Afetação mínima** — `0` = sem corte (diferente do VIGO, que só pega acima de 300).

---

## 4. A regra de ouro: **nada acumula**

> **Só vira mensagem o que entrar na base enquanto o envio estiver ligado para aquela empresa.**

Ocorrência que chega em qualquer uma destas situações é **descartada** — carimbada como
resolvida, sem enviar nada, e **nunca** dispara depois:

- o módulo está desligado;
- a empresa está desmarcada;
- *"Notificar cada nova ocorrência"* está desligado;
- o **grupo da empresa ainda não foi cadastrado** no dashboard;
- a ocorrência é anterior à **data de corte**.

Por isso **é impossível um grupo receber uma enxurrada de avisos atrasados**. E por isso
**ligar o módulo significa "começar do zero a partir de agora"**: a primeira importação depois
de ligar carrega o período parado **sem notificar**, e só o que entrar dali pra frente vira
mensagem.

**A única exceção é falha.** Se o WhatsApp/bridge estiver fora do ar, a ocorrência **continua
pendente** e é reenviada sozinha no próximo ciclo — isso é erro, não pausa, e aí nada se perde.

> ⚠️ A contrapartida: enquanto o grupo não existir, as ocorrências daquele período **não serão
> avisadas nunca**, nem retroativamente. **Cadastre o grupo antes de ligar o módulo.**

---

## 5. Se você limpar a tabela na mão

Se a tabela `report_ocorrencias` for esvaziada e reimportada, as linhas voltam **sem** o carimbo
de "já avisado" — e ligar o módulo dispararia uma mensagem para **cada uma delas**.

A tela avisa isso no topo, em amarelo:

> ⚠️ *6.822 ocorrência(s) na base ainda não foram avisadas. Se você ligar o módulo agora, todas
> elas viram mensagem nos grupos.*

**Antes de ligar o módulo, clique em `🔕 Marcar base atual como já avisada`.**
Isso carimba tudo sem enviar nada, e o módulo passa a notificar só o que entrar dali pra frente.

### ⚠️ Silenciar **não** vale para a escalada

O botão carimba `notificado_aberto_em` / `notificado_fechado_em` — os avisos de **entrada**.
Ele **não toca** em `ultimo_report_em`, que é o relógio da **escalada**. Consequência:

> Toda ocorrência **ABERTA** que já passou da faixa (ex.: 24h) e nunca foi cobrada é cobrada
> **no primeiro ciclo** depois de ligar o módulo — mesmo que você tenha silenciado a base.

O teto de 25 mensagens por empresa por ciclo (1 min) espalha isso, mas não impede. Antes de
ligar com a base cheia de ocorrências antigas em aberto, ou use a **data de corte** para
limitar o que a escalada enxerga, ou zere o relógio na mão:

```sql
UPDATE report_ocorrencias SET ultimo_report_em = NOW() WHERE status = 'ABERTO';
```

---

## 6. "Clusters permitidos" — grupo silencioso é normal

O filtro de cluster vale para **todas** as empresas ao mesmo tempo. Com
`clusters = GOIANIA` (config atual), só entram ocorrências de Goiânia — de qualquer uma
das 4 empresas.

Hoje, na base, a distribuição em GOIANIA é:

| Empresa | Ocorrências em GOIANIA hoje |
|---|---|
| ABILITY | 5.402 |
| ONDACOM | 1.418 |
| TELEMONT | 0 |
| TEL | 0 |

**Isso é esperado, não é defeito.** TELEMONT e TEL hoje atuam em BH e no Rio, então os grupos
delas ficam **quietos** enquanto não houver ocorrência delas em Goiânia. No dia em que uma
aparecer, o módulo notifica o grupo da empresa automaticamente — nenhuma configuração extra.

Se quiser que os grupos recebam ocorrências de **todas as regiões**, deixe
**Clusters permitidos vazio**.

---

## 7. Operação

```bash
# aplicar/atualizar o schema do módulo (idempotente, não apaga dado)
npm run setup:reports

# reiniciar o app depois de mudar código
pm2 restart vigo

# rebuild do bridge (depois de mexer no dashboard do whatsapp-bridge)
cd ~/reportb2b/whatsapp-bridge && docker compose up -d --build dashboard
```

**Log:** `pm2 logs vigo` — as linhas do módulo aparecem como `[ReportImport]` e `[ReportEmpresas]`.

### Empresa sem grupo cadastrado → a mensagem é **descartada**

Se a empresa ainda não tem grupo, o módulo **não guarda** o aviso. Ele carimba a ocorrência como
resolvida e segue em frente:

```
[ReportEmpresas] TELEMONT sem grupo cadastrado: 3 aviso(s) de ABERTO descartado(s)
```

Isso é **de propósito**: se as mensagens ficassem acumuladas, o grupo nasceria no dia da criação
com dezenas de avisos atrasados de uma vez. Assim ele **começa limpo** e recebe só o que entrar
a partir dali. Na escalada vale o mesmo: o relógio da cobrança é reiniciado, então a primeira
cobrança vem no intervalo normal, e não todas de uma vez.

> ⚠️ Consequência: enquanto o grupo não existir, **as ocorrências daquele período não serão
> avisadas nunca** — nem retroativamente. Cadastre o grupo **antes** de ligar o módulo.

**Falha de rede é diferente.** Se o bridge estiver fora do ar (e não "sem grupo"), a ocorrência
**continua pendente** e é reenviada sozinha no próximo ciclo. Aí nada se perde.

---

## 8. Onde fica cada coisa

| Arquivo | Papel |
|---|---|
| `views/admin/reports-empresas.ejs` | A tela |
| `controllers/adminController.js` | Handlers (`reportsEmpresas`, `salvarReportsEmpresas`, …) |
| `services/importadorReports.js` | Importador próprio do módulo |
| `services/reportEmpresas.js` | Mensagens, envio, entrada e escalada |
| `models/ReportOcorrencia.js` | Acesso à tabela `report_ocorrencias` |
| `database/schema_reports.sql` | Tabela + configs `rep_*` |
| `services/scheduler.js` | Agenda o ciclo do módulo (separado do VIGO) |

Configurações ficam na tabela `config`, todas com prefixo **`rep_`**.

---

## 9. Duas armadilhas de fuso (para quem for mexer no código)

Documentado aqui porque **as duas são silenciosas** — não dão erro, só entregam o resultado errado.

1. **O MySQL roda em UTC, mas `data_ocorrencia` é gravada em horário de Brasília.**
   Usar `NOW()` / `TIMESTAMPDIFF` no SQL infla o tempo em aberto em **3 horas** — a escalada de
   ">12h" dispararia com 9h reais. **Toda conta de tempo é feita no Node.**

2. **O pool abre com `dateStrings: true`** (`database/connection.js`), então `DATETIME` chega como
   **string**, nunca `Date`. Um guard do tipo `if (x instanceof Date)` é sempre falso e
   **desliga a escalada inteira sem erro nenhum**. Use o helper `paraDate()` de
   `services/reportEmpresas.js`.
