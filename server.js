const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = "nexus_prod_auth_key_2026";
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    email TEXT,
    password TEXT,
    full_name TEXT,
    role TEXT,
    department TEXT,
    clearance_level TEXT
  )`);

  db.run(`CREATE TABLE purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    vendor TEXT,
    contract_title TEXT,
    amount REAL,
    status TEXT,
    delivery_destination TEXT,
    confidential_notes TEXT
  )`);

  // Insert 5 Original Users
  db.run(`INSERT INTO users (username, email, password, full_name, role, department, clearance_level) VALUES 
    ('alice.s', 'alice.smith@nexus-corp.internal', 'NexusAlice@2026', 'Alice Smith', 'operator', 'Logistics', 'Level 2'),
    ('bob.m', 'bob.miller@nexus-corp.internal', 'MillerCorp!99', 'Bob Miller', 'operator', 'Finance', 'Level 3'),
    ('charlie.v', 'charlie.vance@nexus-corp.internal', 'Vance#SecOps88', 'Charlie Vance', 'operator', 'Infrastructure', 'Level 3'),
    ('david.k', 'david.kim@nexus-corp.internal', 'KimAudit$2026', 'David Kim', 'auditor', 'Oversight & Audit', 'Level 4'),
    ('admin', 'admin@nexus-corp.internal', 'Admin#MasterKey2026$', 'Marcus Sterling', 'admin', 'Executive', 'Level 5 - Compartmented')
  `);

  // Insert 5 Confidential Orders
  db.run(`INSERT INTO purchase_orders (id, userId, vendor, contract_title, amount, status, delivery_destination, confidential_notes) VALUES 
    (1001, 1, 'Dell Technologies', 'Standard Enterprise Hardware Refresh', 48500.00, 'Approved', 'Bangkok Distribution Hub, Fl 4', 'Standard internal inventory deployment.'),
    (1002, 2, 'Cyberdyne Defense Logistics', 'Project Sentinel: Autonomous Surveillance Hardware', 1450000.00, 'Restricted', 'Secure Vault - Facility Beta', 'STRICTLY CONFIDENTIAL: Board approval pending.'),
    (1003, 3, 'BlackHat Cyber Intelligence', 'Zero-Day Vulnerability Advisory Subscription', 320000.00, 'Dispatched', 'Data Operations Center', 'Internal offensive security testing retainer.'),
    (1004, 4, 'Kroll Forensic Partners', 'Whistleblower Special Investigation & Forensic Audit', 890000.00, 'Legal Hold', 'Regional Legal Office - SG', 'CONFIDENTIAL AUDIT: Corrupt procurement allegations.'),
    (1005, 5, 'Apex Offshore Aviation Ltd', 'Executive Private Charter & Capital Relocation', 2750000.00, 'Completed', 'Grand Cayman Airfield', 'SPECIAL DISCRETIONARY DISBURSEMENT: Approved by Admin.')
  `);
});

function authenticate(req, res, next) {
  const token = req.cookies['nexus_session'];
  if (!token) return res.status(401).json({ status: "error", message: "Authentication session expired or missing." });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ status: "error", message: "Invalid session signature." });
    req.user = decoded;
    next();
  });
}

app.post('/api/v1/auth/register', (req, res) => {
  const { full_name, username, email, password } = req.body;
  if (!full_name || !username || !email || !password) {
    return res.status(400).json({ status: "error", message: "All fields are required." });
  }

  const query = `INSERT INTO users (username, email, password, full_name, role, department, clearance_level) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(query, [username, email, password, full_name, 'operator', 'General Operations', 'Level 1'], function(err) {
    if (err) return res.status(500).json({ status: "error", message: err.message });
    
    const newUserId = this.lastID;

    const orderQuery = `INSERT INTO purchase_orders (userId, vendor, contract_title, amount, status, delivery_destination, confidential_notes) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(orderQuery, [newUserId, 'System', 'Account Provisioning Init', 0.00, 'System_Hidden', 'Virtual Node', 'System auto-generated track record.'], function(err2) {
      return res.json({ status: "success", message: "Account provisioned successfully." });
    });
  });
});

app.post('/api/v1/auth/login', (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ status: "error", message: "Username/Email and password are required." });

  // [VULNERABILITY] SQL Injection
  let query = "";
  if (loginId.includes('@')) {
    query = `SELECT id, username, email, full_name, role, department FROM users WHERE email = '${loginId}' AND password = '${password}'`;
  } else {
    query = `SELECT id, username, email, full_name, role, department FROM users WHERE username = '${loginId}' AND password = '${password}'`;
  }

  db.get(query, (err, user) => {
    if (err) return res.status(500).json({ status: "error", message: err.message });
    if (!user) return res.status(401).json({ status: "error", message: "Invalid corporate credentials." });

    const sessionToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });

    res.cookie('nexus_session', sessionToken, { httpOnly: true, path: '/' });
    res.cookie('nexus_role', user.role, { httpOnly: false, path: '/' });
    res.cookie('nexus_user', user.full_name, { httpOnly: false, path: '/' });

    return res.json({ status: "success", profile: user });
  });
});

app.get('/api/v1/procurement/orders', authenticate, (req, res) => {
  // [VULNERABILITY] Information Disclosure
  db.get(`SELECT MAX(id) as maxId, COUNT(id) as totalOrders FROM purchase_orders`, [], (err, meta) => {
    db.all(`SELECT id, contract_title, vendor, status FROM purchase_orders WHERE userId = ?`, [req.user.id], (err, orders) => {
      if (err) return res.status(500).json({ status: "error", message: err.message });
      
      return res.json({ 
        status: "success", 
        _metadata: {
          debug_mode: true,
          pagination: {
            current_user_records: orders.length,
            total_enterprise_records: meta.totalOrders,
            latest_sequence_id: meta.maxId
          },
          sync_hint: "To audit previous records, query sequence IDs backwards." 
        },
        data: orders 
      });
    });
  });
});

app.get('/api/v1/procurement/orders/:id', authenticate, (req, res) => {
  // [VULNERABILITY] BOLA/IDOR
  db.get(`SELECT * FROM purchase_orders WHERE id = ?`, [req.params.id], (err, order) => {
    if (!order) return res.status(404).json({ status: "error", message: "Purchase order record not found or access denied." });
    return res.json({ status: "success", data: order });
  });
});

app.get('/api/v1/infrastructure/diagnostic', authenticate, (req, res) => {
  const host = req.query.host;
  // [VULNERABILITY] Command Injection
  exec(`ping -c 2 ${host}`, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ status: "error", output: stderr || error.message });
    return res.json({ status: "success", output: stdout });
  });
});

app.get('/api/v1/admin/management-data', authenticate, (req, res) => {
  // [VULNERABILITY] Broken Access Control
  const userRole = req.cookies['nexus_role'];
  if (userRole !== 'admin') {
    return res.status(403).json({ status: "error", code: "ACCESS_DENIED", message: `Access Denied.` });
  }

  db.all(`SELECT id, username, email, password, full_name, role, department, clearance_level FROM users`, (err, allUsers) => {
    return res.json({
      status: "success",
      executive_metrics: {
        total_enterprise_liquidity: "$48,920,000 USD",
        active_offshore_reserves: "$16,500,000 USD",
        compromised_endpoints_quarantined: 0,
        active_privilege_sessions: 5
      },
      user_directory: allUsers
    });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`[+] Nexus Platform active on port ${PORT}`);
});
