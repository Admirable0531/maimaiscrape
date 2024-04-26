import os
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup
import logging
import requests
import json
from urllib.parse import urlparse, parse_qs, urlencode
import datetime
import sys


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
    
    def get_old_score():
        old_rating_elements = WebDriverWait(driver, 30).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
        
        if len(old_rating_elements) >= 2:
            # Get the second element
            second_element = old_rating_elements[1]
        old_rating = second_element.get_attribute('outerHTML')
        
        soup = BeautifulSoup(old_rating, 'html.parser')
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
        for item in records:
            print("No: " + item['#'] + " Name: " + item['Song'] + " Diff: " + item['Chart'] + " Level: " + item['Level'] + " Achievement: " + item['Achv'] + " Rank: " + item['Rank'] + " Rating: " + item['Rating'])
        records.append({'Date': current_datetime})
        driver.close()
        driver.switch_to.window(driver.window_handles[0])

        data_encoded = json.dumps(records, ensure_ascii=False, indent=4)
        with open('new.json', 'w', encoding='utf-8') as f:
            f.write(data_encoded)
        # print(json_data)

    def get_new_score():
        new_rating_elements = WebDriverWait(driver, 30).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
        
        if len(new_rating_elements) >= 2:
            first_element = new_rating_elements[0]
        new_rating = first_element.get_attribute('outerHTML')
        
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
        for item in records:
            print("No: " + item['#'] + " Name: " + item['Song'] + " Diff: " + item['Chart'] + " Level: " + item['Level'] + " Achievement: " + item['Achv'] + " Rank: " + item['Rank'] + " Rating: " + item['Rating'])
        records.append({'Date': current_datetime})

        data_encoded = json.dumps(records, ensure_ascii=False, indent=4)
        with open('new.json', 'w', encoding='utf-8') as f:
            f.write(data_encoded)
        
        # print(json_data)

# Ryan
    analyze_rating_link = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.LINK_TEXT, "Analyze Rating"))
    )
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    get_new_score()

    
    driver.get('https://maimaidx-eng.com/maimai-mobile/friend/')

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

# # Jiayi
#     analyze_rating_link = WebDriverWait(driver, 10).until(
#         EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8067013466678&playerName=%E2%99%AA"]'))
#     )
#     analyze_rating_link.click()
#     driver.switch_to.window(driver.window_handles[1])
#     get_old_score()


# Markus
    analyze_rating_link = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8071982688053&playerName=%EF%BC%A2%EF%BC%AC%EF%BC%B5%EF%BC%A5%E3%80%80%EF%BC%AF%CF%89%EF%BC%AF"]'))
    )
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    get_new_score()


# # Kok
#     analyze_rating_link = WebDriverWait(driver, 10).until(
#         EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8085423055111&playerName=%EF%BC%A9%EF%BC%AE%EF%BC%A6%EF%BC%A9%EF%BC%AE%EF%BC%A9%EF%BC%B4%EF%BC%B9"]'))
#     )
#     analyze_rating_link.click()
#     driver.switch_to.window(driver.window_handles[1])
#     get_old_score()


# # Yuan
#     analyze_rating_link = WebDriverWait(driver, 10).until(
#         EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8070962675681&playerName=%EF%BD%99%EF%BD%95%EF%BD%81%EF%BD%8E%E3%80%80%EF%BC%AF%D0%94%EF%BC%AF"]'))
#     )
#     analyze_rating_link.click()
#     driver.switch_to.window(driver.window_handles[1])
#     get_old_score()


# # Keyang
#     analyze_rating_link = WebDriverWait(driver, 10).until(
#         EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8091021494559&playerName=%EF%BD%84%EF%BC%88%EF%BC%9A%EF%BC%93%EF%BC%89%EF%BC%8F%EF%BD%84%EF%BD%98"]'))
#     )
#     analyze_rating_link.click()
#     driver.switch_to.window(driver.window_handles[1])
#     get_old_score()



except Exception as e:
    logging.error(f"Exception message: {e}")
    logging.error(f"Exception type: {type(e)}")
    
    traceback_object = sys.exc_info()[2]
    # Format the traceback and print the line number
    line_number = traceback_object.tb_lineno
    filename = traceback_object.tb_frame.f_code.co_filename
    print(f"Error occurred at line {line_number} of {filename}")

