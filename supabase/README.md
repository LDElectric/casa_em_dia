# Configuração do Supabase

## 1. Criar as tabelas e as políticas

No Supabase, abra **SQL Editor** e execute o conteúdo de `migrations/20261018000000_household_finances.sql`. A migração cria as tabelas da casa, os lançamentos e os itens recorrentes, além das políticas RLS que isolam os dados por casa.

## 2. Preparar a primeira conta

Em **Authentication → Users**, convide o e-mail do responsável pela casa. O app aceita apenas contas já convidadas; não cria contas públicas. Depois que o responsável entrar pelo link mágico, o app solicitará o nome da casa e criará a primeira associação como `owner`.

Em **Authentication → URL Configuration**, configure o domínio HTTPS onde o app será publicado como **Site URL** e inclua-o na lista de URLs de redirecionamento permitidas. Para desenvolvimento local, use um endereço `localhost`.

## 3. Publicar a função de convites

Com a Supabase CLI autenticada no projeto, publique a função:

```powershell
supabase login
supabase link --project-ref seu-project-ref
supabase functions deploy manage-household-member
supabase secrets set APP_SITE_URL=https://seu-dominio-do-app
```

Para o GitHub Pages padrão deste repositório, configure `APP_SITE_URL` como `https://ldelectric.github.io/casa_em_dia/`. Para o Cloudflare Pages, use a URL HTTPS `*.pages.dev/`. Inclua a URL de callback correspondente nas URLs de redirecionamento permitidas em **Authentication → URL Configuration**.

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas ao ambiente das Edge Functions pelo Supabase. A chave de serviço deve permanecer exclusivamente nesse ambiente; nunca a copie para o HTML, para `supabase-config.js` ou para o navegador.

Configure o envio de e-mails em **Authentication → SMTP Settings** antes de convidar outras pessoas. O responsável pode convidar e remover membros em **Ajustes**; cada membro usa seu próprio link de acesso.

## 4. Publicar e instalar o PWA

Sirva a aplicação por HTTPS em hospedagem estática (ou por `localhost` durante o desenvolvimento). O acesso por `file://` não permite service workers e não serve para testar a instalação/offline. A URL e a chave **publishable** em `supabase-config.js` são informações públicas do cliente; a proteção dos dados vem das políticas RLS da migração.
