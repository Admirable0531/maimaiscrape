import os
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
from pymongo import MongoClient
import json
import logging
import datetime

# Load variables from .env file
load_dotenv()

# Access variables
login_user = os.getenv("MAIMAI_USER")
login_pass = os.getenv("MAIMAI_PASS")

# URL of the website you want to scrape
url = "https://maimaidx-eng.com"

try:
    options = webdriver.ChromeOptions()
    options.add_experimental_option("detach", True)
    options.add_argument("--enable-logging=stderr")
    options.add_argument('--log-level=3')
    driver = webdriver.Chrome(options=options)  # Example for Chrome, you can use other browsers as well

    # Open the webpage
    driver.get(url)

    # Find the button by its CSS selector, ID, class, etc.
    sega_button = driver.find_element(By.CSS_SELECTOR, ".c-button--openid--segaId")

    # Click the button
    sega_button.click()

    try:
        sid_element = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.ID, "sid")))
        sid_element.send_keys(login_user)
        pass_element = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.ID, "password")))
        pass_element.send_keys(login_pass)

    except NoSuchElementException as e:
        print("Input element not found.")

    login_button = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.CSS_SELECTOR, ".c-button--login")))

    login_button.click()

    WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.CSS_SELECTOR, "body")))

    try:
        script = """
            (function(d){
                if(["https://maimaidx.jp","https://maimaidx-eng.com"].indexOf(d.location.origin)>=0){
                    var s=d.createElement("script");
                    s.src="https://myjian.github.io/mai-tools/scripts/all-in-one.js?t="+Math.floor(Date.now()/60000);
                    d.body.append(s);
                }
            })(document)
            """
        driver.execute_script(script)
    except Exception as e:
        print(e)

    analyze_rating_link = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.LINK_TEXT, "Analyze Rating"))
    )

    analyze_rating_link.click()

    driver.switch_to.window(driver.window_handles[-1])
    new_rating_elements = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))

    
    if len(new_rating_elements) >= 2:
        # Get the second element
        second_element = new_rating_elements[1]
    new_rating = second_element.get_attribute('outerHTML')

    soup = BeautifulSoup(new_rating, 'html.parser')
    records=[]
    
    
    for row in soup.find_all('tr', class_='scoreRecordRow')[1:]:
        record = {}
        cells = row.find_all('td')
        record['#'] = cells[0].text.strip()
        record['Song'] = cells[1].text.strip()
        record['Chart'] = cells[2].text.strip()
        record['Level'] = cells[3].text.strip()
        record['Achv'] = cells[4].text.strip()
        record['Rank'] = cells[5].text.strip()
        record['Rating'] = cells[6].text.strip()
        records.append(record)

    current_datetime = datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    records.append({'Date': current_datetime})
    json_data = json.dumps(records, indent=4)
    print(json_data)

    CONNECTION_STRING = "mongodb://localhost:27017/"
    client = MongoClient(CONNECTION_STRING)
    db = client["mydatabase"]
    collection = db["maimai"]
    collection.insert_one({'records': records, 'Date': current_datetime})

    latest_object = collection.find_one(sort=[('_id', -1)])

    print(latest_object)

except Exception as e:
    logging.error("Error: Table not found within 10 seconds.")
    logging.error(f"Exception message: {e}")
    logging.error(f"Exception type: {type(e)}")