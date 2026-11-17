const catalog = require("../services/catalog");
const scraper = require("../services/scraper");
exports.getProducts = async (req, res) =>
  res.json(await catalog.getProducts(req.query));
exports.triggerScraping = async (req, res) =>
  res.status(202).json(await scraper.start(req.body));
