# UFResearch

Portal de pesquisa em português para divulgar a produção acadêmica e apresentar a equipe. O início, a lista de integrantes e as publicações por tema seguem a organização do [LabV/UFF](https://labv.uff.br/). A identidade visual usa o brasão oficial da UFBA e se inspira no [portal da UFBA](https://ufba.br/), na [Escola de Administração](https://ea.ufba.br/) e no [Manual de Marca da UFBA](https://www.ufba.br/sites/portal.ufba.br/files/manual_brasaoufba-v2_0.pdf).

## Abrir o portal

Instale o [Node.js LTS](https://nodejs.org/) uma vez. Se recebeu o projeto compactado, extraia a pasta inteira antes de abrir.

- **Windows 64 bits (x64)**. Dê dois cliques em `iniciar-windows.cmd`.
- **Linux (x64 ou ARM64)**. Abra `abrir-ufresearch.desktop` e permita a execução se o gerenciador de arquivos pedir. Se ele não oferecer essa opção, abra um terminal na pasta e rode `sh iniciar-linux.sh`.

O iniciador baixa os componentes na primeira abertura, prepara o PostgreSQL e abre o portal no navegador. Em uma cópia nova, a janela pede que você escolha o login e a senha iniciais da coordenação. Em uma pasta já configurada, ele usa a configuração da coordenação disponível.

Mantenha a janela de inicialização aberta enquanto usa o portal. Para fechar, volte a ela e pressione **Enter**. Abra o mesmo arquivo na próxima vez. As contas, publicações e PDFs são guardados na pasta `data/`.

## Como usar

1. Em **Minha conta**, a coordenação pode editar seu perfil, criar as contas da equipe e aprovar o acesso de cada uma. O cadastro pede nome completo, login, senha, currículo Lattes e nível de estudo. A matrícula é opcional. Colaboradores externos podem publicar se forem aprovados.
2. Em **Publicações**, a coordenação cria temas. As contas aprovadas podem publicar dentro de um tema usando título, revista, autores, ano e um link para download ou um PDF de até 10 MB.
3. Cada integrante pode editar o próprio perfil e editar ou remover suas próprias publicações. A coordenação também pode editar os perfis da equipe, inclusive redefinir a senha de um integrante.
4. Qualquer visitante pode pesquisar temas, publicações e integrantes, consultar o Lattes de quem está na equipe e baixar os arquivos disponibilizados. Login e matrícula dos integrantes ficam restritos à própria conta e à coordenação.

## Abrir em duas janelas do VS Code

Abra [client](client/) em uma janela e [server](server/) na outra. O cliente usa HTML, CSS e JavaScript sem framework. O servidor usa Node.js e PostgreSQL.

Para rodar direto pelo VS Code, sem os contêineres do cliente e da API, disponibilize um PostgreSQL local com banco e usuário conforme `server/config.json`. Se usar Docker para o banco nessa modalidade, publique a porta do banco explicitamente, ou use um PostgreSQL já instalado. Em seguida, inicie a API e o cliente em terminais separados:

| Pasta | Comandos | Porta |
| --- | --- | --- |
| [server](server/) | `npm ci`, depois `npm start` | 3001 |
| [client](client/) | `npm start` | 3000 |

O cliente encaminha os pedidos de API ao servidor. Ajuste a porta e o destino em `client/config.json` para execução direta. Personalize a apresentação inicial em [client/public/portal.json](client/public/portal.json).

## GitHub e hospedagem

O [GitHub Pages](https://nectaroads.github.io/UFResearch/) publica o cliente pelo workflow `pages.yml`. A API Node.js e o PostgreSQL rodam em outra hospedagem. Enquanto a URL da API não estiver configurada, o Pages apresenta a parte institucional.

1. Restaure o backup em um PostgreSQL da nova hospedagem ou crie um banco vazio. Use um banco dedicado ao projeto.
2. Na hospedagem da API, execute `npm ci` e `npm start` na pasta `server/`, ou implante o [Dockerfile](server/Dockerfile) dessa pasta. Configure `NODE_ENV=production`, um `DATABASE_URL` com o acesso privado ao banco e `UFRESEARCH_WEB_ORIGIN=https://nectaroads.github.io`. A hospedagem deve oferecer HTTPS e pode informar a porta com `PORT`.
3. Se o banco estiver vazio, defina também `UFRESEARCH_COORDINATOR_LOGIN` e `UFRESEARCH_COORDINATOR_PASSWORD` nos segredos da hospedagem. Remova esses dois valores após o primeiro início. Em uma migração, a conta restaurada continua valendo. Para atualizar a senha, use **Minha conta**.
4. No repositório, crie a variável de Actions `UFRESEARCH_API_URL` com a origem HTTPS da API, sem barra final. Execute novamente o workflow **Publicar portal no GitHub Pages**.

O repositório ignora as configurações locais, o banco, os backups e as dependências instaladas. O workflow publica somente a interface. As sessões do portal hospedado ficam na memória da aba, então recarregar a página pede novo login.

### Migrar o PostgreSQL

Instale as [ferramentas do PostgreSQL](https://www.postgresql.org/download/) com `pg_dump` e `pg_restore` no PATH. Use a mesma versão principal do PostgreSQL de origem ou uma versão mais recente. O iniciador local usa PostgreSQL 18.

1. Abra o portal local e deixe a janela do iniciador aberta. Em outro terminal, execute `node banco.mjs backup`. O comando usa `data/database.json`; para um banco gerenciado separadamente, passe o caminho do JSON como argumento.
2. Reserve um banco **vazio** na nova hospedagem e crie, localmente, um arquivo `config.json` fora do repositório com os campos `host`, `port`, `database`, `user` e `password`. Para um serviço com TLS, informe também `sslmode: "verify-full"` e, se o provedor pedir, `sslrootcert` com o caminho do certificado.
3. Execute `node banco.mjs restore caminho/do/banco.dump caminho/do/config.json`. O terminal informa o caminho do backup no passo anterior. O backup inclui perfis, contas com senhas protegidas por hash, publicações e os PDFs. Sessões anteriores ficam de fora.
4. Aponte `DATABASE_URL` da API para o destino, teste o login e confira os dados antes de retirar o banco anterior de uso.

Guarde backups em um local com acesso restrito. Consulte as opções de [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) e [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

### Docker para desenvolvimento

O Compose continua disponível para quem já usa Docker. Execute `node setup.mjs` e depois `docker compose up --build`. O Compose guarda os dados no volume `postgres-data`. O iniciador local usa a pasta `data/`. Se você já lançou dados em um deles e quer passar para o outro, faça a migração do PostgreSQL antes de mudar.

## Créditos

- [Brasão da UFBA](https://www.ufba.br/sites/portal.ufba.br/files/brasao_ufba.png), arquivo do portal oficial.
- [Foto da fachada da Reitoria](https://commons.wikimedia.org/wiki/File:Fachada_do_Pal%C3%A1cio_da_Reitoria_da_Universidade_Federal_da_Bahia_%28UFBA%29.jpg), de Guimarães Mota, sob [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). O portal recorta a exibição da foto para se ajustar à tela.
