# Casa em Dia

PWA estático para organizar as finanças de uma casa. Os lançamentos e as contas dos membros ficam no Supabase; este repositório contém somente o código, a migração do banco e a função segura de convites.

## Conteúdo publicado

O comando `npm run build` copia para `dist/` somente os arquivos públicos necessários para o site. A saída não inclui `supabase.txt`, credenciais privadas, `node_modules`, migrações ou código das Edge Functions. A chave publishable e a URL do projeto em `supabase-config.js` são configurações públicas do cliente; a autorização dos dados depende das políticas RLS.

## Publicar gratuitamente no Cloudflare Pages

1. O projeto **Pages** `casa-em-dia` está publicado em [casa-em-dia-7l4.pages.dev](https://casa-em-dia-7l4.pages.dev/).2. Configure o comando de build como `npm run build` e o diretório de saída como `dist` caso conecte este projeto ao GitHub para deploy automático.
3. Cada push em `main` publica o app se o projeto Pages estiver conectado ao repositório. Para testar localmente, use `npm run pages:dev`; para publicar pela CLI, autentique o Wrangler com `npx wrangler login` e execute `npm run pages:deploy`.
4. Configure a URL HTTPS do Pages e o domínio publicado em Supabase **Authentication → URL Configuration**.

O projeto não depende de Workers pagos nem publica arquivos privados do banco. O Pages e a CDN servem apenas a saída estática do PWA; autenticação, dados e convites permanecem no Supabase.

O acesso é por e-mail e senha, sem cadastro público. O responsável adiciona membros pelo e-mail; cada pessoa recebe um convite e define sua própria senha. Convites e redefinições de senha usam callbacks que precisam estar permitidos na configuração de URLs do Supabase; veja [`supabase/README.md`](./supabase/README.md).

O controle mensal suporta receitas e despesas recorrentes, com valores variáveis registrados separadamente em cada mês e cada receita marcada como fixa ou variável. Em **Mês**, cada item lançado tem o botão **Ajustar**, que abre um diálogo para mudar nome e valor, escolher entre **Avulsa**, **Fixa** ou **Variável**, corrigir o grupo (Fixos, Variáveis ou Adicionais) e excluir o item sem perder o histórico; em **Fixos** os modelos podem ser pausados, reativados ou removidos. Itens excluídos do mês continuam recuperáveis por **Restaurar itens removidos deste mês** e voltam ao serem cadastrados com o mesmo nome. Faturas podem ser importadas por CSV, PDF com texto selecionável ou OFX; o total da fatura entra por competência (vencimento até o dia 15 conta no mês anterior), enquanto as compras classificadas alimentam os grupos e insights sem duplicar o caixa. Todas as migrações do Supabase já estão aplicadas no projeto vinculado; veja [`supabase/README.md`](./supabase/README.md).

## Lançamentos automáticos e backup local

O formulário **Novo lançamento** do mês tem um seletor **Despesa / Receita**: despesas não pedem grupo, porque o app classifica cada nome em **Gastos fixos**, **Gastos variáveis** ou **Gastos adicionais** e informa o critério usado (categoria, histórico da casa, palavras-chave ou padrão). A ordem de decisão é:

1. categoria e subcategoria escolhidas na ficha de lançamento;
2. histórico da casa para o mesmo nome (o mês mais recente vence);
3. nome igual a uma categoria ou subcategoria cadastrada;
4. palavras-chave do nome (por exemplo *aluguel*, *luz* e *internet* viram fixos; *mercado*, *farmácia* e *gás de cozinha* viram variáveis; *conserto*, *multa* e *reforma* viram adicionais);
5. sem pistas, o item entra em **Gastos variáveis**.

A classificação é uma sugestão: qualquer item pode ser movido de grupo em **Mês → Ajustar → Grupo**, e a mudança vale também para os meses seguintes quando o item é fixo ou variável. O módulo [`smart-classify.mjs`](./smart-classify.mjs) concentra essas regras e é coberto por `npm test`.

Em **Ajustes → Backup e uso local** é possível baixar:

- **Backup completo (JSON)** com casa, membros, categorias, metas, reserva, cartões, faturas e compras, modelos recorrentes, itens mensais e todo o extrato;
- **Lançamentos por mês (CSV)** com mês, tipo, grupo, item, valor, repetição e se o item foi removido do mês;
- **Extrato completo (CSV)** com data, descrição, tipo, categoria, subcategoria, forma de pagamento e valor.

Os CSV usam `;` como separador, vírgula decimal e BOM UTF-8 para abrir direto no Excel em português. Os arquivos são gerados no navegador a partir dos dados do Supabase; nada é enviado a terceiros.

## Cartões de crédito em poucos toques

O caminho curto para começar a usar cartão fica na própria tela **Mês**:

1. em **Faturas de cartão**, toque em **＋ Novo cartão** (esse botão também aparece no estado vazio como *Cadastrar meu primeiro cartão*);
2. preencha **apenas o nome** — limite é opcional e operadora/banco fica em *detalhes opcionais*;
3. toque em **Salvar e importar fatura**: o cartão é criado e o importador abre já com ele selecionado e o **vencimento sugerido** (última fatura + 1 mês, ou a data do nome do arquivo);
4. escolha o arquivo → **Analisar fatura** → confira → **Salvar fatura**.

São 4 toques no caminho feliz, contra 8 a 10 do fluxo anterior (que exigia ir a **Fixos**, preencher nome e operadora e depois voltar para importar). Quando a despesa é no cartão e nenhum cartão está cadastrado, a própria ficha de lançamento mostra **Cadastrar novo cartão**; o cartão criado já sai selecionado na despesa, sem perder o que foi digitado. O formulário completo (titular, limite, edição) continua em **Fixos → Cartões e faturas**, e a operadora passou a ser opcional nos dois caminhos.

## Painel de receitas

A aba **Receitas** (também acessível por *Ver e gerenciar todas as receitas*, dentro do grupo Receitas da aba Mês) mostra a renda da casa em três blocos:

- **Receitas que repetem todo mês** — os modelos fixos e variáveis (salário, benefícios, freelance): valor, tipo, **prazo** (`Sem prazo`, `Até set/2027`, `Último mês`, `Encerrada em set/2027`), desde quando e quantos meses já foram gerados. Ações: **Salvar valor**, **Marcar como fixa/variável**, **Encerrar repetição** (para a série a partir do próximo mês e mantém o histórico), **Excluir cadastro** (só para erro/duplicado) e **Voltar a repetir** nas encerradas;
- **Receitas deste mês** — o que de fato entrou no mês selecionado, com **Ajustar** (valor, tipo, grupo e **Repetir até**), **Remover deste mês** (sai só deste mês) e **Encerrar repetição**. Se alguma receita foi removida do mês, o botão **Restaurar receitas removidas** reaparece;
- **Encerradas** — grupo recolhível com as séries que terminaram, para não poluir a lista e ainda dar contexto ("por que outubro não tem esse valor?").

## Caixinhas (guardar para contas anuais)

Em **Receitas → Caixinhas** você cria uma caixinha por conta que vence de vez em quando (IPVA, IPTU, CREA, CRT, licenciamento, seguro…):

- informe **quanto vai para a caixinha todo mês**, opcionalmente o **valor da conta** e o **mês do vencimento** (o app mostra progresso, quanto falta e quantos meses restam) e, se quiser, **guardar até** um mês;
- o **aporte do mês é registrado automaticamente** ao abrir o mês (`ensure_savings_pot_movements`), espelhando o agendamento que o banco já faz — reabrir o mês não duplica (índice único por caixinha/mês);
- **Guardar agora** registra um aporte extra; **Pagar conta** registra a **despesa** no mês e **retira** o valor da caixinha na mesma ação;
- **Encerrar aportes** para a contribuição a partir do próximo mês (o valor guardado permanece para pagar a conta) e **Voltar a guardar** reabre; **Excluir caixinha** só para erro/duplicado.

Efeito nos números: o aporte **sai da receita** (entra como dedução do livre no resumo do mês, no saldo dos Insights e na previsão dos próximos meses), mas **não é despesa**. Quando a conta é paga, a despesa entra de verdade e a caixinha diminui — nada é contado duas vezes. A reserva de emergência continua separada em **Ajustes**.

### Série com prazo (o modelo que os apps comerciais usam)

Toda receita/despesa recorrente é uma **série com início e fim opcional**:

| Situação | Como fica |
|---|---|
| Salário efetivo, aluguel (sem data para acabar) | **Repetir até em branco** = **sem prazo**; repete até você encerrar |
| Emprego temporário de 11 meses | **Repetir até set/2027** → gera 11 meses e **para sozinho** |
| Acabou antes do previsto | **Encerrar repetição** a partir do próximo mês; o passado fica |
| Contrato renovou | **Ajustar → Repetir até** com a nova data (estende) |
| Voltou depois de um tempo | Cria de novo com início no mês da volta; a encerrada não conflita |

O app **não materializa** anos de meses: cada mês é gerado ao ser aberto (`ensure_monthly_control_items` respeita `starts_month` e `ends_month`). As únicas ações destrutivas são **remover deste mês** (pontual) e **excluir cadastro** (erro/duplicado); "pausar repetição" foi removido por ser redundante com o encerramento.
- **Adicionar receita** — nome, valor e **Repetir todo mês** marcado por padrão (desmarcado, vale só para o mês). Com "valor varia por mês", cada mês começa sem valor para você preencher.

Correção de repetição: encerrar ou excluir uma receita fixa agora corta sempre a partir do **mês atual real** (não do mês que está sendo exibido) e limpa as linhas futuras que ficavam órfãs. Antes, ao excluir o modelo olhando um mês futuro, as linhas daquele mês sobreviviam sem vínculo e continuavam aparecendo em outros meses como "avulsas".

## Mês financeiro (virada e competência)

O app separa **competência** (a que mês o dinheiro pertence) da **data do lançamento**:

- **Faturas de cartão** entram pelo mês de competência: vencimento até o dia 15 conta no mês anterior (07/11 → outubro);
- **Virada do mês financeiro** em **Ajustes → Mês financeiro**, exclusiva do responsável: com a virada no dia N, lançamentos do extrato datados até o dia N do mês seguinte contam no mês anterior. É o caso do salário que cai no 5º dia útil e paga as contas do mês que acabou. O valor **1 desliga** a regra e volta ao mês do calendário;
- **Mês de competência** na ficha de lançamento: escolha um mês específico para contas pagas antecipadamente ou atrasadas. O apontamento manual vence a virada. Para corrigir um lançamento que já existe, use o botão **Mês** na linha do item (tela Mês) e escolha a competência, ou volte para **Automático**;
- **Pagamento de fatura** lançado no extrato (título começando por "Pagamento" e contendo "fatura") **não entra no resumo**: o total da fatura já é contado no mês de competência, então somar o pagamento contaria o mesmo dinheiro duas vezes. O lançamento continua no Extrato, marcado como *fora do resumo*.

## Categorização das compras do cartão

Cada compra da fatura é classificada pelo **texto da linha** (nome do estabelecimento e, quando existe, o complemento/memo), não pelo valor nem pelo total da fatura: farmácia, padaria, mercado, açougue, feira, oficina, combustível, streaming, delivery, petshop, transporte e compras em geral. O texto é normalizado (minúsculas, sem acentos) e comparado com radicais, então *Redepharma*, *Farma Central* e *Pharma Vita* caem em **Saúde · Farmácia**, e *Padaria*, *Panificadora* e *Padoca* em **Alimentação · Padaria**. Palavras curtas e ambíguas exigem palavra inteira, para *Cobrança* não virar imprevisto e *Mercado Livre* não virar mercado de bairro (marketplaces como Amazon, Shopee, Magalu e Mercado Livre entram em **Outros · Compras online**). A classificação usa a categoria/subcategoria da casa quando ela existe e, quando não existe, mantém o nome do contexto (ex.: *Alimentação · Mercado*) com o grupo de orçamento sugerido.

- Nenhuma compra fica com categoria vazia: sem correspondência, entra em **Outros** e a prévia da importação marca *Sem correspondência — usando Outros* para revisão;
- Na prévia de importação é possível ajustar categoria, subcategoria e grupo de cada linha antes de salvar; o que você classificar entra no **dicionário da casa** (`card_merchant_rules`) e passa a valer para o mesmo estabelecimento nas próximas faturas, para os dois membros;
- Quando o nome **não declara o ramo**, a compra fica **Sem categoria** (nunca um palpite): a prévia marca *Sem categoria — classifique para o app aprender* e **Insights** mostra quantas compras estão pendentes e o valor delas;
- A prévia mostra a origem da sugestão: *Sugestão pelo nome do estabelecimento*, *Padrão da casa* (dicionário aprendido), *Padrão já usado nesta casa* (histórico salvo) ou *Classificação salva* (reimportação);
- O dicionário ignora o que o adquirente acrescenta ao nome (`Mp *`, `Dl *`, `Ig*`, `Zp*`, `Cappta *`, `Jim.Com*`) e o marcador `- Parcela 7/10`, então a mesma regra vale para compras à vista e parceladas;
- Faturas importadas antes desta classificação são reclassificadas automaticamente ao abrir o app (apenas linhas sem categoria e nunca pagamentos de fatura);
- **Insights** mostra dois níveis: o KPI **Compras no cartão** (total comprado no mês de competência, incluindo parcelas) e o cartão **Cartão por categoria**, com valor e participação de cada contexto. O gráfico **Gastos por categoria** soma despesas do mês e compras do cartão, sem repetir o total da fatura no caixa.

## Duplicidade de lançamentos

O app evita duplicar de duas formas:

- **Itens do mês** (receitas e despesas do controle mensal) e **modelos fixos** não podem repetir o mesmo nome no mesmo grupo e mês; ao cadastrar um nome que já existe, o item é restaurado em vez de duplicado, e um índice único no banco reforça a regra. Faturas de cartão usam `source_key` e a importação da planilha usa o fingerprint do arquivo, então reimportar o mesmo arquivo não cria cópias.
- **Lançamentos avulsos** (ficha de despesa/receita com frequência **Avulsa**): antes de gravar, o app procura no extrato um lançamento com **mesmo nome, mesmo valor e mesma data** e pede confirmação, mostrando item, valor e data. Confirmando, o lançamento é gravado; recusando, nada é salvo. A comparação ignora maiúsculas/minúsculas e acentos, e valores ou nomes diferentes não disparam o aviso.

## Alternativa: GitHub Pages

O workflow `.github/workflows/deploy-github-pages.yml` pode ser executado manualmente após habilitar o Pages. No GitHub, abra **Settings → Pages** e escolha **GitHub Actions** como origem da publicação; depois, em **Actions**, execute **Deploy PWA to GitHub Pages**. A URL será `https://ldelectric.github.io/casa_em_dia/`.

Se usar a URL padrão do GitHub Pages, autorize-a também nas URLs de redirecionamento do Supabase. A URL `APP_SITE_URL` usada pela função de convites precisa conter o caminho do projeto: `https://ldelectric.github.io/casa_em_dia/`. Para Cloudflare Pages, use o endereço HTTPS do projeto Pages com a barra final.

## Configurar dados e autenticação no Supabase

Siga [`supabase/README.md`](./supabase/README.md) para:

- aplicar as migrações SQL em ordem; elas criam tabelas vazias e políticas RLS;
- convidar a conta responsável inicial;
- configurar login por senha, redefinição de senha e SMTP;
- publicar a Edge Function de convites com o segredo `service_role` mantido no Supabase.

Não coloque senhas do banco, `service_role`, `secret` ou outras chaves administrativas no GitHub, no código cliente ou em variáveis de build públicas. O `.gitignore` ignora o arquivo local `supabase.txt`.

## Preparar os dados iniciais da planilha

O conversor local usa somente a biblioteca padrão do Python e não publica nem envia a planilha:

```powershell
.\.venv\Scripts\python.exe .\scripts\prepare_household_import.py ".\Tabela inicial para o PWA.xlsx"
```

Isso cria `household-initial-import.json`, ignorado pelo Git e excluído do `dist/`. Entre no app autenticado, abra **Ajustes → Preparar dados da planilha**, selecione esse JSON e confira a prévia. Os valores só são enviados ao Supabase depois de clicar em **Confirmar importação para esta casa**. O arquivo só pode ser importado uma vez por casa; gerar novamente a partir da mesma planilha não cria cópias.

Receitas e despesas mensais entram como itens recorrentes; campos sem valor ficam pendentes para completar no app. Categorias, subcategorias e metas/limites também são preparados. Pagamentos de faturas encontrados na planilha são exibidos como itens ignorados para evitar contabilizar duas vezes as compras do cartão. A reserva continua separada das despesas de consumo.
