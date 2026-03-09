import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/agent.db");

// Ensure data directory exists
import fs from "fs";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

// Initialize schema
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    google_task_id TEXT,
    user_id TEXT,
    title TEXT,
    notes TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    idea TEXT,
    category TEXT DEFAULT 'other',
    timestamp TEXT,
    reviewed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    chat_id TEXT,
    message TEXT,
    remind_at TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    to_address TEXT,
    subject TEXT,
    body TEXT,
    cc TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export const db = {
  // Tasks
  saveTask(task) {
    const id = task.google_task_id || `local_${Date.now()}`;
    sqlite.prepare(`
      INSERT OR REPLACE INTO tasks (id, google_task_id, user_id, title, notes, due_date, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, task.google_task_id, task.user_id, task.title, task.notes, task.due_date, task.priority || "normal");
    return id;
  },

  getMostRecentTask(userId) {
    return sqlite.prepare(`
      SELECT * FROM tasks WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
    `).get(userId);
  },

  markTaskComplete(taskId) {
    sqlite.prepare(`
      UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ? OR google_task_id = ?
    `).run(taskId, taskId);
  },

  getPendingTasks(userId) {
    return sqlite.prepare(`
      SELECT * FROM tasks WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC
    `).all(userId);
  },

  getTodayTasks(userId) {
    return sqlite.prepare(`
      SELECT * FROM tasks WHERE user_id = ? AND date(created_at) = date('now') ORDER BY created_at DESC
    `).all(userId);
  },

  // Ideas
  saveIdea(idea) {
    sqlite.prepare(`
      INSERT INTO ideas (user_id, idea, category, timestamp) VALUES (?, ?, ?, ?)
    `).run(idea.user_id, idea.idea, idea.category || "other", idea.timestamp);
  },

  getUnreviewedIdeas(userId) {
    return sqlite.prepare(`
      SELECT * FROM ideas WHERE user_id = ? AND reviewed = 0 ORDER BY timestamp DESC
    `).all(userId);
  },

  // Reminders
  saveReminder({ user_id, chat_id, message, remind_at }) {
    const result = sqlite.prepare(`
      INSERT INTO reminders (user_id, chat_id, message, remind_at) VALUES (?, ?, ?, ?)
    `).run(user_id, chat_id, message, remind_at);
    return result.lastInsertRowid;
  },

  getDueReminders() {
    return sqlite.prepare(`
      SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= datetime('now')
    `).all();
  },

  markReminderSent(id) {
    sqlite.prepare(`UPDATE reminders SET status = 'sent' WHERE id = ?`).run(id);
  },

  // Email drafts
  saveDraft(draft) {
    const result = sqlite.prepare(`
      INSERT INTO email_drafts (user_id, to_address, subject, body, cc) VALUES (?, ?, ?, ?, ?)
    `).run(draft.user_id, draft.to, draft.subject, draft.body, draft.cc);
    return result.lastInsertRowid;
  },

  getPendingDraft(userId) {
    const row = sqlite.prepare(`
      SELECT * FROM email_drafts WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
    `).get(userId);
    if (!row) return null;
    return { to: row.to_address, subject: row.subject, body: row.body, cc: row.cc, id: row.id };
  },

  clearPendingDraft(userId) {
    sqlite.prepare(`
      UPDATE email_drafts SET status = 'sent' WHERE user_id = ? AND status = 'pending'
    `).run(userId);
  }
};
