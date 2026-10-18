# Casa em Dia

PWA estático para organizar as finanças de uma casa. Os lançamentos e as contas dos membros ficam no Supabase; este repositório contém somente o código, a migração do banco e a função segura de convites.

## Conteúdo publicado

O comando `npm run build` copia para `dist/` somente os arquivos públicos necessários para o site. A saída não inclui `supabase.txt`, credenciais privadas, `node_modules`, migrações ou código das Edge Functions. A chave publishable e a URL do projeto em `supabase-config.js` são configurações públicas do cliente; a autorização dos dados depende das políticas RLS.

## Publicar gratuitamente no Cloudflare Pages

1. Crie um projeto **Pages** conectado a este repositório GitHub.
2. Configure o comando de build como `npm run build` e o diretório de saída como `dist`.
3. Cada push em `main` publica o app no domínio `*.pages.dev`. Para testar localmente, use `npm run pages:dev`; para publicar pela CLI, autentique o Wrangler com `npx wrangler login` e execute `npm run pages:deploy`.
4. Configure a URL HTTPS do Pages e o domínio publicado em Supabase **Authentication → URL Configuration**.

O projeto não depende de Workers pagos nem publica arquivos privados do banco. O Pages e a CDN servem apenas a saída estática do PWA; autenticação, dados e convites permanecem no Supabase.

## Alternativa: GitHub Pages

O workflow `.github/workflows/deploy-github-pages.yml` constrói e publica automaticamente a pasta `dist/` após pushes em `main`. No GitHub, abra **Settings → Pages** e escolha **GitHub Actions** como origem da publicação. A URL será `https://ldelectric.github.io/casa_em_dia/`.

Se usar a URL padrão do GitHub Pages, autorize-a também nas URLs de redirecionamento do Supabase. A URL `APP_SITE_URL` usada pela função de convites precisa conter o caminho do projeto: `https://ldelectric.github.io/casa_em_dia/`. Para Cloudflare Pages, use o endereço HTTPS do projeto Pages com a barra final.

## Configurar dados e autenticação no Supabase

Siga [`supabase/README.md`](./supabase/README.md) para:

- aplicar manualmente a migração SQL com tabelas vazias e políticas RLS;
- convidar a conta responsável inicial;
- configurar login por link mágico e SMTP;
- publicar a Edge Function de convites com o segredo `service_role` mantido no Supabase.

Não coloque senhas do banco, `service_role`, `secret` ou outras chaves administrativas no GitHub, no código cliente ou em variáveis de build públicas. O `.gitignore` ignora o arquivo local `supabase.txt`.
