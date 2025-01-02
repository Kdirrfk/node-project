const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");
const cron = require("node-cron");

const app = express();
const PORT = 5000;


const allowedOrigins = ['https://verdant-empanada-70cdb5.netlify.app/']; 
app.use(cors({
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(bodyParser.json());

// Connect to SQLite database
const db = new sqlite3.Database("./portfolio.db", (err) => {
  if (err) {
    console.error("Error connecting to SQLite:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

db.run(
  `CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ticker TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    buyPrice REAL NOT NULL,
    current_price REAL DEFAULT NULL
  )`
);

// Finnhub API Key
const FINNHUB_API_KEY = 'ctpcnmhr01qqsrsagglgctpcnmhr01qqsrsaggm0';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRealTimeStockData = async (ticker) => {
  try {
    const response = await axios.get(`https://finnhub.io/api/v1/quote`, {
      params: {
        symbol: ticker,
        token: FINNHUB_API_KEY,
      },
    });
    const currentPrice = response.data.c; // `c` is the current price in Finnhub response
    return currentPrice;
  } catch (error) {
    console.error(`Error fetching stock data for ${ticker}:`, error.message);
    return null;
  }
};

const fetchStockDataWithThrottle = async (stocks) => {
  const updatedStocks = [];

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const realTimePrice = await getRealTimeStockData(stock.ticker);
    if (realTimePrice !== null) {
      stock.current_price = realTimePrice;
    }
    updatedStocks.push(stock);

    if (i % 30 === 0 && i !== 0) {
      await delay(1000); 
    }
  }

  return updatedStocks;
};

app.get("/", (req, res) => {
  res.send("Welcome to the Stock Portfolio Tracker");
});

app.get("/stocks", async (req, res) => {
  const query = "SELECT * FROM stocks";
  db.all(query, [], async (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const updatedStocks = await fetchStockDataWithThrottle(rows);
    res.status(200).json(updatedStocks);
  });
});

app.post("/stocks", (req, res) => {
  const { name, ticker, quantity, buyPrice } = req.body;

  if (!name || !ticker || !quantity || !buyPrice) {
    res.status(400).json({ error: "All fields are required except current_price." });
    return;
  }

  const query = `
    INSERT INTO stocks (name, ticker, quantity, buyPrice)
    VALUES (?, ?, ?, ?)
  `;
  const params = [name, ticker, quantity, buyPrice];

  db.run(query, params, function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(201).json({ id: this.lastID, ...req.body });
  });
});

// to update a stock
app.put("/stocks/:id", (req, res) => {
  const { id } = req.params;
  const { name, ticker, quantity, buyPrice, current_price } = req.body;

  const query = `
    UPDATE stocks
    SET name = ?, ticker = ?, quantity = ?, buyPrice = ?, current_price = ?
    WHERE id = ?
  `;
  const params = [name, ticker, quantity, buyPrice, current_price || null, id];

  db.run(query, params, function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).json({ updatedRows: this.changes });
  });
});

// Route to delete a stock
app.delete("/stocks/:id", (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM stocks WHERE id = ?", [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(200).json({ deletedRows: this.changes });
  });
});

// Route to get portfolio metrics
app.get("/portfolio-metrics", async (req, res) => {
  const query = "SELECT * FROM stocks";
  db.all(query, [], async (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    let totalValue = 0;
    let topStock = null;
    let topStockPerformance = -Infinity;
    let portfolioDistribution = [];

    const updatedStocks = await fetchStockDataWithThrottle(rows);

    // Calculate total value, top-performing stock, and distribution
    for (let stock of updatedStocks) {
      if (stock.current_price) {
        const stockValue = stock.quantity * stock.current_price;
        totalValue += stockValue;

        const stockPerformance = stock.quantity * (stock.current_price - stock.buyPrice);
        if (stockPerformance > topStockPerformance) {
          topStockPerformance = stockPerformance;
          topStock = stock;
        }

        portfolioDistribution.push({
          name: stock.name,
          ticker: stock.ticker,
          value: stockValue,
        });
      }
    }

    portfolioDistribution = portfolioDistribution.map((stock) => ({
      ...stock,
      percentage: ((stock.value / totalValue) * 100).toFixed(2),
    }));

    res.status(200).json({
      totalValue,
      topStock,
      portfolioDistribution,
    });
  });
});

// Set up a cron job to update stock prices every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  const query = "SELECT * FROM stocks";
  db.all(query, [], async (err, rows) => {
    if (err) {
      console.error("Error fetching stocks:", err);
      return;
    }

    const updatedStocks = await fetchStockDataWithThrottle(rows);

    for (let stock of updatedStocks) {
      if (stock.current_price) {
        const updateQuery = `
          UPDATE stocks
          SET current_price = ?
          WHERE id = ?
        `;
        db.run(updateQuery, [stock.current_price, stock.id], (err) => {
          if (err) {
            console.error("Error updating stock price:", err);
          }
        })
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});