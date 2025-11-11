const database = require("../db");

const TABLE_NAME = "transaction";

async function ensureTransactionTable() {
  await database.query(`
    CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
      amount REAL NOT NULL CHECK (amount >= 0),
      occurred_at TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function normalizeRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    type: row.type,
    amount: Number(row.amount) || 0,
    occurredAt: row.occurred_at,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

async function listTransactions() {
  await ensureTransactionTable();
  const result = await database.query(
    `SELECT id, title, category, type, amount, occurred_at, notes, created_at
     FROM "${TABLE_NAME}"
     ORDER BY occurred_at DESC, created_at DESC, id DESC;`
  );
  return Array.isArray(result.rows) ? result.rows.map(normalizeRow) : [];
}

async function createTransaction(payload) {
  await ensureTransactionTable();
  const title = (payload.title || "").trim();
  const category =
    (payload.category || "Uncategorized").trim() || "Uncategorized";
  const type = (payload.type || "expense").toLowerCase();
  const amount = Math.abs(Number(payload.amount) || 0);
  const occurredAt = payload.occurredAt;
  const notes = payload.notes ? payload.notes.trim() : null;

  const insertResult = await database.query(
    `INSERT INTO "${TABLE_NAME}" (title, category, type, amount, occurred_at, notes)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [title, category, type, amount, occurredAt, notes]
  );

  if (insertResult.lastID) {
    const inserted = await database.query(
      `SELECT id, title, category, type, amount, occurred_at, notes, created_at
       FROM "${TABLE_NAME}"
       WHERE id = ?;`,
      [insertResult.lastID]
    );
    return normalizeRow(inserted.rows?.[0]);
  }

  return null;
}

async function deleteTransaction(id) {
  await ensureTransactionTable();
  await database.query(`DELETE FROM "${TABLE_NAME}" WHERE id = ?;`, [id]);
}

module.exports = {
  ensureTransactionTable,
  listTransactions,
  createTransaction,
  deleteTransaction,
};
