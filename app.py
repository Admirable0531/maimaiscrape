import os
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

# Access variables
login_user = os.getenv("MAIMAI_USER")
login_pass = os.getenv("MAIMAI_PASS")

# Use the variables in your code
print(f"Database User: {login_user}")
print(f"Database Password: {login_pass}")
