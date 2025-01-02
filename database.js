const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./portfolio.db", (err) => {
  if (err) console.error(err.message);
  console.log("Connected to the SQLite database.");
});

// Create stocks table
db.run(`
  CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    ticker TEXT,
    quantity INTEGER,
    buyPrice REAL
  )
`);

module.exports = db;
