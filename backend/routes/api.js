const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');

// Убедитесь, что функция triggerScraping существует и экспортирована
router.get('/products', scraperController.getProducts);
router.post('/scrape', scraperController.triggerScraping); // Исправлено

module.exports = router;