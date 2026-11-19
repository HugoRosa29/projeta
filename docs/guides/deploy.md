# Implantação no Dokploy

Produção usa `docker-compose.prod.yml`. O `docker-compose.yml` continua sendo o de desenvolvimento local e não deve ser usado no servidor.

Diferenças do arquivo de produção:

- Nenhuma porta é publicada no host. O banco e a API só são acessíveis pela rede interna do Compose; o Dokploy encaminha o domínio para o serviço `web` na porta interna 80.
- O PostgreSQL não tem `container_name` fixo, para não conflitar com outras instalações no mesmo servidor.
- `POSTGRES_PASSWORD` é obrigatória: sem ela, o Compose recusa subir. A mesma variável compõe a `DATABASE_URL` da API.

Os serviços `db`, `api` e `web`, o volume `projeta-pgdata`, os healthchecks e a ordem de partida (`db` saudável → `api` saudável → `web`) são os mesmos do desenvolvimento. O Nginx do `web` serve a interface e faz proxy de `/api/` e `/health` para `api:8000` (ver `frontend/nginx.conf`). As migrações são aplicadas quando a API inicia.

## Passo a passo

No serviço Compose do projeto (ex.: `projeta-compose`), com a branch `main`:

1. **General → Compose Path:** troque `./docker-compose.yml` por `./docker-compose.prod.yml` e salve.
2. **Environment:** defina as variáveis abaixo. Não grave valores reais no repositório.

   ```dotenv
   POSTGRES_PASSWORD=<senha longa, aleatória e alfanumérica>
   COOKIE_SECURE=true
   ```

   A senha entra na URL de conexão (`postgresql://projeta:<senha>@db:5432/projeta`) sem escape. Use só letras e números, com pelo menos 32 caracteres; símbolos como `@`, `:`, `/`, `#` ou `%` quebram a URL. Para gerar uma:

   ```bash
   openssl rand -hex 32
   ```

   A senha só é aplicada ao banco na primeira inicialização do volume. Para trocá-la depois, altere-a também dentro do PostgreSQL (`ALTER USER projeta PASSWORD '...'`) antes de mudar o Environment.

   `COOKIE_SECURE=true` é obrigatório quando o domínio usa HTTPS: o cookie de sessão passa a ser enviado só por conexão segura. Deixe `false` apenas em acesso por HTTP simples.

3. **Domains:** adicione o domínio com **Service Name** `web` e **Container Port** `80`. Ative HTTPS (Let's Encrypt) se o domínio for público.
4. Faça o deploy pela interface do Dokploy.

## Variáveis opcionais

Mesmos nomes e padrões do desenvolvimento (ver `.env.example`):

| Variável | Padrão | Uso |
| --- | --- | --- |
| `GIA_SERVICE` | `http://gia-api` | Endereço do GIA, precisa ser alcançável a partir do servidor |
| `GIA_ENDPOINT` | `/auth/autenticar` | Rota de autenticação do GIA |
| `GIA_SYSTEM_ID` | `653` | Código do sistema no GIA |
| `GIA_VERIFY_SSL` | `true` | Verificação de certificado do GIA |
| `ASSISTANT_PROVIDER` | `mock` | `openai` para o assistente real |
| `OPENAI_API_KEY` | vazio | Chave do provedor, quando `ASSISTANT_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-5-mini` | Modelo do provedor |

O `docker-compose.override.yml` local (que fixa `gia-api` a um IP) não é versionado nem usado em produção. Se o servidor não resolver `gia-api`, aponte `GIA_SERVICE` para um nome ou IP que ele alcance — observando que o GIA roteia pelo nome do host.

## Validação local do arquivo

```bash
POSTGRES_PASSWORD=apenasvalidacao docker compose -f docker-compose.prod.yml config -q
```

Use uma senha fictícia só para essa checagem. Sem `POSTGRES_PASSWORD`, o comando falha com a mensagem pedindo a variável.

## Ainda não validado

Este guia descreve a configuração; o deploy em si, backups e restauração do volume `projeta-pgdata` e a operação de produção ainda precisam ser validados.
