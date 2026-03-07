import { google } from "googleapis";

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/tasks"]
  });
}

async function getTasksClient() {
  const auth = await getAuth().getClient();
  return google.tasks({ version: "v1", auth });
}

// Cache the tasklist ID
let tasklistId = null;
async function getTasklistId(tasks) {
  if (tasklistId) return tasklistId;
  const listId = process.env.GOOGLE_TASKLIST_ID;
  if (listId) {
    tasklistId = listId;
    return tasklistId;
  }
  // Default to the first tasklist
  const res = await tasks.tasklists.list({ maxResults: 1 });
  tasklistId = res.data.items?.[0]?.id || "@default";
  return tasklistId;
}

export async function addGoogleTask({ title, notes, due_date, priority }) {
  const tasks = await getTasksClient();
  const listId = await getTasklistId(tasks);

  const task = {
    title: priority === "high" ? `🔴 ${title}` : title,
    notes,
    ...(due_date && { due: new Date(due_date).toISOString() })
  };

  const response = await tasks.tasks.insert({
    tasklist: listId,
    resource: task
  });

  return response.data;
}

export async function listPendingTasks(filter = "all") {
  const tasks = await getTasksClient();
  const listId = await getTasklistId(tasks);

  const response = await tasks.tasks.list({
    tasklist: listId,
    showCompleted: false,
    showHidden: false,
    maxResults: 20
  });

  let items = response.data.items || [];

  if (filter === "high_priority") {
    items = items.filter(t => t.title?.startsWith("🔴"));
  } else if (filter === "overdue") {
    const now = new Date();
    items = items.filter(t => t.due && new Date(t.due) < now);
  }

  return items.map(t => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    due: t.due,
    status: t.status
  }));
}

export async function completeTask(taskId) {
  const tasks = await getTasksClient();
  const listId = await getTasklistId(tasks);

  await tasks.tasks.patch({
    tasklist: listId,
    task: taskId,
    resource: { status: "completed" }
  });
}
