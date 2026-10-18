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
