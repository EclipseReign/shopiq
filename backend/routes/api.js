// routes/api.js
const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');
const categoryController = require('../controllers/categoryController');

// Эндпоинты для товаров
router.get('/products', scraperController.getProducts);
router.post('/scrape', scraperController.triggerScraping);

// Эндпоинты для категорий
router.get('/categories', categoryController.getCategories);
router.get('/categories/:id', categoryController.getCategoryById);

module.exports = router;
