FROM node:alpine@sha256:7c6af15abe4e3de859690e7db171d0d711bf37d27528eddfe625b2fe89e097f8
RUN npm i -g @swarthy/wait-for@2.0.2
VOLUME /app
WORKDIR /app
USER node
