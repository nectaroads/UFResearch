# Servidor UFResearch

API JSON em Node.js 22 ou superior com PostgreSQL 14 ou superior e banco em UTF-8. As tabelas e a conta inicial são preparadas no primeiro início.

1. Crie um banco PostgreSQL e um usuário com permissão para criar tabelas nele.
2. Copie `config.example.json` para `config.json`. Informe o acesso ao banco e a senha inicial da coordenação.
3. Abra esta pasta no VS Code. Execute `npm ci` e depois `npm start` no terminal.
4. Confira [http://localhost:3001/api/health](http://localhost:3001/api/health). Use o cliente para acessar o portal.

Sessões têm validade de oito horas. Ao trocar uma senha no portal, as outras sessões dessa conta são encerradas. O PostgreSQL armazena também os PDFs enviados.

Veja o [guia do projeto](../README.md) para iniciar os serviços juntos com Docker.
