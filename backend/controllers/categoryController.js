const catalog = require("../services/catalog");
exports.getCategories = async (req, res) =>
  res.json(await catalog.getCategories(req.query.parentId));
exports.getCategoryById = async (req, res) =>
  res.json(await catalog.getCategory(req.params.id));
