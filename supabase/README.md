# Configuração do Supabase

## 1. Criar as tabelas e as políticas

As três primeiras migrações abaixo já foram aplicadas ao projeto vinculado `Casa_em_dia`. A quarta é nova e ainda precisa ser aplicada nesse projeto antes de usar as opções de cartão compartilhado. Em qualquer projeto, abra **SQL Editor** e execute nesta ordem:

1. `migrations/20261018000000_household_finances.sql`
2. `migrations/20261018160000_household_finance_model.sql`
3. `migrations/20261018173000_fix_setup_import_fingerprint.sql`
4. `migrations/20261018190000_shared_credit_card_statements.sql`

A segunda migração adiciona categorias, metas, reserva, cartões, faturas e importação inicial protegida. A terceira corrige o identificador da importação inicial. A quarta permite cadastrar uma conta/cartão geral com fatura consolidada e guardar a identificação opcional de quem fez cada compra. As migrações criam estruturas vazias e mantêm as políticas RLS que isolam os dados por casa.

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

Configure o envio de e-mails em **Authentication → SMTP Settings** antes de convidar outras pessoas. O responsável pode convidar e remover membros em **Ajustes**. Somente a função de servidor valida o papel `owner` e usa a chave `service_role`; o responsável informa apenas o e-mail. A pessoa convidada cria a própria senha pelo link recebido. Contas existentes podem usar **Esqueci ou preciso criar minha senha** na tela de login. A opção de redefinição não cria uma conta nem concede acesso a uma casa.

Na tela de entrada, **“Primeiro acesso: já recebi um convite”** solicita um link para ativar uma conta já convidada; **“Esqueci minha senha”** solicita uma redefinição. Os dois caminhos levam a uma tela de envio distinta e, depois, a uma tela de senha com título específico para ativação ou redefinição. Nenhum deles cria usuários; novos membros continuam sendo adicionados pelo responsável.

## 4. Publicar e instalar o PWA

Sirva a aplicação por HTTPS em hospedagem estática (ou por `localhost` durante o desenvolvimento). O acesso por `file://` não permite service workers e não serve para testar a instalação/offline. A URL e a chave **publishable** em `supabase-config.js` são informações públicas do cliente; a proteção dos dados vem das políticas RLS da migração.

Em **Fixos & Anuais → Cartões e faturas**, escolha **Cartão geral — vários cartões na mesma fatura** quando os cartões físicos chegam em uma única fatura. Importe o CSV consolidado; na prévia, é possível identificar quem fez cada compra, classificar a despesa e revisar valores antes de confirmar. O arquivo é lido localmente e não é enviado até a confirmação.

O CSV precisa ter as colunas `date`, `title` e `amount`; uma coluna `cardholder` (ou `card`, `holder`, `titular`) é opcional. Mesmo sem essa coluna, a pessoa/cartão adicional pode ser informada linha a linha na prévia.
