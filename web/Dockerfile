FROM node:18-bullseye

WORKDIR /app

COPY web/package*.json ./

RUN npm install

COPY web/. .

EXPOSE 5173

CMD ["npm", "run", "dev"]
