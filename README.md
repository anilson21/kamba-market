# Kamba Market

Marketplace de anúncios para Angola (preços em Kz, fuso Africa/Luanda).

## Como correr

```
npm install
npm run seed
npm run dev
```

O servidor fica em http://localhost:3000. A base de dados SQLite fica em `data/kamba.db`. As fotos enviadas ficam em `public/uploads/`.

## Contas de demonstração (remover antes de lançar)

O seed (`npm run seed`) cria três contas de teste, todas com a senha `demo1234`:

- admin@demo.kamba (papel: admin)
- vendedor@demo.kamba (papel: seller)
- comprador@demo.kamba (papel: buyer)

Também cria 6 anúncios marcados com `is_demo = 1` (títulos com "(DEMO)") ligados ao vendedor demo.

As contas e anúncios demo NÃO foram apagados. Para os remover antes de lançar:

1. Crie uma conta real pelo registo normal e dê-lhe o papel de admin (ou promova uma conta existente):
   `UPDATE users SET role = 'admin' WHERE email = 'o-seu-email@exemplo.com';`
   Entre com essa conta e confirme que consegue aceder ao painel de administração.
2. Pare o servidor.
3. Faça uma cópia de segurança de `data/kamba.db`.
4. Apague as contas demo. Os anúncios, favoritos, sessões e denúncias ligados a elas são apagados em cascata pela base de dados:
   `DELETE FROM users WHERE email IN ('admin@demo.kamba', 'vendedor@demo.kamba', 'comprador@demo.kamba');`
5. Apague as fotos órfãs dos anúncios demo. A cascata não apaga os ficheiros em `public/uploads/`. Os demo usam `/placeholder.svg`, por isso não há ficheiros próprios a apagar, mas confirme que não existem fotos de anúncios demo em `public/uploads/`.

Como não há cliente `sqlite3` instalado neste projeto, os comandos podem ser executados com Node, usando o `better-sqlite3` que já é dependência:

```
node -e "const db=require('better-sqlite3')('data/kamba.db'); db.prepare(\"DELETE FROM users WHERE email IN ('admin@demo.kamba','vendedor@demo.kamba','comprador@demo.kamba')\").run(); console.log('ok')"
```

Antes de correr qualquer `DELETE`, faça a cópia de segurança do passo 3.
