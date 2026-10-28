(() => {
  "use strict";
  const form = document.querySelector("#taskForm");
  if (!form) return;

  const list = document.querySelector("#taskList");
  const filter = document.querySelector("#taskFilter");
  const search = document.querySelector("#taskSearch");
  const total = document.querySelector("#taskTotal");
  const progress = document.querySelector("#taskProgress");
  const formMessage = document.querySelector("#formMessage");
  const globalMessage = document.querySelector("#globalMessage");
  let tasks = [];

  const priorities = {
    high: {label: "Высокий приоритет", className: "priority-high"},
    medium: {label: "Обычный приоритет", className: "priority-medium"},
    low: {label: "Низкий приоритет", className: "priority-low"}
  };
  const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const formatDate = (value) => {
    if (!value) return "";
    const [y,m,d] = value.split("-");
    return `${d}.${m}.${y}`;
  };
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {"Content-Type":"application/json", ...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
    return data;
  }
  function message(node, text, isError = false) {
    node.textContent = text;
    node.classList.toggle("is-error", isError);
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase("ru");
    const mode = filter.value;
    const visible = tasks.filter(task => {
      if (mode === "active" && task.is_completed) return false;
      if (mode === "completed" && !task.is_completed) return false;
      return `${task.title} ${task.description}`.toLocaleLowerCase("ru").includes(query);
    });
    total.textContent = tasks.length;
    const done = tasks.filter(task => task.is_completed).length;
    progress.textContent = `${done} из ${tasks.length} выполнено`;
    if (!visible.length) {
      list.innerHTML = `<p class="task-empty">${tasks.length ? "По выбранным условиям задач нет." : "Пока задач нет. Добавьте первую задачу выше."}</p>`;
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    list.innerHTML = visible.map(task => {
      const priority = priorities[task.priority] || priorities.medium;
      const overdue = task.due_date && !task.is_completed && new Date(`${task.due_date}T00:00:00`) < today;
      return `<article class="task-item ${task.is_completed ? "is-completed" : ""}" data-id="${task.id}">
        <input class="task-check" type="checkbox" aria-label="Отметить задачу выполненной" ${task.is_completed ? "checked" : ""}>
        <div class="task-main">
          <h4 class="task-title">${escapeText(task.title)}</h4>
          ${task.description ? `<p class="task-description">${escapeText(task.description)}</p>` : ""}
          <div class="task-meta">
            <span class="task-badge ${priority.className}">${priority.label}</span>
            ${task.due_date ? `<span class="task-badge ${overdue ? "is-overdue" : ""}">${overdue ? "Просрочено · " : "Срок · "}${formatDate(task.due_date)}</span>` : ""}
            ${task.is_completed ? '<span class="task-badge">Выполнена</span>' : ""}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action" type="button" data-action="edit">Изменить</button>
          <button class="task-action" type="button" data-action="delete">Удалить</button>
        </div>
      </article>`;
    }).join("");
  }
  async function loadTasks() {
    try {
      tasks = await api("/api/todo/tasks");
      render();
    } catch (error) {
      list.innerHTML = '<p class="task-empty">Не удалось загрузить задачи.</p>';
      message(globalMessage, error.message, true);
    }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.title = data.title.trim();
    data.description = data.description.trim();
    try {
      const created = await api("/api/todo/tasks", {method:"POST", body:JSON.stringify(data)});
      tasks.unshift(created);
      form.reset();
      document.querySelector("#taskPriority").value = "medium";
      message(formMessage, "Задача добавлена.");
      filter.value = "all";
      search.value = "";
      render();
      document.querySelector("#taskTitle").focus();
    } catch (error) {
      message(formMessage, error.message, true);
    }
  });
  list.addEventListener("change", async event => {
    if (!event.target.matches(".task-check")) return;
    const item = event.target.closest("[data-id]");
    const task = tasks.find(t => t.id === Number(item.dataset.id));
    try {
      const updated = await api(`/api/todo/tasks/${task.id}`, {
        method:"PATCH", body:JSON.stringify({is_completed:event.target.checked})
      });
      tasks = tasks.map(t => t.id === updated.id ? updated : t);
      render();
    } catch (error) {
      event.target.checked = !event.target.checked;
      message(globalMessage, error.message, true);
    }
  });
  list.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = button.closest("[data-id]");
    const id = Number(item.dataset.id);
    const task = tasks.find(t => t.id === id);
    if (button.dataset.action === "delete") {
      if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
      try {
        await api(`/api/todo/tasks/${id}`, {method:"DELETE"});
        tasks = tasks.filter(t => t.id !== id);
        render();
        message(globalMessage, "Задача удалена.");
      } catch (error) { message(globalMessage, error.message, true); }
      return;
    }
    if (button.dataset.action === "edit") {
      item.innerHTML = `<div class="task-main" style="grid-column:1/-1">
        <label class="field-label">Название<input class="task-edit-input edit-title" maxlength="200" value="${escapeText(task.title)}"></label>
        <label class="field-label">Описание<textarea class="task-edit-input edit-description" rows="2">${escapeText(task.description)}</textarea></label>
        <div class="form-row">
          <label class="field-label">Срок<input class="task-edit-input edit-date" type="date" value="${task.due_date || ""}"></label>
          <label class="field-label">Приоритет<select class="task-edit-select edit-priority">
            <option value="low" ${task.priority === "low" ? "selected" : ""}>Низкий</option>
            <option value="medium" ${task.priority === "medium" ? "selected" : ""}>Обычный</option>
            <option value="high" ${task.priority === "high" ? "selected" : ""}>Высокий</option>
          </select></label>
        </div>
        <div class="task-actions"><button class="task-action" data-action="save" type="button">Сохранить</button><button class="task-action" data-action="cancel" type="button">Отмена</button></div>
      </div>`;
      return;
    }
    if (button.dataset.action === "cancel") { render(); return; }
    if (button.dataset.action === "save") {
      const data = {
        title:item.querySelector(".edit-title").value.trim(),
        description:item.querySelector(".edit-description").value.trim(),
        due_date:item.querySelector(".edit-date").value || null,
        priority:item.querySelector(".edit-priority").value
      };
      try {
        const updated = await api(`/api/todo/tasks/${id}`, {method:"PATCH", body:JSON.stringify(data)});
        tasks = tasks.map(t => t.id === updated.id ? updated : t);
        render();
        message(globalMessage, "Изменения сохранены.");
      } catch (error) { message(globalMessage, error.message, true); }
    }
  });
  filter.addEventListener("change", render);
  search.addEventListener("input", render);
  loadTasks();
})();
