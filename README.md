# Workspace: текстовый редактор и To-do органайзер

Учебное Flask-приложение с двумя разделами:

- **Текстовый редактор** — форматирование текста, список документов, автосохранение в IndexedDB браузера, импорт и экспорт DOCX, поиск по документу.
- **To-do органайзер** — подготовленная страница-раздел. Логику списка задач можно разрабатывать отдельно в `todo.py`, `templates/todo.html`, `static/css/todo.css` и `static/js/todo.js`.

## Требования

- Python 3.10 или новее
- Интернет при запуске редактора: Quill, Mammoth.js и docx.js загружаются с CDN

## Установка и запуск

### 1. Склонируйте репозиторий

```bash
git clone git@github.com:spryzennn/trpo_last_practice.git
cd trpo_last_practice
```

Если репозиторий уже находится на компьютере, просто перейдите в папку проекта.

### 2. Создайте виртуальное окружение

**Windows (PowerShell):**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS / Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Установите зависимости

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 4. Запустите приложение

```bash
flask --app app run --debug
```

Откройте в браузере: <http://127.0.0.1:5000>

- Текстовый редактор: `/`
- To-do органайзер: `/todo`

Можно также запустить `python app.py`; в этом случае режим отладки по умолчанию выключен.

## Где хранятся документы

На текущем этапе текстовые документы сохраняются в **IndexedDB текущего браузера**, а не в базе данных на сервере. Они доступны в том же браузере и профиле пользователя. Очистка данных сайта может удалить документы. Это локальное хранилище не синхронизируется автоматически между компьютерами участников проекта.

## Совместная работа через Git и Pull Request

1. Обновите основную ветку:

   ```bash
   git switch main
   git pull
   ```

2. Создайте отдельную ветку под задачу:

   ```bash
   git switch -c feature/todo-organizer
   ```

3. Вносите изменения, проверяйте приложение и фиксируйте их:

   ```bash
   git add .
   git commit -m "Add todo organizer"
   git push -u origin feature/todo-organizer
   ```

4. Откройте Pull Request в GitHub/GitLab, сравнив свою ветку с `main`. После ревью и проверки объедините PR.
5. Перед началом следующей задачи обновите `main` и создайте новую ветку от актуальной версии.

### Как разделить работу над органайзером

Маршрут `/todo` уже подключён через Flask Blueprint в `todo.py`. По возможности разработку органайзера ведите в этих файлах:

- `todo.py` — маршруты и серверная логика органайзера;
- `templates/todo.html` — HTML страницы;
- `static/css/todo.css` — стили органайзера;
- `static/js/todo.js` — клиентская логика органайзера.

Так меньше вероятность конфликтов с изменениями текстового редактора. Если понадобится менять общую навигацию или `app.py`, согласуйте это со вторым участником заранее.

## Структура проекта

```text
trpo_last_practice/
├── app.py
├── todo.py
├── requirements.txt
├── README.md
├── templates/
│   ├── base.html
│   ├── index.html
│   └── todo.html
└── static/
    ├── css/
    │   ├── style.css
    │   └── todo.css
    └── js/
        ├── editor.js
        └── todo.js
```
