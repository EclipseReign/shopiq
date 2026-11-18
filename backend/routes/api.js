const express = require("express");
const catalog = require("../services/catalog");
const scraper = require("../services/scraper");
const category = require("../controllers/categoryController");
const products = require("../controllers/scraperController");
const router = express.Router();
router.get('/config',(req,res)=>res.json({cloud:false}));
router.get('/offers/:id',async(req,res)=>{
  if (!/^\d{1,20}$/.test(req.params.id) || (req.query.cityId && !/^\d{9}$/.test(req.query.cityId))) throw catalog.badRequest('Проверьте ID товара и город');
  const {fetchOffers}=await import('../../shared/kaspi.mjs');
  const page=Number(req.query.page || 0);
  const pageSize=catalog.integer(req.query.pageSize,'размера страницы',50,50);
  if(!Number.isSafeInteger(page)||page<0||page>10000)throw catalog.badRequest('Некорректная страница предложений');
  res.json(await fetchOffers(req.params.id,req.query.cityId || '750000000',{page,pageSize}));
});
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
router.get('/coverage', async (req, res) => res.json(await require('../services/catalogRepository').coverage(req.query.runId)));
router.post("/scrape", scraper.authorize, products.triggerScraping);
router.post("/scrape/cancel", scraper.authorize, async (req, res) =>
  res.json(await scraper.cancel()),
);
module.exports = router;
