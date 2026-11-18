import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))
from parsing import (
    kaspi_url,
    parse_category_file,
    parse_price,
    parse_rating,
    parse_reviews,
)
from scraper import normalize_card
from storage import connect, initialize, save_products


class ParsingTests(unittest.TestCase):
    def test_prices(self):
        for text, expected in [
            ("1 234 ₸", "1234"),
            ("1\u00a0234\u202f567,50 ₸", "1234567.50"),
            ("1999.99 KZT", "1999.99"),
        ]:
            with self.subTest(text=text):
                self.assertEqual(parse_price(text), Decimal(expected))
        for text in [None, "", "Бесплатно", "-100", "10 x 12", "от 2000 ₸", "0 ₸"]:
            self.assertIsNone(parse_price(text))

    def test_reviews_are_nullable(self):
        self.assertEqual(parse_reviews("(1\u202f234 отзыва)"), 1234)
        self.assertEqual(parse_reviews("Нет отзывов"), 0)
        self.assertEqual(parse_reviews("(0 отзывов)"), 0)
        self.assertIsNone(parse_reviews(None))
        self.assertIsNone(parse_reviews("рейтинг 4.9"))

    def test_current_and_legacy_rating(self):
        self.assertEqual(parse_rating("rating _small _49"), 4.9)
        self.assertEqual(parse_rating("rating rating_50"), 5)
        self.assertIsNone(parse_rating("rating _99"))
        self.assertIsNone(parse_rating(None))

    def test_urls(self):
        self.assertEqual(
            kaspi_url("/shop/p/test-123/?c=750000000", "p"),
            "https://kaspi.kz/shop/p/test-123/",
        )
        for value in [
            "https://evil.example/shop/c/test/",
            "//evil.example/shop/c/test/",
            "http://kaspi.kz/shop/c/test/",
            "https://kaspi.kz:9000/shop/c/test/",
        ]:
            with self.assertRaises(ValueError):
                kaspi_url(value)

    def test_category_siblings_and_full_source(self):
        content = "Все категории:\nРаздел (/shop/c/root/):\n  Category: Первый (c/one/)\n    -> Subcategory: Лист (/c/leaf/)\n  Category: Второй (/shop/c/two/)\nДругой (/shop/c/other/):"
        categories = parse_category_file(content)
        self.assertEqual(
            [item["parent_temp_id"] for item in categories], [None, 1, 2, 1, None]
        )
        self.assertEqual([item["level"] for item in categories], [0, 1, 2, 1, 0])
        source = (
            Path(__file__).resolve().parents[1]
            / "scraper/categories_and_subcategories.txt"
        )
        self.assertGreater(
            len(parse_category_file(source.read_text(encoding="utf-8"))), 1900
        )

    def test_card_without_rating_is_saved(self):
        product = normalize_card(
            {
                "name": "Товар",
                "price": "2\u202f999 ₸",
                "product_url": "/shop/p/test-123/",
                "external_id": "123",
            },
            16,
        )
        self.assertEqual(product["parsed_price"], Decimal("2999"))
        self.assertIsNone(product["rating"])
        self.assertIsNone(product["reviews_count"])


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "test.sqlite"
        self.environment = patch.dict(
            os.environ, {"SHOPIQ_DB_PATH": str(self.path), "DATABASE_URL": ""}
        )
        self.environment.start()
        with closing(sqlite3.connect(self.path)) as db:
            db.execute(
                "CREATE TABLE products(id INTEGER PRIMARY KEY,category TEXT,name TEXT,price TEXT,scraped_at TEXT)"
            )
            db.executemany(
                "INSERT INTO products VALUES(?,?,?,?,?)",
                [
                    (1, "Смартфоны", "ТЕСТ", "1 000 ₸", "2025-04-01 10:00:00"),
                    (2, "Смартфоны", "Тест", "2\u00a0000 ₸", "2025-04-02 10:00:00"),
                    (3, "Смартфоны", "Другой", "неизвестно", "2025-04-02 10:00:00"),
                ],
            )
            db.commit()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def test_migration_is_repeatable_and_preserves_archive(self):
        initialize()
        initialize()
        with connect() as db:
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM products_before_v2").fetchone()[0], 3
            )
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM products").fetchone()[0], 2
            )
            self.assertEqual(
                db.execute("SELECT parsed_price FROM products WHERE id=2").fetchone()[
                    0
                ],
                2000,
            )
            self.assertIsNone(
                db.execute("SELECT parsed_price FROM products WHERE id=3").fetchone()[0]
            )

    def test_live_upsert_matches_legacy_and_does_not_duplicate(self):
        initialize()
        with connect() as db:
            category_id = db.execute(
                "SELECT category_id FROM products WHERE id=2"
            ).fetchone()[0]
        product = {
            "category_id": category_id,
            "name": "Тест",
            "price": "3000 ₸",
            "parsed_price": Decimal("3000"),
            "external_id": "123",
            "reviews_count": 7,
            "rating": 4.9,
        }
        save_products([product], "750000000")
        product["parsed_price"] = Decimal("3500")
        save_products([product], "750000000")
        save_products([product], "750000000")
        with connect() as db:
            self.assertEqual(
                db.execute("SELECT COUNT(*) FROM products").fetchone()[0], 2
            )
            self.assertEqual(
                db.execute(
                    "SELECT parsed_price,reviews_count,computed_revenue FROM products WHERE external_id=?",
                    ("123",),
                ).fetchone(),
                (3500, 7, None),
            )
            self.assertEqual(db.execute("SELECT COUNT(*) FROM price_history").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT parsed_price FROM product_city_prices WHERE city_id='750000000'").fetchone()[0], 3500)


if __name__ == "__main__":
    unittest.main()
