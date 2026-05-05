#!/bin/sh
# This file is sourced by the Jupyter Docker stack startup script, so avoid
# changing global shell options here.

settings_dir="/home/jovyan/.jupyter/lab/user-settings/@jupyterlab/apputils-extension"
settings_file="${settings_dir}/themes.jupyterlab-settings"
theme="${JUPYTERLAB_DEFAULT_THEME:-JupyterLab Dark}"

mkdir -p "$settings_dir"

if [ ! -f "$settings_file" ]; then
  cat > "$settings_file" <<EOF
{
  "theme": "$theme",
  "theme-scrollbars": true
}
EOF
fi
