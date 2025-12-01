# Shopiq: E-commerce Insights and Scraping Tool 🛍️

Shopiq is a comprehensive tool designed to provide e-commerce insights through web scraping and data analysis. It consists of a frontend built with Next.js, a backend powered by Node.js and Express, and a Python scraper. The project aims to automate the process of collecting product data, categorizing it, and presenting it in a user-friendly interface. It solves the problem of manually gathering and organizing e-commerce product information, making it easier to analyze market trends and competitor strategies.

## 🚀 Key Features

- **Automated Web Scraping**: Scrapes product data from various e-commerce websites using Selenium and Python.
- **Backend API**: Provides API endpoints for accessing scraped data and managing categories using Node.js, Express, and PostgreSQL.
- **Frontend Interface**: Offers a user-friendly interface for browsing products and categories built with Next.js and React.
- **Data Storage**: Stores scraped data and category information in a PostgreSQL database.
- **Environment Variable Configuration**: Uses `.env` files to manage sensitive information and configuration settings.
- **CORS Support**: Enables Cross-Origin Resource Sharing (CORS) to allow requests from different domains.
- **Reproducible Builds**: Uses `package-lock.json` and `requirements.txt` to ensure consistent dependency versions across different environments.
- **Category Management**: Allows users to retrieve and manage product categories.

## 🛠️ Tech Stack

Here's a breakdown of the technologies used in this project:

| Category    | Technology          | Description                                                                                                |
|-------------|-----------------------|------------------------------------------------------------------------------------------------------------|
| **Frontend**  | Next.js             | React framework for building user interfaces with server-side rendering and static site generation.      |
|             | React               | JavaScript library for building user interfaces.                                                           |
|             | axios               | HTTP client for making API requests.                                                                       |
|             | Tailwind CSS        | Utility-first CSS framework for styling the frontend.                                                     |
|             | PostCSS             | Tool for transforming CSS with JavaScript.                                                                 |
| **Backend**   | Node.js             | JavaScript runtime environment for building the backend server.                                          |
|             | Express             | Web application framework for Node.js.                                                                     |
|             | PostgreSQL          | Relational database for storing product data and category information.                                    |
|             | `pg`                | PostgreSQL client for Node.js.                                                                             |
|             | `body-parser`       | Middleware to parse incoming request bodies.                                                              |
|             | `cors`              | Middleware to enable Cross-Origin Resource Sharing (CORS).                                                |
|             | `dotenv`            | Loads environment variables from a `.env` file into `process.env`.                                         |
|             | `nodemon`           | Tool that automatically restarts the server when file changes are detected (development dependency).        |
| **Scraper**   | Python              | Programming language used for the web scraper.                                                             |
|             | Selenium            | Web automation framework used for controlling web browsers.                                                |
|             | `webdriver_manager` | Library that automatically manages the drivers for Selenium web browsers.                                  |
|             | `psycopg2-binary`   | PostgreSQL adapter for Python.                                                                             |
| **Build Tools**| npm/yarn            | Package managers for managing project dependencies.                                                        |

## 📦 Getting Started / Setup Instructions

### Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v16 or higher)
- npm or yarn
- Python 3.6+
- PostgreSQL
- Selenium Web Drivers (ChromeDriver, GeckoDriver, etc.)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository_url>
    cd shopiq
    ```

2.  **Backend Setup:**

    ```bash
    cd backend
    npm install  # or yarn install
    ```

    Create a `.env` file in the `backend` directory and configure the following environment variables:

    ```
    DATABASE_URL=<your_postgresql_connection_string>
    PORT=5000 # Optional, defaults to 5000
    ```

3.  **Frontend Setup:**

    ```bash
    cd ../frontend
    npm install  # or yarn install
    ```

    Create a `.env` file in the `frontend` directory and configure the following environment variable:

    ```
    NEXT_PUBLIC_API_URL=<your_backend_api_url>  # e.g., http://localhost:5000/api
    ```

4.  **Scraper Setup:**

    ```bash
    cd ../backend/scraper
    pip install -r requirements.txt
    ```

    Create a `.env` file in the `backend/scraper` directory and configure the following environment variable:

    ```
    DATABASE_URL=<your_postgresql_connection_string>
    ```

### Running Locally

1.  **Start the Backend Server:**

    ```bash
    cd backend
    npm run dev # or yarn dev
    ```

    This will start the backend server using `nodemon`, which automatically restarts the server on file changes.

2.  **Start the Frontend Development Server:**

    ```bash
    cd frontend
    npm run dev # or yarn dev
    ```

    This will start the Next.js development server.  Open your browser and navigate to `http://localhost:3000` (or the port specified by Next.js).

3.  **Run the Scraper (Optional):**

    ```bash
    cd backend/scraper
    python your_scraper_script.py # Replace with the actual scraper script name
    ```

    This will run the scraper script to collect product data and store it in the database.  Make sure you have configured the `DATABASE_URL` correctly in the scraper's `.env` file.

## 📂 Project Structure

```
shopiq/
├── backend/
│   ├── .env                  # Backend environment variables
│   ├── package.json          # Backend project dependencies and scripts
│   ├── package-lock.json     # Backend dependency lockfile
│   ├── server.js             # Main entry point for the backend server
│   ├── routes/
│   │   └── api.js            # API routes definition
│   ├── controllers/
│   │   ├── scraperController.js # Logic for handling product scraping requests
│   │   └── categoryController.js # Logic for handling category related requests
│   └── scraper/
│       ├── .env              # Scraper environment variables
│       ├── requirements.txt  # Scraper Python dependencies
│       └── your_scraper_script.py # The scraper script (replace with actual name)
├── frontend/
│   ├── .env                  # Frontend environment variables
│   ├── package.json          # Frontend project dependencies and scripts
│   ├── package-lock.json     # Frontend dependency lockfile
│   ├── next.config.js        # Next.js configuration file
│   ├── pages/
│   │   ├── _app.js           # Custom App component
│   │   └── index.js          # Main landing page
│   │   └── categories.js     # Categories page
│   ├── components/
│   │   └── Layout.js         # Layout component for consistent page structure
│   └── styles/
│       └── globals.css       # Global CSS styles
└── README.md               # This file
```

## 📸 Screenshots

(Add screenshots of the application here to showcase its features and UI)

## 🤝 Contributing

We welcome contributions to Shopiq! If you'd like to contribute, please follow these steps:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Make your changes and commit them with clear, descriptive messages.
4.  Submit a pull request.

## 📝 License

This project is licensed under the [MIT License](LICENSE) - see the `LICENSE` file for details.

## 📬 Contact

If you have any questions or suggestions, feel free to contact us at [your_email@example.com](mailto:your_email@example.com).

## 💖 Thanks Message

Thank you for checking out Shopiq! We hope this tool helps you gain valuable insights into the e-commerce landscape. Your contributions and feedback are highly appreciated!

This is written by [readme.ai](https://readme-generator-phi.vercel.app/).
