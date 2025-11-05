const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process'); 
const fs = require('fs'); 
const path = require('path'); 

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); 

const dbConfig = {
    host: 'localhost',
    user: 'root',      
    password: 'student', 
    database: 'prediction' 
};

app.post('/api/predict', async (req, res) => {
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


app.get('/api/download-results', async (req, res) => {
    let connection;
    const filePath = path.join(__dirname, 'Result.txt');
    
    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute('SELECT * FROM prediction_results'); 
        
        console.log('\n--- MySQL Query Results ---');
        console.table(rows);

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


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Go to http://localhost:${PORT} to access the application.`);
});