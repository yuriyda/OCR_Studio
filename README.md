# OCR Service

Self-hosted веб-сервис распознавания PDF и изображений на базе PaddleOCR PPStructureV3.

## Возможности

- Распознавание PDF и изображений (PNG, JPG, BMP, TIFF, WEBP) с поддержкой таблиц
- Организация документов по проектам (создание, переименование, удаление, перемещение)
- Постоянное хранение исходников и результатов (SQLite + файловая система)
- Форматы вывода: Markdown, TXT, DOCX
- Три режима просмотра: страницы исходника (Pages), исходный markdown/txt (Source), отрендеренный HTML (Rendered)
- Скачивание одного документа или всего проекта одним ZIP-архивом
- Копирование результата в буфер обмена одной кнопкой
- Прогресс распознавания по страницам с elapsed/ETA
- Status bar с информацией об окружении (GPU, CUDA, VRAM, статус движка)
- Восстановление прерванных задач после рестарта сервиса
- Автоматическая очистка orphan-файлов на диске
- Drag-and-drop для загрузки файлов и для перемещения документов между проектами
- Toast-уведомления вместо блокирующих alert
- Контекстные dropdown-меню для управления проектами и документами

## Быстрый старт

### Локально (production preview)

Требуется Node 20+ и Python 3.10+.

```bash
# Сборка frontend
npm install
npm run build

# Установка backend
pip install -r requirements.txt

# Запуск
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Открыть `http://localhost:8000` в браузере.

Данные хранятся в `./data/` рядом с `app/` (SQLite + файлы документов).

### Frontend dev (HMR)

В одном терминале — frontend dev-сервер на 5173 с HMR (proxy `/api` → backend):

```bash
npm run dev
```

В другом — backend на 8100:

```bash
OCR_DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8100
```

Открыть `http://localhost:5173`.

### Type-check / тесты

```bash
npm run type-check     # tsc --noEmit
npm test               # type-check + vitest run
pytest tests/          # backend
```

### Docker

**Предварительно:**
- Установить [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) — без него `docker compose up` упадёт на стадии резервирования GPU.
- Создать `data/` заранее, чтобы Docker не создал её root-владельцем:
  ```bash
  mkdir -p data
  ```

**Запуск:**

```bash
docker compose up --build
```

После остановки данные сохраняются в `./data/` (bind mount, относительно расположения `docker-compose.yml`). База `data.db` и папка `data/docs/<doc_id>/` переживают `docker compose down`.

## Архитектура

| Модуль | Назначение |
|---|---|
| `app/db.py` | SQLite-схема и миграции |
| `app/storage.py` | `ProjectRepo`, `DocumentRepo` |
| `app/files.py` | Операции на файловой системе |
| `app/ocr_engine.py` | Обёртка над PPStructureV3 + page-level progress callback + фикс порядка колонок таблиц |
| `app/converters.py` | md → txt, md → docx |
| `app/preview.py` | md/docx → HTML, sanitization через bleach |
| `app/system.py` | Информация об окружении (nvidia-smi) |
| `app/main.py` | FastAPI: маршруты, worker, lifespan, batch-zip |
| `app/static/index.html` + `app/static/js/*.js` | Frontend (vanilla ES modules) |

### Frontend (`app/static/src/`)

| Модуль | Назначение |
|---|---|
| `main.ts` | Точка входа, wiring всех модулей |
| `api.ts` | Типизированный fetch-клиент к backend API |
| `state.ts` | localStorage state (uiLang, panelSizes, sortMode, activeProjectId) |
| `i18n.ts` + `i18n/{ru,en}.json` | Переключаемые RU/EN bundles + applyI18nToDom |
| `types.ts` | Project / Document / SystemInfo / response shapes |
| `projects.ts` / `documents.ts` | Sidebar renderers |
| `source.ts` | Source pane (исходный документ крупно) |
| `preview.ts` | Result pane с адаптивными табами по format |
| `statusbar.ts` | Status bar (engine/env/project) |
| `modal.ts` | prompt / confirm dialogs (заменяют нативные) |
| `toast.ts` | Toasts с иконками ✓⚠ℹ + Esc-close |
| `menu.ts` | Context menus с role=menu/menuitem |
| `splitter.ts` | split.js wrapper для resizable панелей |
| `drag.ts`, `polling.ts`, `clipboard.ts`, `validation.ts`, `icons.ts` | Утилиты |

Сборка: Vite + TypeScript (strict) + Tailwind CSS. Output → `app/static/dist/` (gitignored).

## Тесты

```bash
pytest tests/        # backend (92 теста)
npm test             # frontend (vitest + jsdom, 74 теста)
```

## API

- `GET /` — UI
- `POST /api/ocr` — upload файлов в проект (создаёт queued документы; **больше НЕ запускает OCR автоматически** — для этого `/api/recognize`). Возвращает `{ids, warnings, errors}`.
- `POST /api/recognize?project_id=N` — запуск всех queued документов проекта (новый flow: upload только ставит в очередь, распознавание стартует кнопкой)
- `POST /api/engine/preload?lang=ru|en` — eager reload OCR-движка при смене языка
- `GET /api/source/{doc_id}` — оригинальный файл (PDF/image) для крупного просмотра в Source pane
- `GET /api/status?project_id=N&sort=...&order=...` — список документов с прогрессом, elapsed_seconds, eta_seconds
- `GET /api/projects`, `POST /api/projects`, `PATCH /api/projects/{id}`, `DELETE /api/projects/{id}` — CRUD проектов
- `PATCH /api/documents/{id}` — перемещение между проектами; `DELETE /api/documents/{id}` — удаление
- `GET /api/result/{id}` — скачать файл результата
- `GET /api/markdown/{id}` — raw text/markdown
- `GET /api/rendered/{id}` — sanitized HTML (для md/txt/docx)
- `GET /api/preview/{id}` — base64 миниатюры страниц
- `GET /api/projects/{id}/zip` — архив всех done-документов проекта
- `GET /api/system` — GPU/CUDA/VRAM, статус OCR-движка
- `GET /api/limits` — `max_file_size_bytes`, `allowed_extensions`

## Известные ограничения

- **Preview DOCX**: семантический HTML через `mammoth`. Шрифты, отступы и точная вёрстка Microsoft Word не воспроизводятся; таблицы, заголовки и списки сохраняются.
- **Preview Markdown**: рендер через `markdown` (extensions `tables`, `fenced_code`, `sane_lists`) + `bleach` (allow-list тегов). Любые `<script>`, `<iframe>`, инлайн-обработчики и `javascript:` URL вырезаются.
- **Source view DOCX**: недоступен (бинарный формат); открыть документ можно только в режимах Pages или Rendered.
- **ETA**: оценка вычисляется только при `progress_percent` строго между 0 и 100; для очень коротких задач может быть неточной.
- **Engine reload**: смена языка через UI триггерит `POST /api/engine/preload` — модели подгружаются в фоне, status bar обновляется при готовности.
- **Многопоточность**: один worker, один последовательный pipeline OCR. Несколько одновременных запросов кладутся в очередь.
- **Лимит файла**: 50 MB на файл (хардкод в `MAX_FILE_SIZE`). Frontend проверяет до отправки.

## Лицензия

См. лицензию PaddleOCR (Apache 2.0).
