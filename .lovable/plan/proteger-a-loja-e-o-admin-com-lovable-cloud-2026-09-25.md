# Proteger a loja e o admin com Lovable Cloud

A senha do admin continua **Pala10@**. Só muda o que acontece por trás dela.

## Falhas encontradas hoje
1. **A lista de pedidos está aberta**: qualquer pessoa pode abrir `/api/orders` e ver nome, e-mail, telefone, CPF e endereço dos clientes, sem senha.
2. **O "passe" do admin nunca expira e é sempre igual**: é feito direto da senha, então quem conseguir copiá-lo uma vez entra para sempre.
3. **Não tem limite de tentativas** no login: alguém pode ficar chutando senhas sem parar.
4. **A senha padrão fica escrita no código** (e o código está no GitHub).
5. Pedidos e configurações ficam salvos em lugares temporários e espalhados, sem regras de acesso.

## O que vai ser feito
- Ativar o Lovable Cloud (banco de dados seguro).
- Criar tabelas para **pedidos**, **configurações do admin** (gateway, pixels, UTMify), **sessões do admin** e **tentativas de login**. Todas trancadas: ninguém lê ou escreve pelo navegador; só o servidor da loja, com a chave privada.
- Login do admin:
  - Mesma senha, guardada como segredo (`ADMIN_PIN`) e não mais escrita no código.
  - Cada login gera um passe aleatório que vale 12 horas, guardado no banco.
  - Bloqueio de 15 minutos depois de 5 senhas erradas vindas do mesmo aparelho/IP.
- `/api/orders` e tudo o que é do admin passam a exigir um passe válido.
- `/api/order` (criado pelo checkout) continua público, mas só aceita criar ou atualizar o próprio pedido, com os dados validados.
- Os pedidos atuais são copiados para o banco na primeira vez, para não perder nada.
- Ao final, rodar uma verificação de segurança.

## Não muda
Visual da loja, checkout via PIX pela Wappi, pixels/eventos, Live View, senha Pala10@.

## Detalhes técnicos
- Tabelas: `orders(id text pk, data jsonb, status, created_at, updated_at)`, `admin_settings(key text pk, value jsonb)`, `admin_sessions(token_hash text pk, expires_at)`, `login_attempts(ip text, created_at)`. RLS ligado, sem políticas para anon/authenticated; GRANT só para `service_role`.
- `admin-api.ts`: trocar `getShard/putShard` e o store remoto por `supabaseAdmin` (import dinâmico dentro dos handlers); `requireSession` compara sha256 do token com `admin_sessions`; remover o formato `pin_<hash>` e `DEFAULT_ADMIN_PIN`.
- CORS `*` de `/api/orders` removido.
- Senha comparada em tempo constante.
