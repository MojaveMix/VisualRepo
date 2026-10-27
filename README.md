<div align="center">

<img src="docs/banner.svg" alt="VisualRepo — Evidence-Cited AI Codebase Explorer & Architecture Visualizer" width="100%"/>

<br/>

![Java](https://img.shields.io/badge/Java-21-f89820?style=for-the-badge&logo=openjdk&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.3-6db33f?style=for-the-badge&logo=springboot&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.4-4479a1?style=for-the-badge&logo=mysql&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-Structured_Outputs-818cf8?style=for-the-badge)

**Index a GitHub repo → see its architecture → ask questions → get answers with receipts.**

[Quick Start](#-quick-start) · [Tech Stack](#-tech-stack) · [How It Works](#-how-it-works)

</div>

---

> **VisualRepo** indexes GitHub repositories, extracts language-specific symbols and dependency graphs, visualizes the architecture interactively with **React Flow**, and answers engineering questions using **Ollama Structured Outputs** where every claim cites **exact source files and 1-based line ranges (`Lstart-Lend`)**.

## ✨ Highlights

| | Feature |
|---|---|
| 🗺️ | **Interactive architecture graph** powered by React Flow, grouped into layers (UI → Controller → Service → Repository → Model) |
| 🔎 | **Two-stage retrieval**: lexical + symbol/dependency indexing, then dense embeddings with cosine-similarity hybrid search |
| 📌 | **Evidence-cited answers**: every claim is verified server-side against exact file paths and `Lstart-Lend` line ranges |
| 🗄️ | **Zero-friction database**: MySQL (XAMPP or Docker) with an automatic local fallback |

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS v4, React Flow (`@xyflow/react`), Lucide Icons |
| **Backend** | Java 21, Spring Boot 3.3, Spring Data JPA, Validation |
| **Repository Access** | GitHub REST API (`/repos/{owner}/{repo}`, recursive Git trees, raw/blob content) |
| **Code Analysis** | File-tree parsing & language-specific rules (Java, TypeScript/JavaScript, Python, Config) |
| **AI & Citations** | Ollama `/api/chat` with strict JSON Schema structured outputs + Server-side line-range verifier |
| **Retrieval (2-Stage)** | **Stage 1**: Basic lexical + AST symbol & dependency graph indexing<br>**Stage 2**: Dense Embeddings (`/api/embed`) + Cosine Similarity Vector Hybrid search |
| **Database** | MySQL 8.4 (with automatic local MySQL-compatible fallback if port `3306` is offline) |

---

## 🧭 How It Works

```mermaid
flowchart LR
    A["GitHub Repo"] --> B["Index & Parse<br/>symbols + dependencies"]
    B --> C[("MySQL")]
    C --> D["Architecture Graph<br/>React Flow"]
    C --> E["Hybrid Retrieval<br/>lexical + embeddings"]
    E --> F["Ollama<br/>Structured Output"]
    F --> G["Citation Verifier<br/>file + Lstart-Lend"]
    G --> H["Cited Answer"]
```

---

## 🚀 Quick Start

### 1. Start Infrastructure (Optional if using local Ollama)
```bash
docker compose up -d mysql
```
> [!NOTE]
> If MySQL on `:3306` is not running, the backend automatically falls back to a persistent MySQL-compatible database in `./backend/data/visualrepo_db` so you can run immediately without Docker.

### 2. Run the Spring Boot 3 Backend (Java 21)
```bash
cd backend
mvn spring-boot:run
```
The backend starts at `http://localhost:8080` and automatically indexes the multi-language showcase repository (`demo/order-payment-platform`) on first startup.

### 3. Run the React + Vite Frontend
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** in your browser.
