# Points Tally App

## Description
The Points Tally App is a web-based application designed for scout groups to manage and track points for individual scouts and groups. It offers features like attendance tracking, honor awards, and offline functionality.

## Features
- User authentication and registration
- Dashboard to view points for individuals and groups
- Manage scouts and groups
- Award and track points
- Attendance tracking
- Honor awards system
- Offline functionality with data syncing
- Multi-language support (English and French)
- Mobile-responsive design

## Technologies Used
- PHP
- JavaScript
- HTML5
- CSS3
- IndexedDB for offline data storage
- Service Workers for offline functionality
- PostgreSQL database

## Setup Instructions
1. Clone the repository
2. Set up a PHP environment (e.g., XAMPP, WAMP, or a web server with PHP support)
3. Create a PostgreSQL database and update the connection details in `config.php`
4. Run the SQL scripts to create the necessary tables (not provided in the current codebase)
5. Ensure that the `DATABASE_URL` environment variable is set with your database connection string
6. Configure your web server to point to the project's root directory
7. Access the application through your web browser

## File Structure
- `config.php`: Database and app configuration
- `functions.php`: Common PHP functions
- `index.php`: Entry point of the application
- `dashboard.php`: Main dashboard
- `manage_points.php`, `manage_names.php`, `manage_groups.php`, `manage_honors.php`: Management pages
- `attendance.php`: Attendance tracking
- `js/`: JavaScript files including app.js, functions.js, indexedDB.js, and points_script.js
- `css/`: CSS files including styles.css and manage_names.css
- `lang/`: Language files (en.php and fr.php)

## Offline Functionality
The app uses Service Workers and IndexedDB to provide offline functionality. Data is synced with the server when the connection is re-established.

## Multi-language Support
The app supports English and French. Language files are located in the `lang/` directory.

## Security
- User passwords are hashed before storage
- Input sanitization is implemented to prevent XSS attacks
- HTTPS is recommended for production use

## Contributing
Contributions to the Points Tally App are welcome. Please follow these steps:
1. Fork the repository
2. Create a new branch
3. Make your changes and commit them
4. Push to your fork and submit a pull request
