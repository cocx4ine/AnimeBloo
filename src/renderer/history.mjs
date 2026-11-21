export function formatWatchTime(seconds) {
  const minutes = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function watchTotals(sessions, now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const month = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const totals = { today: 0, week: 0, month: 0, all: 0 };
  for (const session of sessions) {
    const time = Date.parse(session.updatedAt);
    const seconds = Number(session.watchedSeconds);
    if (!Number.isFinite(time) || time > now.getTime() || !Number.isFinite(seconds) || seconds <= 0) continue;
    totals.all += seconds;
    if (time >= month) totals.month += seconds;
    if (time >= week) totals.week += seconds;
    if (time >= day) totals.today += seconds;
  }
  return totals;
}
