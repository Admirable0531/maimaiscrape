import os
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from flask import Flask, jsonify, request
from bs4 import BeautifulSoup
import json

app = Flask(__name__)

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
    print("hi")
    print("hi2")
    try:
        print("hi3")
        new_rating = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, '.topRecordTable'))
        )
        print("hi4")
        new_rating = new_rating.get_attribute('outerHTML')

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

        json_data = json.dumps(records, indent=4)
        print(json_data)
    except TimeoutException as e:
        print(e)

except Exception as e:
    print(e)


@app.route('/api/data', methods=['GET'])
def get_data():
    return jsonify(json_data)

if __name__ == '__main__':
    app.run(debug=True)