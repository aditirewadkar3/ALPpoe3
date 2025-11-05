# predict.py
import pickle
import sys
import json
import pandas as pd
import numpy as np

# This script expects one argument: a JSON string of input values
if len(sys.argv) < 2:
    print("Error: No input data provided.", file=sys.stderr)
    sys.exit(1)


MODEL_PATH = './model/model.pkl' # Path to your pickled model

FEATURE_NAMES = [
    'CreditScore', 'Geography', 'Gender', 'Age', 'Tenure', 'Balance', 
    'NumOfProducts', 'HasCrCard', 'IsActiveMember', 'EstimatedSalary'
]

try:
    # 1. Load the model
    with open(MODEL_PATH, 'rb') as file:
        model = pickle.load(file)
        
    # 2. Parse the input data
    input_values = json.loads(sys.argv[1])
    
    # Ensure all values are available
    if len(input_values) != len(FEATURE_NAMES):
        print(f"Error: Expected {len(FEATURE_NAMES)} features, got {len(input_values)}.", file=sys.stderr)
        sys.exit(1)

    
    input_data = pd.DataFrame([input_values], columns=FEATURE_NAMES)
    
   
    input_data['CreditScore'] = input_data['CreditScore'].astype(int)
    input_data['Age'] = input_data['Age'].astype(int)
    input_data['Tenure'] = input_data['Tenure'].astype(int)
    input_data['Balance'] = input_data['Balance'].astype(float)
    input_data['NumOfProducts'] = input_data['NumOfProducts'].astype(int)
    input_data['HasCrCard'] = input_data['HasCrCard'].astype(int)
    input_data['IsActiveMember'] = input_data['IsActiveMember'].astype(int)
    input_data['EstimatedSalary'] = input_data['EstimatedSalary'].astype(float)

    prediction = model.predict(input_data)[0]
    
   
    print(f"Prediction: {prediction}")
    
except Exception as e:
    print(f"Prediction failed: {e}", file=sys.stderr)
    sys.exit(1)