#!/bin/bash

# Script para corregir autor de commits de Dyad antes de push

# Usuario correcto
NEW_NAME="franpere50248-code"
NEW_EMAIL="franpere50248@gmail.com"
OLD_NAME="tellevorider"

# Confirmar rama actual
CURRENT_BRANCH=$(git branch --show-current)
echo "📌 Rama actual: $CURRENT_BRANCH"

# Verificar commits de Dyad (tellevorider)
echo "🔍 Buscando commits de $OLD_NAME..."
COMMIT_COUNT=$(git log --format='%an' | grep -c "$OLD_NAME")

if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo "✅ No hay commits de $OLD_NAME. Nada que cambiar."
else
    echo "⚠️ Se encontraron $COMMIT_COUNT commits de $OLD_NAME. Reescribiendo autor..."

    # Reescribir commits encontrados
    git filter-branch --env-filter '
if [ "$GIT_COMMITTER_NAME" = "'"$OLD_NAME"'" ]; then
    export GIT_COMMITTER_NAME="'"$NEW_NAME"'"
    export GIT_COMMITTER_EMAIL="'"$NEW_EMAIL"'"
fi
if [ "$GIT_AUTHOR_NAME" = "'"$OLD_NAME"'" ]; then
    export GIT_AUTHOR_NAME="'"$NEW_NAME"'"
    export GIT_AUTHOR_EMAIL="'"$NEW_EMAIL"'"
fi
' --tag-name-filter cat -- --branches --tags

    echo "✅ Autor corregido correctamente."
fi

# Configurar Git para futuros commits
git config user.name "$NEW_NAME"
git config user.email "$NEW_EMAIL"
echo "📌 Configuración Git actualizada para futuros commits:"
git config user.name
git config user.email

# Hacer push forzado a GitHub
echo "🚀 Haciendo push a GitHub..."
git push --force origin "$CURRENT_BRANCH"

echo "🎉 Todos los commits de Dyad corregidos y push realizado."

