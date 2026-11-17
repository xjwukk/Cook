#!/usr/bin/env bash
# Cook 料理手帐 · 一键重建并发布
#
# 用法: ./deploy.sh
#
# 流程: 拉代码 → 装依赖 → convert(CSV→JSON) → build(Nuxt 静态生成) →
#       同步到 /var/www → 重启账号服务 → 冒烟测试
set -euo pipefail

PROJECT_DIR=/home/ubuntu/cook-git
WEB_ROOT=/var/www/cook.rawleycode.art
LOG="$PROJECT_DIR/server/logs/service.log"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 24.15.0 >/dev/null

echo "==> [1/6] 拉取最新代码"
cd "$PROJECT_DIR"
git fetch --depth 1 origin main
git reset --hard origin/main

echo "==> [2/6] 安装依赖"
pnpm install --frozen-lockfile

echo "==> [3/6] 构建 packages/cook（apps/web 依赖它的 dist）"
pnpm -C packages/cook run build

echo "==> [4/6] 转换菜谱数据 + 构建静态站点"
pnpm run build

echo "==> [5/6] 发布到 $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$PROJECT_DIR/dist/" "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "==> [6/6] 重启账号服务"
sudo systemctl restart cook-server.service
sleep 3
sudo systemctl is-active --quiet cook-server.service

echo
echo "==> 冒烟测试"
printf "index      : "
curl -s -o /dev/null -w "%{http_code}\n" --resolve cook.rawleycode.art:80:127.0.0.1 http://cook.rawleycode.art/
printf "build-info : "
curl -s -o /dev/null -w "%{http_code}\n" --resolve cook.rawleycode.art:80:127.0.0.1 http://cook.rawleycode.art/.well-known/cook-build.json
printf "api        : "
curl -s -o /dev/null -w "%{http_code}\n" --resolve cook.rawleycode.art:80:127.0.0.1 http://cook.rawleycode.art/api/auth/me
printf "service    : "
sudo systemctl is-active cook-server.service

echo
echo "完成。站点: https://cook.rawleycode.art"
