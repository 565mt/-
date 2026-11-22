FROM node:22-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY public ./public
COPY index.html app.tsx QuoteFlow.tsx GlobalLeadSearch.tsx SalesDesk.tsx Social.tsx Navigation.tsx CustomsDashboard.tsx style.css tsconfig.json vite.config.ts ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py workspace_accounts.py workspace_crm.py social.py photo-index.json sales_insights.py customs.py catalog.jsonl ./
COPY --from=frontend /app/dist ./dist
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]
