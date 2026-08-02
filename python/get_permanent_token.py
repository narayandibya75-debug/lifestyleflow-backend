import os
import requests
from pathlib import Path
from dotenv import load_dotenv

# Find .env.local relative to where your script executes
BASE_DIR = Path(__file__).resolve().parent.parent
env_path = BASE_DIR / ".env.local"

if env_path.exists():
    load_dotenv(dotenv_path=env_path)
    print(f"✅ Loaded environment variables from {env_path}")
else:
    print("⚠️ .env.local not found at expected path.")

# Extract variables
APP_ID = os.getenv("APP_ID")
APP_SECRET = os.getenv("APP_SECRET")
SHORT_LIVED_TOKEN = os.getenv("SHORT_LIVED_TOKEN")
PAGE_ID = os.getenv("PAGE_ID")

# Sanity check validation
missing_vars = [var for var, val in {
    "APP_ID": APP_ID, 
    "APP_SECRET": APP_SECRET, 
    "SHORT_LIVED_TOKEN": SHORT_LIVED_TOKEN, 
    "PAGE_ID": PAGE_ID
}.items() if not val]

if missing_vars:
    raise ValueError(f"❌ Missing required keys in environment: {', '.join(missing_vars)}")


def generate_permanent_page_token():
    user_url = "https://facebook.com"
    user_params = {
        "grant_type": "fb_exchange_token",
        "client_id": APP_ID,
        "client_secret": APP_SECRET,
        "fb_exchange_token": SHORT_LIVED_TOKEN
    }
    
    print("🔄 Exchanging for 60-day User Token...")
    user_res = requests.get(user_url, params=user_params)
    
    # Check if the API returned an HTTP error code (e.g., 400, 403, 500)
    if user_res.status_code != 200:
        print(f"❌ User token exchange failed (HTTP status {user_res.status_code}).")
        print(f"📄 Raw response body:\n{user_res.text}")
        return

    # Try parsing the JSON safely
    try:
        response_data = user_res.json()
    except Exception as e:
        print("❌ Unexpected non-JSON response from Facebook despite HTTP 200.")
        print(f"📄 Raw response body text:\n{user_res.text}")
        return
        
    long_lived_user_token = response_data.get("access_token")
    if not long_lived_user_token:
        print(f"❌ No access_token found in response keys. Payload: {response_data}")
        return
        
    print("✅ 60-day User Token acquired.")

    # 2. Query accounts endpoint to fetch permanent page token
    page_url = f"https://facebook.com{PAGE_ID}"
    page_params = {
        "fields": "access_token,name",
        "access_token": long_lived_user_token
    }
    
    print("\n🔄 Fetching permanent Page Access Token...")
    page_res = requests.get(page_url, params=page_params)
    if page_res.status_code != 200:
        print(f"❌ Page token retrieval failed (HTTP status {page_res.status_code}):\n{page_res.text}")
        return
        
    try:
        page_data = page_res.json()
    except Exception as e:
        print(f"❌ Could not parse page token JSON: {page_res.text}")
        return
        
    permanent_page_token = page_data.get("access_token")
    page_name = page_data.get("name")
    
    print(f"\n🎉 SUCCESS! Permanent token generated for page: '{page_name}'")
    print("👇 Copy the following token and save it back into your .env.local as FB_PERMANENT_PAGE_TOKEN:\n")
    print(permanent_page_token)
    print("\n=======================================================")

if __name__ == "__main__":
    generate_permanent_page_token()
