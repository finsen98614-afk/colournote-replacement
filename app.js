(() => {
  "use strict";

  const STORAGE_KEY = "finsenNotesData";
  const COLORS = [
    ["default", "#3a3d42"],
    ["red", "#f7c1c8"],
    ["orange", "#f8d3ae"],
    ["yellow", "#f7e39b"],
    ["green", "#bfe3c0"],
    ["teal", "#b7e4dd"],
    ["blue", "#bcd6f5"],
    ["purple", "#d6c4ee"],
    ["pink", "#f4c6e0"],
    ["gray", "#d7d9dc"],
  ];

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // ---------- Data ----------
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { notes: [], folders: [], version: 1 };
      const parsed = JSON.parse(raw);
      return {
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        version: parsed.version || 1,
      };
    } catch (e) {
      console.error("load failed", e);
      return { notes: [], folders: [], version: 1 };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  const state = {
    data: loadData(),
    currentFolder: "all",
    search: "",
    sort: "updated",
    editingId: null,
    draft: null,
    isNew: false,
  };

  // ---------- Helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // Date-only strings ("YYYY-MM-DD") are parsed as UTC by the Date
  // constructor, while date-time strings ("YYYY-MM-DDTHH:MM:00") are parsed
  // as local time. That mismatch shifts all-day due dates by a day in
  // negative-UTC-offset zones (e.g. Toronto), so date-only values are parsed
  // manually here as local midnight instead.
  function parseDueDate(dueDateStr) {
    if (dueDateStr.length > 10) return new Date(dueDateStr);
    const [y, m, d] = dueDateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dueStatus(note) {
    if (!note.dueDate) return null;
    const hasTime = note.dueDate.length > 10;
    const due = parseDueDate(note.dueDate);
    const now = new Date();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dueDay.getTime() === today.getTime()) {
      return hasTime && due < now ? "overdue" : "today";
    }
    return due < today ? "overdue" : "upcoming";
  }

  function formatDueLabel(note) {
    const due = parseDueDate(note.dueDate);
    const hasTime = note.dueDate.length > 10;
    const dateStr = due.toLocaleDateString("zh-Hant-HK", { month: "numeric", day: "numeric" });
    if (hasTime) {
      const timeStr = due.toLocaleTimeString("zh-Hant-HK", { hour: "2-digit", minute: "2-digit" });
      return dateStr + " " + timeStr;
    }
    return dateStr;
  }

  // ---------- Rendering: folder chips ----------
  function renderFolderChips() {
    const wrap = $("#folderChips");
    wrap.innerHTML = "";
    const allChip = makeChip("all", "全部", state.currentFolder === "all");
    wrap.appendChild(allChip);
    for (const f of state.data.folders) {
      wrap.appendChild(makeChip(f.id, f.name, state.currentFolder === f.id));
    }
    function makeChip(id, label, active) {
      const c = document.createElement("div");
      c.className = "chip" + (active ? " active" : "");
      c.textContent = label;
      c.addEventListener("click", () => {
        state.currentFolder = id;
        render();
      });
      return c;
    }
  }

  // ---------- Rendering: grid ----------
  function noteMatchesSearch(note, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if (note.title && note.title.toLowerCase().includes(q)) return true;
    if (note.type === "text" && note.content && note.content.toLowerCase().includes(q)) return true;
    if (note.type === "checklist" && note.items) {
      return note.items.some((it) => it.text.toLowerCase().includes(q));
    }
    return false;
  }

  function sortNotes(list) {
    const arr = list.slice();
    arr.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (state.sort === "due") {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return b.updatedAt - a.updatedAt;
      }
      if (state.sort === "title") {
        return (a.title || "").localeCompare(b.title || "", "zh-Hant");
      }
      return b.updatedAt - a.updatedAt;
    });
    return arr;
  }

  function renderGrid() {
    const grid = $("#grid");
    grid.innerHTML = "";
    let list = state.data.notes;
    if (state.currentFolder !== "all") {
      list = list.filter((n) => n.folderId === state.currentFolder);
    }
    if (state.search) {
      list = list.filter((n) => noteMatchesSearch(n, state.search));
    }
    list = sortNotes(list);

    $("#emptyState").style.display = list.length === 0 ? "block" : "none";

    for (const note of list) {
      grid.appendChild(renderCard(note));
    }
  }

  function renderCard(note) {
    const card = document.createElement("div");
    card.className = "card c-" + (note.color || "default");
    card.addEventListener("click", () => openEditor(note.id));

    if (note.pinned) {
      const pin = document.createElement("div");
      pin.className = "pin-mark";
      pin.textContent = "📌";
      card.appendChild(pin);
    }

    if (note.title) {
      const h = document.createElement("h3");
      h.textContent = note.title;
      card.appendChild(h);
    }

    if (note.type === "checklist") {
      const ul = document.createElement("ul");
      ul.className = "checklist-preview";
      const items = note.items || [];
      items.slice(0, 6).forEach((it) => {
        const li = document.createElement("li");
        if (it.done) li.className = "done";
        const box = document.createElement("span");
        box.className = "box";
        box.textContent = it.done ? "☑" : "☐";
        li.appendChild(box);
        const txt = document.createElement("span");
        txt.textContent = it.text || "";
        li.appendChild(txt);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      if (items.length > 6) {
        const more = document.createElement("p");
        more.textContent = `+${items.length - 6} 更多項目`;
        card.appendChild(more);
      }
    } else if (note.content) {
      const p = document.createElement("p");
      p.textContent = note.content.length > 220 ? note.content.slice(0, 220) + "…" : note.content;
      card.appendChild(p);
    }

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    const folder = state.data.folders.find((f) => f.id === note.folderId);
    if (folder) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = folder.name;
      metaRow.appendChild(b);
    }
    if (note.dueDate) {
      const status = dueStatus(note);
      const b = document.createElement("span");
      b.className = "badge" + (status === "overdue" ? " overdue" : status === "today" ? " today" : "");
      b.textContent = (status === "overdue" ? "已逾期 " : status === "today" ? "今日 " : "") + formatDueLabel(note);
      metaRow.appendChild(b);
    }
    if (metaRow.children.length) card.appendChild(metaRow);

    return card;
  }

  function render() {
    renderFolderChips();
    renderGrid();
  }

  // ---------- Editor ----------
  function blankNote() {
    return {
      id: uid(),
      title: "",
      type: "text",
      content: "",
      items: [],
      color: "default",
      folderId: "",
      dueDate: "",
      pinned: false,
      notifiedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function openEditor(noteId) {
    if (noteId) {
      const note = state.data.notes.find((n) => n.id === noteId);
      state.draft = JSON.parse(JSON.stringify(note));
      state.isNew = false;
    } else {
      state.draft = blankNote();
      state.isNew = true;
    }
    state.editingId = state.draft.id;
    fillEditorForm();
    $("#editorOverlay").classList.add("open");
  }

  function fillEditorForm() {
    const d = state.draft;
    $("#titleInput").value = d.title || "";
    $("#contentInput").value = d.content || "";
    setType(d.type || "text");
    renderChecklistItems();
    renderSwatches();
    renderFolderSelect();
    $("#folderSelect").value = d.folderId || "";
    if (d.dueDate) {
      const [datePart, timePart] = d.dueDate.split("T");
      $("#dueDateInput").value = datePart;
      $("#dueTimeInput").value = timePart ? timePart.slice(0, 5) : "";
    } else {
      $("#dueDateInput").value = "";
      $("#dueTimeInput").value = "";
    }
    updatePinBtn();
  }

  function updatePinBtn() {
    $("#pinBtn").style.opacity = state.draft.pinned ? "1" : "0.4";
  }

  function setType(type) {
    state.draft.type = type;
    $("#typeTextBtn").classList.toggle("active", type === "text");
    $("#typeChecklistBtn").classList.toggle("active", type === "checklist");
    $("#textFieldWrap").style.display = type === "text" ? "block" : "none";
    $("#checklistWrap").style.display = type === "checklist" ? "block" : "none";
  }

  function renderChecklistItems() {
    const wrap = $("#checklistItems");
    wrap.innerHTML = "";
    (state.draft.items || []).forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "checklist-item-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.done;
      cb.addEventListener("change", () => { item.done = cb.checked; });
      row.appendChild(cb);

      const txt = document.createElement("input");
      txt.type = "text";
      txt.value = item.text || "";
      txt.placeholder = "項目…";
      txt.addEventListener("input", () => { item.text = txt.value; });
      row.appendChild(txt);

      const rm = document.createElement("button");
      rm.className = "rm";
      rm.textContent = "✕";
      rm.addEventListener("click", () => {
        state.draft.items.splice(idx, 1);
        renderChecklistItems();
      });
      row.appendChild(rm);

      wrap.appendChild(row);
    });
  }

  function renderSwatches() {
    const wrap = $("#swatches");
    wrap.innerHTML = "";
    for (const [key, hex] of COLORS) {
      const sw = document.createElement("div");
      sw.className = "swatch" + (state.draft.color === key ? " selected" : "");
      sw.style.background = hex;
      sw.addEventListener("click", () => {
        state.draft.color = key;
        renderSwatches();
      });
      wrap.appendChild(sw);
    }
  }

  function renderFolderSelect() {
    const sel = $("#folderSelect");
    sel.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "無分類";
    sel.appendChild(noneOpt);
    for (const f of state.data.folders) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      sel.appendChild(opt);
    }
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "+ 新增資料夾…";
    sel.appendChild(newOpt);
  }

  function isDraftEmpty() {
    const d = state.draft;
    if (d.title && d.title.trim()) return false;
    if (d.type === "text" && d.content && d.content.trim()) return false;
    if (d.type === "checklist" && (d.items || []).some((it) => it.text && it.text.trim())) return false;
    return true;
  }

  function closeEditor() {
    const d = state.draft;
    d.title = $("#titleInput").value.trim();
    d.content = $("#contentInput").value;
    d.items = (d.items || []).filter((it) => it.text && it.text.trim().length > 0);
    const folderVal = $("#folderSelect").value;
    d.folderId = folderVal === "__new__" ? "" : folderVal;

    const dateVal = $("#dueDateInput").value;
    const timeVal = $("#dueTimeInput").value;
    const prevDue = d.dueDate;
    if (dateVal) {
      d.dueDate = timeVal ? `${dateVal}T${timeVal}:00` : dateVal;
    } else {
      d.dueDate = "";
    }
    // Re-arm the reminder whenever the due date moves, otherwise a note that
    // already fired once stays silent forever at its new time.
    if (d.dueDate !== prevDue) d.notifiedAt = null;

    if (isDraftEmpty()) {
      $("#editorOverlay").classList.remove("open");
      state.editingId = null;
      state.draft = null;
      render();
      return;
    }

    d.updatedAt = Date.now();
    const idx = state.data.notes.findIndex((n) => n.id === d.id);
    if (idx >= 0) state.data.notes[idx] = d;
    else state.data.notes.push(d);

    saveData();
    $("#editorOverlay").classList.remove("open");
    state.editingId = null;
    state.draft = null;
    render();
  }

  function deleteCurrentNote() {
    if (!state.draft) return;
    if (!confirm("刪除呢則筆記？")) return;
    state.data.notes = state.data.notes.filter((n) => n.id !== state.draft.id);
    saveData();
    $("#editorOverlay").classList.remove("open");
    state.editingId = null;
    state.draft = null;
    render();
  }

  // ---------- Folders ----------
  function addFolder(name) {
    name = (name || "").trim();
    if (!name) return null;
    const f = { id: uid(), name };
    state.data.folders.push(f);
    saveData();
    return f;
  }

  function deleteFolder(id) {
    if (!confirm("刪除呢個資料夾？入面嘅筆記會變返「無分類」。")) return;
    state.data.folders = state.data.folders.filter((f) => f.id !== id);
    state.data.notes.forEach((n) => { if (n.folderId === id) n.folderId = ""; });
    if (state.currentFolder === id) state.currentFolder = "all";
    saveData();
    renderManageFolders();
    render();
  }

  function renderManageFolders() {
    const wrap = $("#manageFolderChips");
    wrap.innerHTML = "";
    for (const f of state.data.folders) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span>${f.name}</span>`;
      const del = document.createElement("span");
      del.className = "del";
      del.textContent = " ✕";
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(f.id); });
      chip.appendChild(del);
      wrap.appendChild(chip);
    }
  }

  // ---------- Backup / Restore ----------
  function backupData() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `finsen-notes-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已匯出備份");
  }

  function restoreFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incomingNotes = Array.isArray(parsed.notes) ? parsed.notes : [];
        const incomingFolders = Array.isArray(parsed.folders) ? parsed.folders : [];

        const folderMap = new Map(state.data.folders.map((f) => [f.id, f]));
        for (const f of incomingFolders) folderMap.set(f.id, f);
        state.data.folders = Array.from(folderMap.values());

        const noteMap = new Map(state.data.notes.map((n) => [n.id, n]));
        for (const n of incomingNotes) noteMap.set(n.id, n);
        state.data.notes = Array.from(noteMap.values());

        saveData();
        render();
        renderManageFolders();
        toast(`已還原：${incomingNotes.length} 則筆記`);
      } catch (e) {
        alert("還原失敗，檔案格式唔啱：" + e.message);
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!confirm("即將清除所有筆記同資料夾，此動作無法復原。確定？")) return;
    if (!confirm("再次確認：真係要清除晒？")) return;
    state.data = { notes: [], folders: [], version: 1 };
    saveData();
    render();
    renderManageFolders();
    toast("已清除所有資料");
  }

  // ---------- Notifications ----------
  function updateNotifStatus() {
    const el = $("#notifStatus");
    if (!("Notification" in window)) {
      el.textContent = "此瀏覽器不支援通知";
      return;
    }
    el.textContent = { granted: "已啟用", denied: "已拒絕（要去瀏覽器設定開啟）", default: "未啟用" }[Notification.permission];
  }

  function enableNotifications() {
    if (!("Notification" in window)) { toast("此瀏覽器不支援通知"); return; }
    Notification.requestPermission().then(updateNotifStatus);
  }

  // A date-only due date ("YYYY-MM-DD") would otherwise fire at local midnight,
  // so setting a note due today notifies instantly. Treat those as 09:00.
  function reminderTime(note) {
    if (!note.dueDate) return null;
    const d = parseDueDate(note.dueDate);
    if (note.dueDate.length <= 10) d.setHours(9, 0, 0, 0);
    return d.getTime();
  }

  // Android Chrome forbids `new Notification()` outright ("Illegal constructor")
  // and requires going through the service worker, so try that first. Returns
  // whether a notification was actually shown — the caller must not mark a note
  // as notified when this fails, or the reminder is silently lost forever.
  async function showNotification(title, options) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch (e) { /* fall through to the constructor */ }
    try {
      new Notification(title, options);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function checkDueNotes() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = Date.now();

    const due = state.data.notes.filter(
      (n) => n.dueDate && !n.notifiedAt && reminderTime(n) <= now
    );
    if (!due.length) return;

    let changed = false;

    // Reminders missed while the app was closed all come due at once. Past a
    // handful, collapse them into one notification instead of a burst.
    if (due.length > 3) {
      const ok = await showNotification("有 " + due.length + " 則筆記到期", {
        body: due.slice(0, 3).map((n) => n.title || "無標題筆記").join("、") + " 等",
        tag: "notes-due-digest",
        icon: "icons/icon.svg",
      });
      if (ok) {
        due.forEach((n) => { n.notifiedAt = now; });
        changed = true;
      }
    } else {
      for (const note of due) {
        const ok = await showNotification(note.title || "筆記提醒", {
          body: note.type === "checklist"
            ? (note.items || []).filter((it) => !it.done).length + " 個項目未完成"
            : (note.content || "").slice(0, 80) || "已到期",
          tag: "note-" + note.id,
          icon: "icons/icon.svg",
          requireInteraction: true,
          data: { noteId: note.id },
        });
        if (!ok) break;
        note.notifiedAt = now;
        changed = true;
      }
    }

    if (changed) saveData();
    renderGrid();
  }

  // ---------- Wiring ----------
  function init() {
    render();
    renderManageFolders();
    updateNotifStatus();

    $("#searchInput").addEventListener("input", (e) => {
      state.search = e.target.value.trim();
      renderGrid();
    });

    $("#sortSelect").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderGrid();
    });

    $("#fabAdd").addEventListener("click", () => openEditor(null));
    $("#closeEditorBtn").addEventListener("click", closeEditor);
    $("#deleteBtn").addEventListener("click", deleteCurrentNote);
    $("#pinBtn").addEventListener("click", () => {
      state.draft.pinned = !state.draft.pinned;
      updatePinBtn();
    });

    $("#typeTextBtn").addEventListener("click", () => setType("text"));
    $("#typeChecklistBtn").addEventListener("click", () => setType("checklist"));

    $("#addItemBtn").addEventListener("click", () => {
      state.draft.items = state.draft.items || [];
      state.draft.items.push({ text: "", done: false });
      renderChecklistItems();
      const inputs = document.querySelectorAll("#checklistItems input[type=text]");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    $("#folderSelect").addEventListener("change", (e) => {
      if (e.target.value === "__new__") {
        const name = prompt("新資料夾名稱：");
        const f = addFolder(name);
        renderFolderSelect();
        e.target.value = f ? f.id : "";
      }
    });

    $("#clearDueBtn").addEventListener("click", () => {
      $("#dueDateInput").value = "";
      $("#dueTimeInput").value = "";
    });

    // Ask for permission when a reminder is actually set. Burying this in the
    // settings sheet meant most reminders were armed while notifications were
    // still un-granted, so nothing could ever fire.
    $("#dueDateInput").addEventListener("change", () => {
      if (!$("#dueDateInput").value) return;
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(updateNotifStatus);
      }
    });

    $("#settingsBtn").addEventListener("click", () => {
      renderManageFolders();
      updateNotifStatus();
      $("#settingsOverlay").classList.add("open");
    });
    $("#closeSettingsBtn").addEventListener("click", () => $("#settingsOverlay").classList.remove("open"));

    $("#enableNotifBtn").addEventListener("click", enableNotifications);
    $("#backupBtn").addEventListener("click", backupData);
    $("#restoreBtn").addEventListener("click", () => $("#restoreFile").click());
    $("#restoreFile").addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) restoreFromFile(e.target.files[0]);
      e.target.value = "";
    });
    $("#addFolderBtn").addEventListener("click", () => {
      const name = prompt("新資料夾名稱：");
      if (addFolder(name)) { renderManageFolders(); render(); }
    });
    $("#clearAllBtn").addEventListener("click", clearAllData);

    // close overlays by tapping backdrop
    $("#editorOverlay").addEventListener("click", (e) => { if (e.target.id === "editorOverlay") closeEditor(); });
    $("#settingsOverlay").addEventListener("click", (e) => { if (e.target.id === "settingsOverlay") $("#settingsOverlay").classList.remove("open"); });

    // The interval only ticks while the page is alive, so also sweep on return
    // to catch reminders that came due while the app was closed.
    setInterval(checkDueNotes, 60000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkDueNotes();
    });
    checkDueNotes();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
