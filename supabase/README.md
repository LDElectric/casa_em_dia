# Configuração do Supabase

## 1. Criar as tabelas e as políticas

As cinco primeiras migrações abaixo já foram aplicadas ao projeto vinculado `Casa_em_dia`. A quinta cria o controle mensal simplificado e prepara os lançamentos existentes como itens mensais, sem apagar as tabelas originais. A sexta adiciona recorrências mensais e variáveis e o total declarado das faturas. A sétima separa receitas fixas e variáveis em cada mês. A oitava impede modelos fixos duplicados. A nona define o mês financeiro (virada do mês e competência manual). Em qualquer projeto, abra **SQL Editor** e execute nesta ordem:

1. `migrations/20261018000000_household_finances.sql`
2. `migrations/20261018160000_household_finance_model.sql`
3. `migrations/20261018173000_fix_setup_import_fingerprint.sql`
4. `migrations/20261018190000_shared_credit_card_statements.sql`
5. `migrations/20261018230000_monthly_control.sql`
6. `migrations/20261023190000_recurring_monthly_statements.sql`
7. `migrations/20261024120000_income_behavior.sql`
8. `migrations/20261025120000_recurring_item_consistency.sql`
9. `migrations/20261026120000_financial_month.sql`

A segunda migração adiciona categorias, metas, reserva, cartões, faturas e importação inicial protegida. A terceira corrige o identificador da importação inicial. A quarta permite cadastrar uma conta/cartão geral com fatura consolidada e guardar a identificação opcional de quem fez cada compra. A quinta cria os valores mensais por item e copia os lançamentos existentes para essa visão resumida; os registros originais permanecem intactos. A sexta materializa modelos fixos e variáveis no mês selecionado, preserva valores variáveis por mês e armazena o total da fatura separado das compras. A sétima grava em cada mês se a receita é fixa ou variável, inclusive para receitas avulsas. A oitava pausa modelos duplicados e cria um índice único para manter um único modelo ativo por nome, tipo e grupo. A nona adiciona `households.finance_month_cutoff_day` (virada do mês financeiro, 1 = desligada) e `transactions.competence_month` (competência escolhida manualmente, para contas pagas antecipadamente). Todas as tabelas mantêm políticas RLS que isolam os dados por casa.

## 2. Preparar a primeira conta

Em **Authentication → Users**, convide o e-mail do responsável pela casa. O app não oferece cadastro público. O responsável abre o convite, define a própria senha e então cria a casa; não compartilhe senhas por e-mail ou pelo app.

Em **Authentication → URL Configuration**, configure `https://casa-em-dia-7l4.pages.dev/` como **Site URL** e permita `https://casa-em-dia-7l4.pages.dev/**` na lista de URLs de redirecionamento. Para desenvolvimento local, permita o callback equivalente em `localhost`. Configure também em **Authentication → Password** uma senha mínima de pelo menos 12 caracteres. Desative novos cadastros públicos; crie o primeiro usuário em **Authentication → Users**.

## 3. Publicar a função de convites

Com a Supabase CLI autenticada no projeto, publique a função:

```powershell
supabase login
supabase link --project-ref seu-project-ref
supabase secrets set APP_SITE_URL=https://casa-em-dia-7l4.pages.dev/
supabase functions deploy manage-household-member --use-api
```

Para outro domínio, atualize `APP_SITE_URL` e permita esse domínio na lista de redirecionamentos do Supabase.

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas ao ambiente das Edge Functions pelo Supabase. A chave de serviço deve permanecer exclusivamente nesse ambiente; nunca a copie para o HTML, para `supabase-config.js` ou para o navegador.

Configure o envio de e-mails em **Authentication → SMTP Settings** antes de convidar outras pessoas. O responsável pode convidar e remover membros em **Ajustes**. Somente a função de servidor valida o papel `owner` e usa a chave `service_role`; o responsável informa apenas o e-mail. Contas existentes podem usar **Esqueci ou preciso criar minha senha** na tela de login. A opção de redefinição não cria uma conta nem concede acesso a uma casa.

A função de convites atende os dois casos:

- **e-mail sem conta** — envia o convite do Supabase Auth para a pessoa criar a senha e insere o vínculo em `household_members`;
- **e-mail que já tem conta** — não usa `inviteUserByEmail` (o Supabase recusa e-mail já cadastrado); localiza a conta com `auth.admin.listUsers`, insere o vínculo da casa e responde com uma mensagem explicando que a pessoa deve entrar com a senha que já usa. Se a conta já pertencer a outra casa, a função responde 409 com instrução para sair da outra casa primeiro, porque `household_members.user_id` é chave primária: **uma conta participa de uma casa por vez**.

Por isso, desative o cadastro público em **Authentication → Sign In / Providers → Allow new users to sign up**. Com o cadastro aberto, alguém pode criar uma conta sozinho e o app abre a tela **Crie sua casa**, deixando a pessoa numa casa vazia — e a partir daí ela não vê os lançamentos da casa já existente. Se isso acontecer, o responsável convida o e-mail em **Ajustes → Membros** e o vínculo é criado na hora.

Na tela de entrada, **“Primeiro acesso: já recebi um convite”** solicita um link para ativar uma conta já convidada; **“Esqueci minha senha”** solicita uma redefinição. Os dois caminhos levam a uma tela de envio distinta e, depois, a uma tela de senha com título específico para ativação ou redefinição. Nenhum deles cria usuários; novos membros continuam sendo adicionados pelo responsável.

## 4. Publicar e instalar o PWA

Sirva a aplicação por HTTPS em hospedagem estática (ou por `localhost` durante o desenvolvimento). O acesso por `file://` não permite service workers e não serve para testar a instalação/offline. A URL e a chave **publishable** em `supabase-config.js` são informações públicas do cliente; a proteção dos dados vem das políticas RLS da migração.

Na tela **Mês**, abra **Receitas**, **Gastos fixos**, **Gastos variáveis** ou **Gastos adicionais** e adicione cada item diretamente no grupo com apenas nome e valor, sem selecionar categoria ou subcategoria. Confira subtotais, total e saldo. **Trazer os itens do mês anterior** copia apenas os nomes; os valores ficam em branco para o preenchimento do mês. Os grupos também mostram as compras de cartão incluídas no total; mova uma compra entre fixos, variáveis e adicionais pelo seletor da própria linha.

Na tela **Mês → Faturas de cartão**, toque em **＋ Novo cartão** para cadastrar em um único campo (nome) e, no mesmo fluxo, já abrir a importação com o cartão selecionado e o vencimento sugerido. Cada cartão cadastrado tem seu próprio botão **Importar fatura** nesse painel e também em **Fixos → Cartões e faturas**. Escolha um CSV consolidado, PDF com texto selecionável ou OFX; o vencimento é sugerido pela última fatura (+1 mês) e, quando o nome do arquivo tiver uma data, como `Fatura_2026-11-07.ofx`, ela prevalece. Na prévia, revise o total em aberto, identifique quem fez cada compra e confirme ou corrija as sugestões de categoria. Para OFX, o total em aberto é lido do saldo `LEDGERBAL`; quando o arquivo não traz esse saldo, o app usa a soma das compras e dos estornos, sem as linhas de pagamento. Para CSV, a sugestão é a soma das compras e estornos; se houver uma fatura anterior importada, o pagamento dela é desconsiderado. Confira o valor antes de salvar. A classificação é conservadora e compras sem correspondência ficam marcadas para revisão. O arquivo é lido localmente e não é enviado até a confirmação. PDFs digitalizados como imagem não têm OCR e precisam ser convertidos em texto antes da importação. O cadastro e a edição dos cartões continuam em **Fixos → Cartões e faturas**.

O CSV precisa ter as colunas `date`, `title` e `amount`; uma coluna `cardholder` (ou `card`, `holder`, `titular`) é opcional. Valores com vírgula decimal, como `"69,54"`, e marcadores de parcela no nome, como `Parcela 9/10`, são interpretados. O vencimento é sugerido quando o nome do arquivo contém uma data `AAAA-MM-DD` (por exemplo, `Fatura_2026-11-07.csv`), mas confira antes de analisar.

O total em aberto informado pelo OFX/PDF (ou conferido na prévia) aparece no card da fatura; o card também mostra a soma das compras classificadas. No resumo de caixa do mês, o total da fatura é uma saída no mês do vencimento, compensando as receitas daquele mês. As compras individuais continuam organizadas por categoria e data de compra nos grupos e insights, sem serem somadas outra vez ao fluxo de caixa. As parcelas restantes da fatura mais recente são previstas automaticamente nos meses seguintes e entram no total e no grupo da compra até a fatura do período ser importada; quando já existe uma fatura importada para o mesmo cartão e mês, a previsão não é somada de novo. Uma parcela `9/10` de `R$ 69,54` entra na fatura importada e prevê mais `R$ 69,54` no vencimento seguinte. Linhas de pagamento recebido não contam como despesa; estornos continuam abatendo o grupo variável por padrão e podem ser movidos se necessário. Não lance manualmente o total da fatura como outra despesa. Receitas recorrentes podem ser marcadas como fixas ou variáveis em **Fixos → Receitas fixas e variáveis**; o card de receitas do mês separa as duas origens.
