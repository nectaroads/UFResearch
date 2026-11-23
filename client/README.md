# Cliente UFResearch

HTML, CSS e JavaScript. O Node.js serve os arquivos em `public/` e encaminha `/api/` para o servidor.

1. Instale o Node.js 22 ou superior.
2. Abra esta pasta no VS Code e execute `npm start` em um terminal.
3. Acesse [http://localhost:3000](http://localhost:3000).

O servidor precisa estar ativo para login, busca, equipe e publicações. Para mudar a URL da API ou a porta, copie `config.example.json` para `config.json` e edite a cópia. O arquivo `public/portal.json` contém o nome e os textos institucionais.

Veja o [guia do projeto](../README.md) para iniciar os dois serviços juntos.
