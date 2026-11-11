FROM node:24.22.2-alpine

WORKDIR /app

# 账号服务只用 Node 内置模块，没有依赖需要安装。
COPY server/package.json ./package.json
COPY server/src ./src

RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    COOK_DB_PATH=/data/cook.sqlite

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "src/index.mjs"]
