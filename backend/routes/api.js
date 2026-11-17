const express = require("express");
const catalog = require("../services/catalog");
const scraper = require("../services/scraper");
const category = require("../controllers/categoryController");
const products = require("../controllers/scraperController");
const router = express.Router();
router.get("/health", async (req, res) => {
  await require("../models/db").query("SELECT 1");
  res.json({ status: "ok" });
});
router.get("/overview", async (req, res) =>
  res.json(await catalog.getOverview(req.query)),
);
router.get("/products", products.getProducts);
router.get("/categories", category.getCategories);
router.get("/categories/:id", category.getCategoryById);
router.get("/scrape/status", async (req, res) =>
  res.json(await scraper.status()),
);
router.post("/scrape", scraper.authorize, products.triggerScraping);
router.post("/scrape/cancel", scraper.authorize, async (req, res) =>
  res.json(await scraper.cancel()),
);
module.exports = router;
