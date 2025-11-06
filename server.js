// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process'); 
const fs = require('fs'); 
const path = require('path'); 
const session = require('express-session');
const bcrypt = require('bcrypt'); // NEW: Import bcrypt for password hashing

const app = express();
const PORT = 3000;

// --- Admin Credentials (Used for Initial Database Setup Only) ---
// We will insert this user automatically if the users table is empty
const INITIAL_ADMIN_USER = 'admin';
const INITIAL_ADMIN_PASS = 'password123'; 
const SALT_ROUNDS = 10; // For bcrypt hashing

// --- Session Middleware ---
app.use(session({
    secret: 'a-strong-secret-key-for-session',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// --- MySQL Connection Configuration ---
const dbConfig = {
    host: 'localhost',
    user: 'root',      
    password: 'student', 
    database: 'prediction' 
};

// --- INITIALIZATION FUNCTION: Ensure Admin User Exists ---
const initializeAdminUser = async () => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // 1. Check if the 'users' table exists and has any users
        const [rows] = await connection.execute('SELECT COUNT(*) AS count FROM users');
        
        if (rows[0].count === 0) {
            console.log("Database empty. Creating initial admin user...");
            
            // 2. Hash the initial password
            const hashedPassword = await bcrypt.hash(INITIAL_ADMIN_PASS, SALT_ROUNDS);
            
            // 3. Insert the user with the HASHED password
            const sql = 'INSERT INTO users (username, password) VALUES (?, ?)';
            await connection.execute(sql, [INITIAL_ADMIN_USER, hashedPassword]);
            
            
        }
    } catch (err) {
        // This is where database connection or query errors show up
        console.error('Database Initialization Error:', err.message);
        console.log("FATAL: Cannot connect to database or initialize user table.");
    } finally {
        if (connection) connection.end();
    }
};


// --- Authentication Check Middleware ---
const requireLogin = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    } 
    // Redirect to the login page path
    res.redirect('/login.html');
};

// --- Static File Serving ---
// Serve files from the 'public' directory
app.use(express.static('public'));

// --- Main Page Route (Protected) ---
app.get('/', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- UPDATED API Endpoint for Login (Uses Database & Hashing) ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    let connection;

    try {
        connection = await mysql.createConnection(dbConfig);
        
        // 1. Retrieve user data (especially the HASHED password) from the database
        const [rows] = await connection.execute('SELECT password FROM users WHERE username = ?', [username]);

        if (rows.length === 0) {
            // User not found
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const hashedPassword = rows[0].password;
        
        // 2. Compare the plain-text password with the HASHED password
        const match = await bcrypt.compare(password, hashedPassword);

        if (match) {
            
            req.session.isAdmin = true;
            return res.json({ success: true, redirect: '/' });
        } else {
            // Password mismatch
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

    } catch (err) {
        console.error('Login Database Error:', err.message);
        return res.status(500).json({ success: false, message: 'Server authentication error.' });
    } finally {
        if (connection) connection.end();
    }
});

// --- Existing API Endpoint to Predict Churn (Protected) ---
app.post('/api/predict', requireLogin, async (req, res) => {
    const customerData = req.body;
    let predictionResult = null;
    
    const inputFeatures = [
        'CreditScore', 'Geography', 'Gender', 'Age', 'Tenure', 'Balance', 
        'NumOfProducts', 'HasCrCard', 'IsActiveMember', 'EstimatedSalary'
    ];

    const inputValues = inputFeatures.map(feature => customerData[feature]);
    const inputString = JSON.stringify(inputValues);
    
    try {
        const pythonProcess = spawn('python', ['./predict.py', inputString]);
        let pythonOutput = '';
        let pythonError = '';

        pythonProcess.stdout.on('data', (data) => { pythonOutput += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { pythonError += data.toString(); });

        await new Promise((resolve, reject) => {
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const match = pythonOutput.match(/Prediction: (\d)/);
                        if (match) {
                            predictionResult = parseInt(match[1]);
                        } else {
                            throw new Error(`Prediction format error. Raw output: ${pythonOutput.trim()}`);
                        }
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`Python script failed. Code: ${code}. Error: ${pythonError.trim()}`));
                }
            });
            pythonProcess.on('error', (err) => {
                reject(new Error(`Failed to start Python process: ${err.message}. Check if Python is in your PATH.`));
            });
        });

    } catch (error) {
        console.error('Prediction Error:', error.message);
        return res.status(500).json({ error: `Prediction service failed: ${error.message}` });
    }

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const statusText = predictionResult === 0 ? 'Stay' : 'Leave';
        
        // --- Prediction Results Table Insertion ---
        const sql = `INSERT INTO prediction_results (
            CreditScore, Geography, Gender, Age, Tenure, Balance, NumOfProducts, HasCrCard, IsActiveMember, EstimatedSalary,
            prediction_code, status_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [
            customerData.CreditScore, customerData.Geography, customerData.Gender, customerData.Age, customerData.Tenure, 
            customerData.Balance, customerData.NumOfProducts, customerData.HasCrCard, customerData.IsActiveMember, 
            customerData.EstimatedSalary, predictionResult, statusText
        ];
        
        await connection.execute(sql, values);
        
        res.json({ prediction: predictionResult, status: statusText, inputData: customerData });

    } catch (err) {
        console.error('MySQL Error:', err.message);
        res.status(200).json({ 
            prediction: predictionResult,
            status: predictionResult === 0 ? 'Stay' : 'Leave',
            inputData: customerData, 
            error: 'Database logging failed, but prediction received.' 
        });
    } finally {
        if (connection) connection.end();
    }
});


// --- NEW API Endpoint for File Operations (Protected) ---
app.get('/api/download-results', requireLogin, async (req, res) => {
    let connection;
    const filePath = path.join(__dirname, 'Result.txt');
    
    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute('SELECT * FROM prediction_results'); 
        
        console.log('\n--- MySQL Query Results ---');
        console.table(rows);
        console.log('---------------------------\n');

        let fileContent = 'Customer Churn Prediction Results\n\n';
        
        if (rows.length === 0) {
            fileContent += 'No prediction records found.\n';
        } else {
            const headers = Object.keys(rows[0]);
            fileContent += headers.join('\t | \t') + '\n';
            fileContent += '-'.repeat(headers.join('\t | \t').length + 5) + '\n';
            
            rows.forEach(row => {
                const values = headers.map(header => String(row[header]));
                fileContent += values.join('\t | \t') + '\n';
            });
        }

        fs.writeFileSync(filePath, fileContent);
        console.log(`Wrote ${rows.length} records to ${filePath}`);

        res.download(filePath, 'Prediction_Results.txt', (err) => {
            if (err) {
                console.error("Error sending file to client:", err.message);
                fs.unlinkSync(filePath); 
                return;
            }
            fs.unlinkSync(filePath);
        });

    } catch (err) {
        console.error('File Operation / MySQL Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch or create results file. Check server logs.' });
    } finally {
        if (connection) connection.end();
    }
});


// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Access the application via the login page: http://localhost:${PORT}/login.html`);
    // Run initialization function after server starts
    initializeAdminUser(); 
});