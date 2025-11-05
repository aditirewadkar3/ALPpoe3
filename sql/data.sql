CREATE DATABASE IF NOT EXISTS prediction;
USE prediction;


DROP TABLE IF EXISTS prediction_results;

CREATE TABLE prediction_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    CreditScore INT NOT NULL,
    Geography VARCHAR(50) NOT NULL,
    Gender VARCHAR(10) NOT NULL,
    Age INT NOT NULL,
    Tenure INT NOT NULL,
    Balance DECIMAL(15, 2) NOT NULL,
    NumOfProducts INT NOT NULL,
    HasCrCard TINYINT NOT NULL,
    IsActiveMember TINYINT NOT NULL,
    EstimatedSalary DECIMAL(15, 2) NOT NULL,
    prediction_code TINYINT NOT NULL, 
    status_text VARCHAR(10) NOT NULL
);

select * from prediction_results;