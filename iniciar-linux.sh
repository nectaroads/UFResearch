#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Instale o Node.js LTS em https://nodejs.org/ e abra este arquivo de novo.'
  printf '%s' 'Pressione Enter para fechar. '
  read -r resposta
  exit 1
fi
node iniciar.mjs "$@"
resultado=$?
if [ "$resultado" -ne 0 ]; then
  printf '%s' 'Pressione Enter para fechar. '
  read -r resposta
fi
exit "$resultado"
