FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173 3001

CMD ["npm", "run", "dev:docker"]
