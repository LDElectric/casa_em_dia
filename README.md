# Casa em Dia

PWA estático para organizar as finanças de uma casa. Os lançamentos e as contas dos membros ficam no Supabase; este repositório contém somente o código, a migração do banco e a função segura de convites.

## Conteúdo publicado

O comando `npm run build` copia para `dist/` somente os arquivos públicos necessários para o site. A saída não inclui `supabase.txt`, credenciais privadas, `node_modules`, migrações ou código das Edge Functions. A chave publishable e a URL do projeto em `supabase-config.js` são configurações públicas do cliente; a autorização dos dados depende das políticas RLS.

## Publicar gratuitamente no Cloudflare Pages

1. O projeto **Pages** `casa-em-dia` está publicado em [casa-em-dia-7l4.pages.dev](https://casa-em-dia-7l4.pages.dev/).
2. Configure o comando de build como `npm run build` e o diretório de saída como `dist` caso conecte este projeto ao GitHub para deploy automático.
3. Cada push em `main` publica o app se o projeto Pages estiver conectado ao repositório. Para testar localmente, use `npm run pages:dev`; para publicar pela CLI, autentique o Wrangler com `npx wrangler login` e execute `npm run pages:deploy`.
4. Configure a URL HTTPS do Pages e o domínio publicado em Supabase **Authentication → URL Configuration**.

O projeto não depende de Workers pagos nem publica arquivos privados do banco. O Pages e a CDN servem apenas a saída estática do PWA; autenticação, dados e convites permanecem no Supabase.

O acesso é por e-mail e senha, sem cadastro público. O responsável adiciona membros pelo e-mail; cada pessoa recebe um convite e define sua própria senha. Convites e redefinições de senha usam callbacks que precisam estar permitidos na configuração de URLs do Supabase; veja [`supabase/README.md`](./supabase/README.md).

O controle mensal suporta receitas e despesas recorrentes, com valores variáveis registrados separadamente em cada mês e cada receita marcada como fixa ou variável. Em **Mês**, cada item lançado tem o botão **Ajustar**, que abre um diálogo para mudar nome e valor, escolher entre **Avulsa**, **Fixa** ou **Variável**, corrigir o grupo (Fixos, Variáveis ou Adicionais) e excluir o item sem perder o histórico; em **Fixos** os modelos podem ser pausados, reativados ou removidos. Itens excluídos do mês continuam recuperáveis por **Restaurar itens removidos deste mês** e voltam ao serem cadastrados com o mesmo nome. Faturas podem ser importadas por CSV, PDF com texto selecionável ou OFX; o total em aberto conta como saída no mês do vencimento, enquanto as compras classificadas alimentam os grupos e insights sem duplicar o caixa. A migração mais recente do Supabase deve ser aplicada antes de usar essa interface; veja [`supabase/README.md`](./supabase/README.md).

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
