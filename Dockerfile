FROM node:20-slim

RUN apt-get update && apt-get install -y ffmpeg curl

WORKDIR /app
COPY . .
RUN npm install

CMD ["node", "server.js"]
