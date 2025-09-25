#!/bin/bash

# Script para reemplazar autor Dyad y hacer push a GitHub
# -------------------------------------------------------

# Configuración del usuario correcto
NEW_NAME="franpere50248-code"
NEW_EMAIL="franpere50248@gmail.com"
OLD_NAME="tellevorider"

# Confirmar que estás en la rama correcta
CURRENT_BRANCH=$(git branch --show-current)
echo "📌 Rama actual: $CURRENT_BRANCH"

# Verificar si hay commits con "tellevorider"
echo "🔍 Buscando commits de $OLD_NAME..."
COMMIT_COUNT=$(git log --format='%an' | grep -c "$OLD_NAME")

if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo "✅ No hay commits de $OLD_NAME. Nada que cambiar."
else
    echo "⚠️ Se encontraron $COMMIT_COUNT commits de $OLD_NAME. Reescribiendo autor..."

    # Reescribir commits antiguos con filter-branch
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

    echo "✅ Autor reescrito correctamente."
fi

# Configurar Git para commits futuros
git config user.name "$NEW_NAME"
git config user.email "$NEW_EMAIL"
echo "📌 Configuración Git actualizada para futuros commits:"
git config user.name
git config user.email

# Crear un commit vacío de prueba para verificar
git commit --allow-empty -m "Commit de prueba con autor correcto" || true

# Push forzado para actualizar GitHub
echo "🚀 Haciendo push a GitHub..."
git push --force origin "$CURRENT_BRANCH"

echo "🎉 Todos los commits de Dyad reemplazados por $NEW_NAME <$NEW_EMAIL> y push realizado."

