# Guardiões da Mata Atlântica: jornada guiada

App que o guia usa no celular para conduzir turmas pela jornada na PENAP: abertura narrada, cinco
missões, pontos por grupo, juramento e certificados. Funciona em modo avião: depois do primeiro acesso
com internet, tudo fica guardado no aparelho. Alunos não usam nem entram no app.

Baseado no protótipo e no roteiro do [guardioes-da-floresta](https://guardioes-da-floresta--diegojim69.replit.app/).

## Rodar

```sh
pnpm install
pnpm dev          # http://localhost:5180
pnpm test         # testes da camada de dados (Vitest)
pnpm test:e2e     # jornada completa e modo avião no Chrome (Playwright)
pnpm check        # tipos
```

O modo offline (service worker) só existe no build: `pnpm build && pnpm preview` (http://localhost:4180).

## Editar o roteiro

Todo texto da jornada está em [`src/lib/content/penap.ts`](src/lib/content/penap.ts): abertura, missões,
poderes, cronômetros, lista do registro, áreas do mapa, títulos da turma, conquistas e encerramento.
Para um roteiro novo (por exemplo, PETAR), copie o arquivo, ajuste os textos e registre em `journeys`.
Os ícones de cada missão vêm do [Phosphor](https://phosphoricons.com); para usar um novo, inclua em
`scripts/icons.ts` e rode `pnpm icons`.

## Backup na nuvem (Supabase, opcional)

Sem configuração, o app funciona só no aparelho. Com Supabase, o guia entra com um código de 6 dígitos
enviado por e-mail e as jornadas são copiadas para a nuvem quando há sinal. Os certificados passam a ser
verificáveis em `/verify`.

1. Copie `.env.example` para `.env` e preencha a URL do projeto e a chave publicável (`sb_publishable_...`).
   Nunca coloque a chave secreta no app.
2. Ligue o projeto e aplique as migrations (pede a senha do banco, digite você mesmo):

   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref-do-projeto>
   pnpm db:push
   pnpm db:types
   pnpm db:lint
   ```

3. E-mail do código pelo [Resend](https://resend.com):
   - No Resend, verifique o domínio (registros SPF e DKIM no DNS da Cloudflare) e crie uma chave só com
     permissão de envio. Com o remetente de teste `onboarding@resend.dev`, o Resend só entrega para o
     e-mail dono da conta.
   - Copie `supabase/.env.example` para `supabase/.env` (fora do git) e preencha `RESEND_API_KEY` e
     `SMTP_SENDER_EMAIL`.
   - Rode `pnpm db:config`: ele mostra a diferença e aplica o SMTP, o limite de e-mails e o modelo
     `supabase/templates/codigo-de-acesso.html` no projeto.

   A chave do Resend nunca vai para o app: quem envia o e-mail é o Supabase.

## Publicar

O build é um site estático (`build/`). Para Cloudflare Workers:

```sh
pnpm dlx wrangler@4.152.0 login
pnpm deploy
```

Depois, em Workers > guardioes-jornada > Domains, adicione `guardioesmataatlântica.site`. Por causa do
acento, em e-mails e QR codes ele aparece na forma técnica `xn--guardioesmataatlntica-c1b.site`; os dois
endereços levam ao mesmo lugar.

## Privacidade

Os grupos têm nomes de árvores e as fotos do registro são da natureza, não das pessoas. As fotos ficam
só no celular. Nenhum dado pessoal de aluno é coletado.
