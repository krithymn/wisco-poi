const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 80;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATABASE SETUP (sql.js — pure JS, no compilation needed) ─
const initSqlJs = require('sql.js');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wisco_poi.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file or create new one
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      customer    TEXT DEFAULT '',
      supplier    TEXT DEFAULT '',
      item        TEXT DEFAULT '',
      start_date  TEXT DEFAULT '',
      due_date    TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS steps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL,
      step_index    INTEGER NOT NULL,
      responsible   TEXT DEFAULT '—',
      step_due_date TEXT DEFAULT '',
      done_date     TEXT DEFAULT '',
      UNIQUE(project_id, step_index)
    );
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed defaults
  const teamRow = db.exec("SELECT value FROM config WHERE key='team'");
  if (!teamRow.length || !teamRow[0].values.length) {
    const defaultTeam = ["WR-CEO","K'Tom-CEO","Hard-Marketing","Nut-Proposal Head",
      "Ziea-Purchasing officer","Fast-Proposal Engineer","Fah-Proposal Engineer",
      "Cheraim-Purchasing officer","PU-Purchasing officer","Koi-Purchasing officer",
      "Ging-Purchasing officer","อุ้ย-Graphic","เสมียน-Warehouse","นิล-SA Manager",
      "ฟิน-SA Engineer","วี-SA Director","จ๋า-SA Rayong","แยม-SA Rayong",
      "นนนี่-Head SA Team","ฟิ้า SV-Tele Sales","ฟ้า EN-Tele Sales",
      "ริช-SA Executive","นุช-SA Support WR","มา-SA Support WR"];
    db.run("INSERT OR IGNORE INTO config (key,value) VALUES ('team',?)", [JSON.stringify(defaultTeam)]);
  }
  const daysRow = db.exec("SELECT value FROM config WHERE key='stepDays'");
  if (!daysRow.length || !daysRow[0].values.length) {
    db.run("INSERT OR IGNORE INTO config (key,value) VALUES ('stepDays',?)", [JSON.stringify([1,3,2,1,1,1,3,3,5,3,3,30,3,7,1])]);
  }

  saveDB();
  console.log('  ✅ Database ready.');
}

// Save DB to disk after every write
function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── HELPERS ──────────────────────────────────────────────────
const STEPS = ["รับ PR","ขอราคา SUP","เปิด POI","Check POI","Approve POI",
  "ส่ง POI ให้ Sup","รับ PI","รับ Drawing","ทำ Drawing / Nameplate",
  "ส่ง Drawing ให้ลูกค้า Approve","ส่ง Drawing ยืนยันกับ SUP",
  "รอผลิต","จ่ายเงิน Sup","ขนส่ง","รับสินค้า"];

function query(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

function buildProject(row) {
  const stepRows = query(
    "SELECT * FROM steps WHERE project_id=? ORDER BY step_index", [row.id]
  );
  const responsible  = Array(STEPS.length).fill('—');
  const stepDueDates = Array(STEPS.length).fill('');
  const stepDates    = Array(STEPS.length).fill('');
  let completedSteps = 0;

  stepRows.forEach(s => {
    const i = s.step_index;
    responsible[i]  = s.responsible  || '—';
    stepDueDates[i] = s.step_due_date || '';
    stepDates[i]    = s.done_date     || '';
    if (s.done_date) completedSteps = Math.max(completedSteps, i + 1);
  });

  return {
    id: row.id, customer: row.customer||'', supplier: row.supplier||'',
    item: row.item||'', startDate: row.start_date||'', dueDate: row.due_date||'',
    completedSteps, responsible, stepDueDates, stepDates
  };
}

// ─── ROUTES ───────────────────────────────────────────────────

// GET all projects
app.get('/api/projects', (req, res) => {
  try {
    const rows = query("SELECT * FROM projects ORDER BY created_at DESC");
    res.json(rows.map(buildProject));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET single project
app.get('/api/projects/:id', (req, res) => {
  try {
    const rows = query("SELECT * FROM projects WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({error:'Not found'});
    res.json(buildProject(rows[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// POST create project
app.post('/api/projects', (req, res) => {
  try {
    const {id, customer, supplier, item, startDate, dueDate} = req.body;
    if (!id || !supplier) return res.status(400).json({error:'id and supplier required'});
    const exists = query("SELECT id FROM projects WHERE id=?", [id]);
    if (exists.length) return res.status(409).json({error:'Project ID already exists'});

    run("INSERT INTO projects (id,customer,supplier,item,start_date,due_date) VALUES (?,?,?,?,?,?)",
      [id, customer||'', supplier, item||'', startDate||'', dueDate||'']);

    for (let i = 0; i < STEPS.length; i++) {
      run("INSERT OR IGNORE INTO steps (project_id,step_index,responsible,step_due_date,done_date) VALUES (?,?,?,?,?)",
        [id, i, '—', '', '']);
    }
    const rows = query("SELECT * FROM projects WHERE id=?", [id]);
    res.status(201).json(buildProject(rows[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PUT update project info
app.put('/api/projects/:id', (req, res) => {
  try {
    const {customer, supplier, item, startDate, dueDate} = req.body;
    run("UPDATE projects SET customer=?,supplier=?,item=?,start_date=?,due_date=? WHERE id=?",
      [customer||'', supplier||'', item||'', startDate||'', dueDate||'', req.params.id]);
    const rows = query("SELECT * FROM projects WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({error:'Not found'});
    res.json(buildProject(rows[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE project
app.delete('/api/projects/:id', (req, res) => {
  try {
    run("DELETE FROM steps WHERE project_id=?", [req.params.id]);
    run("DELETE FROM projects WHERE id=?", [req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PATCH update single step
app.patch('/api/projects/:id/steps/:stepIndex', (req, res) => {
  try {
    const {responsible, stepDueDate, doneDate} = req.body;
    const si = parseInt(req.params.stepIndex);
    const pid = req.params.id;

    run("INSERT OR IGNORE INTO steps (project_id,step_index,responsible,step_due_date,done_date) VALUES (?,?,?,?,?)",
      [pid, si, '—', '', '']);

    if (responsible  !== undefined) run("UPDATE steps SET responsible=?   WHERE project_id=? AND step_index=?", [responsible,  pid, si]);
    if (stepDueDate  !== undefined) run("UPDATE steps SET step_due_date=? WHERE project_id=? AND step_index=?", [stepDueDate,  pid, si]);
    if (doneDate     !== undefined) run("UPDATE steps SET done_date=?      WHERE project_id=? AND step_index=?", [doneDate,     pid, si]);

    const rows = query("SELECT * FROM projects WHERE id=?", [pid]);
    res.json(buildProject(rows[0]));
  } catch(e) { res.status(500).json({error:e.message}); }
});

// GET config
app.get('/api/config', (req, res) => {
  try {
    const team     = query("SELECT value FROM config WHERE key='team'");
    const stepDays = query("SELECT value FROM config WHERE key='stepDays'");
    res.json({
      team:     team.length     ? JSON.parse(team[0].value)     : [],
      stepDays: stepDays.length ? JSON.parse(stepDays[0].value) : []
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PUT update team
app.put('/api/config/team', (req, res) => {
  try {
    run("INSERT OR REPLACE INTO config (key,value) VALUES ('team',?)", [JSON.stringify(req.body.team)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// PUT update step days
app.put('/api/config/stepdays', (req, res) => {
  try {
    run("INSERT OR REPLACE INTO config (key,value) VALUES ('stepDays',?)", [JSON.stringify(req.body.stepDays)]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ─── START ────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ✅ WISCO POI Server is running!');
    console.log('');
    console.log(`  📊 Dashboard  →  http://localhost:${PORT}/dashboard.html`);
    console.log(`  ✏️  Edit Page  →  http://localhost:${PORT}/edit.html`);
    console.log('');
    console.log('  Share these URLs with your team (replace with your IP):');
    console.log(`  📡 http://YOUR_IP:${PORT}/dashboard.html`);
    console.log(`  📡 http://YOUR_IP:${PORT}/edit.html`);
    console.log('');
    console.log('  Run ipconfig in a new Command Prompt to find your IP.');
    console.log('');
  });
}).catch(err => {
  console.error('Failed to start:', err);
});
