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

### Локально

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Открыть `http://localhost:8000` в браузере.

Данные хранятся в `./data/` рядом с `app/` (SQLite + файлы документов).

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

## Тесты

```bash
pytest tests/        # backend (92 теста)
npm test             # frontend (vitest + jsdom, 74 теста)
```

## API

- `GET /` — UI
- `POST /api/ocr` — upload документов в проект
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
- **Engine reload**: смена языка в UI триггерит обновление status bar, но фактическая перезагрузка PaddleOCR-моделей происходит только при следующем OCR-запросе с новым языком.
- **Многопоточность**: один worker, один последовательный pipeline OCR. Несколько одновременных запросов кладутся в очередь.
- **Лимит файла**: 50 MB на файл (хардкод в `MAX_FILE_SIZE`). Frontend проверяет до отправки.

## Лицензия

См. лицензию PaddleOCR (Apache 2.0).
