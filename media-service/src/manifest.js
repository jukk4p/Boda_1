const fs = require('fs');
const path = require('path');
const paths = require('./paths');

function appendLine(item) {
  fs.mkdirSync(path.dirname(paths.manifestPath()), { recursive: true });
  fs.appendFileSync(paths.manifestPath(), JSON.stringify(item) + '\n');
}

function readAll() {
  if (!fs.existsSync(paths.manifestPath())) return [];
  const raw = fs.readFileSync(paths.manifestPath(), 'utf8');
  return raw.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function removeById(id) {
  if (!fs.existsSync(paths.manifestPath())) return null;
  const lines = fs.readFileSync(paths.manifestPath(), 'utf8').split('\n').filter(Boolean);
  let removed = null;
  const kept = lines.filter((line) => {
    let item;
    try { item = JSON.parse(line); } catch { return true; }
    if (item && item.id === id) { removed = item; return false; }
    return true;
  });
  fs.writeFileSync(paths.manifestPath(), kept.length ? kept.join('\n') + '\n' : '');
  return removed;
}

function updateById(id, patch) {
  if (!fs.existsSync(paths.manifestPath())) return null;
  const lines = fs.readFileSync(paths.manifestPath(), 'utf8').split('\n').filter(Boolean);
  let updated = null;
  const next = lines.map((line) => {
    let item;
    try { item = JSON.parse(line); } catch { return line; }
    if (item && item.id === id) {
      updated = { ...item, ...patch };
      return JSON.stringify(updated);
    }
    return line;
  });
  if (!updated) return null;
  fs.writeFileSync(paths.manifestPath(), next.join('\n') + '\n');
  return updated;
}

module.exports = { appendLine, readAll, removeById, updateById };
