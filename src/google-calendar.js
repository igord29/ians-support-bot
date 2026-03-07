import { google } from "googleapis";

function getAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/gmail.send"
    ],
  });
  return auth;
}

export async function createCalendarEvent({ title, date, duration_minutes = 60, description, attendees = [] }) {
  const auth = await getAuth().getClient();
  const calendar = google.calendar({ version: "v3", auth });

  const startTime = new Date(date);
  const endTime = new Date(startTime.getTime() + duration_minutes * 60000);

  const event = {
    summary: title,
    description,
    start: { dateTime: startTime.toISOString(), timeZone: "America/New_York" },
    end: { dateTime: endTime.toISOString(), timeZone: "America/New_York" },
    attendees: attendees.map(email => ({ email }))
  };

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    resource: event,
    sendUpdates: attendees.length > 0 ? "all" : "none"
  });

  return response.data;
}

export async function listTodayEvents() {
  const auth = await getAuth().getClient();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime"
  });

  return (response.data.items || []).map(e => ({
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    description: e.description
  }));
}
