# Manual — Módulo "Reports de Atraso"

Cobra no WhatsApp toda ocorrência **ABERTA há muito tempo**, de empresas específicas
(**ONDACOM**, **ABILITY**), em **qualquer cluster**. É um módulo **separado**: tem tabela,
importador e configurações próprias. Mexer nele **não afeta** o VIGO nem os outros módulos
de report (Reports por Empresa, Reports Regional).

Tela: **`/admin/reports-atraso`** (Painel Admin → *Reports de Atraso*)

---

## 1. Por que este módulo existe

O módulo **Reports por Empresa** (`/admin/reports-empresas`) já cobra as 4 empresas
(ABILITY, ONDACOM, TELEMONT, TEL) com entrada + escalada — mas hoje está preso a
`rep_clusters_permitidos = GOIANIA`, um filtro **único, compartilhado pelas 4 empresas ao
mesmo tempo**. Ou seja: o grupo da ONDACOM e o da ABILITY só recebem ocorrência de Goiânia.

Este módulo cobre exatamente a lacuna: cobra ONDACOM e ABILITY em **qualquer cidade/região**,
sem depender do filtro de cluster do outro módulo — e sem mudar o comportamento dele
(TELEMONT e TEL continuam como estão).

**Só existe um gatilho aqui: ESCALADA.** Não há aviso de "nova ocorrência" nem de
"ocorrência fechada" — isso já é feito pelo Reports por Empresa. Este módulo só cobra
quem está demorando demais para fechar.

---

## 2. Como funciona

| Gatilho | Quando dispara | Mensagem |
|---|---|---|
| **Escalada** | A ocorrência continua ABERTA por muito tempo | `⏰ Ocorrência em atraso há 14h 20min` |

A escalada cobra com frequência crescente. Com o padrão (já vem configurado assim):

- passou de **12h** aberta → cobra a cada **2h**
- 2ª faixa (24h) vem **desligada** por padrão — pode ligar se quiser um segundo nível de cobrança

Cada faixa tem o **seu próprio checkbox** e liga/desliga sozinha, igual aos outros módulos.
Com as **duas faixas desmarcadas** nada é cobrado, mesmo com a escalada ligada (a tela avisa).

As faixas, os intervalos, o horário e os dias da semana são todos editáveis na tela.

---

## 3. Ligando pela primeira vez

1. **Cadastre os 2 grupos** no dashboard do reportb2b (`whatsapp-bridge`), na seção
   **"⏰ Reports de Atraso"**, cards:
   - `Atraso · ABILITY` · `Atraso · ONDACOM`
2. Na tela do módulo, clique em **Enviar teste** em cada empresa e confirme que a
   mensagem caiu no grupo certo.
3. Só então marque **"Módulo ligado"** e salve.

---

## 4. Os campos da tela

### Empresas e grupos
Uma empresa = um grupo. O checkbox liga/desliga cada uma sem mexer na outra.
O nome do destino (`atraso_ability`, `atraso_ondacom`) é o que amarra com o card do dashboard.

### Escalada
- **1ª e 2ª faixa** — cada uma com seu checkbox: a partir de quantas horas em aberto, e de
  quanto em quanto tempo cobrar. Faixa desmarcada não cobra nada.
- **Dias** — a cobrança roda **o dia inteiro**, inclusive de madrugada. Não há janela de
  horário. O único recorte é o dia da semana: desmarque Sáb/Dom para não cobrar no fim de
  semana. Dia desmarcado = módulo quieto o dia todo.

### O que entra na base
- **Data de corte** — ocorrências abertas **antes** desta data não entram na base nem são
  cobradas. Vazio = sem corte.
- **Empresas** — uma por grupo. Ao adicionar uma nova aqui, cadastre o grupo dela no dashboard.
- **Clusters** — ⚠️ **vazio = todos** (essa é a diferença principal para o Reports por
  Empresa). Preencha só se algum dia quiser restringir este módulo também a clusters
  específicos.

Não existe filtro de **status permitidos** nem de **afetação mínima** aqui: só entram
ocorrências **ABERTAS** (não há por que trazer histórico fechado, já que este módulo não
avisa entrada nem fechamento).

---

## 5. A regra de ouro: o relógio da escalada não acumula

> **Ligar o módulo zera o relógio de quem já está aberto.** A cobrança normal só começa a
> valer a partir da 1ª importação depois de ligar.

Sem isso, uma ocorrência aberta há 3 dias antes do módulo existir dispararia cobrança para
**todo mundo de uma vez** no primeiro ciclo. Por isso:

- Ao marcar **"Módulo ligado"**, o backfill é re-armado.
- Na importação seguinte, toda ocorrência ABERTA entra com o relógio (`ultimo_report_em`)
  já carimbado como "agora" — a partir daí, a cobrança normal (12h/2h) passa a valer.

**A única exceção é falha.** Se o WhatsApp/bridge estiver fora do ar, a cobrança **continua
pendente** e é reenviada sozinha no próximo ciclo — isso é erro, não pausa, e aí nada se perde.

---

## 6. Se você limpar a tabela na mão

Se `report_atraso` for esvaziada e reimportada, as linhas voltam **sem** o relógio da
escalada — e quem já estiver acima da faixa (ex.: aberta há 20h) dispararia cobrança **no
primeiro ciclo** depois da recarga.

Antes de religar depois de uma limpeza manual, zere o relógio na mão:

```sql
UPDATE report_atraso SET ultimo_report_em = NOW() WHERE status = 'ABERTO';
```

Ou simplesmente desligue e religue o módulo pela tela — isso já re-arma o backfill e faz o
mesmo efeito na importação seguinte.

---

## 7. Empresa sem grupo cadastrado → a cobrança é **descartada**

Se a empresa ainda não tem grupo, o módulo **não guarda** a cobrança pendente: registra como
se tivesse cobrado (zera o relógio) e segue em frente.

```
[ReportAtraso] ONDACOM sem grupo cadastrado: 3 cobrança(s) descartada(s) (relógio reiniciado).
```

Isso é **de propósito**: se as cobranças ficassem acumuladas, o grupo nasceria no dia da
criação com dezenas de avisos atrasados de uma vez. Assim ele **começa limpo** e a primeira
cobrança real vem no intervalo normal (12h/2h), não todas de uma vez.

> ⚠️ Consequência: enquanto o grupo não existir, **as ocorrências daquele período não serão
> avisadas nunca** — nem retroativamente. Cadastre o grupo **antes** de ligar o módulo.

**Falha de rede é diferente.** Se o bridge estiver fora do ar (e não "sem grupo"), a cobrança
**continua pendente** e é reenviada sozinha no próximo ciclo.

---

## 8. Operação

```bash
# aplicar/atualizar o schema do módulo (idempotente, não apaga dado)
npm run setup:atraso

# reiniciar o app depois de mudar código
pm2 restart vigo

# rebuild do bridge (depois de mexer no dashboard do whatsapp-bridge)
cd ~/reportb2b/whatsapp-bridge && docker compose up -d --build dashboard
```

**Log:** `pm2 logs vigo` — as linhas do módulo aparecem como `[AtrasoImport]` (importação) e
`[ReportAtraso]` (escalada).

---

## 9. Onde fica cada coisa

| Arquivo | Papel |
|---|---|
| `views/admin/reports-atraso.ejs` | A tela |
| `controllers/adminController.js` | Handlers (`reportsAtraso`, `salvarReportsAtraso`, …) |
| `services/importadorAtraso.js` | Importador próprio do módulo |
| `services/reportAtraso.js` | Mensagem, envio e escalada |
| `models/ReportAtraso.js` | Acesso à tabela `report_atraso` |
| `database/schema_atraso.sql` | Tabela + configs `repat_*` |
| `services/scheduler.js` | Agenda o ciclo do módulo (separado do VIGO e dos outros reports) |
| `~/reportb2b/whatsapp-bridge/dashboard/index.js` | Cards `Atraso · ABILITY` / `Atraso · ONDACOM`, targets `atraso_*` |

Configurações ficam na tabela `config`, todas com prefixo **`repat_`**.

---

## 10. Duas armadilhas de fuso (para quem for mexer no código)

Documentado aqui porque **as duas são silenciosas** — não dão erro, só entregam o resultado errado.

1. **O MySQL roda em UTC, mas `data_ocorrencia` é gravada em horário de Brasília.**
   Usar `NOW()` / `TIMESTAMPDIFF` no SQL infla o tempo em aberto em **3 horas** — a escalada de
   ">12h" dispararia com 9h reais. **Toda conta de tempo é feita no Node.**

2. **O pool abre com `dateStrings: true`** (`database/connection.js`), então `DATETIME` chega
   como **string**, nunca `Date`. Um guard do tipo `if (x instanceof Date)` é sempre falso e
   **desliga a escalada inteira sem erro nenhum**. Use o helper `paraDate()` de
   `services/reportAtraso.js`.
