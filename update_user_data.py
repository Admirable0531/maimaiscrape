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
from urllib.parse import urlparse, parse_qs, urlencode
import datetime
import sys
from pymongo import MongoClient
import schedule
import time

def update():
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

        def get_top_score():
            new_rating_elements = WebDriverWait(driver, 30).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
            
            if len(new_rating_elements) >= 2:
                first_element = new_rating_elements[0]
            new_rating = first_element.get_attribute('outerHTML')
            
            soup = BeautifulSoup(new_rating, 'html.parser')
            new_records=[]
            
            
            for row in soup.find_all('tr', class_='scoreRecordRow')[1:]:
                new_record = {}
                cells = row.find_all('td')
                new_record['#'] = cells[0].text.strip()
                new_record['Song'] = cells[1].text.strip()
                new_record['Chart'] = cells[2].text.strip()
                new_record['Level'] = cells[3].text.strip()
                new_record['Achv'] = cells[4].text.strip()
                new_record['Rank'] = cells[5].text.strip()
                new_record['Rating'] = cells[6].text.strip()
                new_records.append(new_record)

            old_rating_elements = WebDriverWait(driver, 30).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
            
            if len(old_rating_elements) >= 2:
                # Get the second element
                second_element = old_rating_elements[1]
            old_rating = second_element.get_attribute('outerHTML')
            
            soup = BeautifulSoup(old_rating, 'html.parser')
            old_records=[]
            
            
            for row in soup.find_all('tr', class_='scoreRecordRow')[1:]:
                old_record = {}
                cells = row.find_all('td')
                old_record['#'] = cells[0].text.strip()
                old_record['Song'] = cells[1].text.strip()
                old_record['Chart'] = cells[2].text.strip()
                old_record['Level'] = cells[3].text.strip()
                old_record['Achv'] = cells[4].text.strip()
                old_record['Rank'] = cells[5].text.strip()
                old_record['Rating'] = cells[6].text.strip()
                old_records.append(old_record)
            
            rating = WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.CSS_SELECTOR, '.totalRating')))
            text = rating.text

            rating = int(text.split("：")[1])

            data = {
                "new": new_records,
                "old": old_records,
                "rating": rating,
                "Date": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            }
            driver.close()
            driver.switch_to.window(driver.window_handles[0])
            return data
            

        
        CONNECTION_STRING = "mongodb://localhost:27017/"
        client = MongoClient(CONNECTION_STRING)
        db = client["mydatabase"]
        current_date = datetime.date.today()

        # Format the date as a string in the desired format
        formatted_date = current_date.strftime("%d/%m/%Y")

        def get_ryan_info():
            user_img_element = WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".w_112.f_l"))
            )
            user_img_src = user_img_element.get_attribute("src")
            
            user_name_element = WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".name_block.f_l.f_16"))
            )
            user_name = user_name_element.text

            user_rating_element = WebDriverWait(driver, 10).until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, ".rating_block"))
            )
            user_rating = user_rating_element.text

            ryan_user_data = {
                "user": "ryan",
                "img_src": user_img_src,
                "name": user_name,
                "rating": user_rating,
                "date": formatted_date
            }
            
            collection = db["user_info"]
            collection.insert_one(ryan_user_data)


    # Ryan
        get_ryan_info()
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.LINK_TEXT, "Analyze Rating"))
        )
        analyze_rating_link.click()
        
        driver.switch_to.window(driver.window_handles[1])
        
        collection = db["ryan_top"]
        collection.insert_one(get_top_score())
        
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

        def get_user_info():
            user_img_elements = WebDriverWait(driver, 10).until(
                EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".w_112.f_l"))
            )
            user_img_src = [element.get_attribute("src") for element in user_img_elements]
            
            user_name_elements = WebDriverWait(driver, 10).until(
                EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".name_block.t_l.f_l.f_16.underline"))
            )
            user_name = [element.text for element in user_name_elements]

            user_rating_elements = WebDriverWait(driver, 10).until(
                EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".rating_block"))
            )
            user_rating = [element.text for element in user_rating_elements]

            for i in range(1, 6):
                if i == 1:
                    choose = "jiayi"
                elif i == 2:
                    choose = "marcus"
                elif i == 3:
                    choose = "kok"
                elif i == 4:
                    choose = "yuan"
                elif i == 5:
                    choose = "keyang"
                else:
                    print("error user")
                user_data = {
                    "user": choose,
                    "img_src": user_img_src[i],
                    "name": user_name[i],
                    "rating": user_rating[i],
                    "date": formatted_date
                }
                collection = db["user_info"]
                collection.insert_one(user_data)

        get_user_info()

    # Jiayi
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8067013466678&playerName=%E2%99%AA"]'))
        )
        analyze_rating_link.click()
        driver.switch_to.window(driver.window_handles[1])
        
        collection = db["jiayi_top"]
        collection.insert_one(get_top_score())


    # Markus
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8071982688053&playerName=%EF%BC%A2%EF%BC%AC%EF%BC%B5%EF%BC%A5%E3%80%80%EF%BC%AF%CF%89%EF%BC%AF"]'))
        )
        analyze_rating_link.click()
        driver.switch_to.window(driver.window_handles[1])
        collection = db["marcus_top"]
        collection.insert_one(get_top_score())


    # Kok
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8085423055111&playerName=%EF%BC%A9%EF%BC%AE%EF%BC%A6%EF%BC%A9%EF%BC%AE%EF%BC%A9%EF%BC%B4%EF%BC%B9"]'))
        )
        analyze_rating_link.click()
        driver.switch_to.window(driver.window_handles[1])
        collection = db["kok_top"]
        collection.insert_one(get_top_score())


    # Yuan
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8070962675681&playerName=%EF%BD%99%EF%BD%95%EF%BD%81%EF%BD%8E%E3%80%80%EF%BC%AF%D0%94%EF%BC%AF"]'))
        )
        analyze_rating_link.click()
        driver.switch_to.window(driver.window_handles[1])
        collection = db["yuan_top"]
        collection.insert_one(get_top_score())


    # Keyang
        analyze_rating_link = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'a[target="friendRating"][href="https://myjian.github.io/mai-tools/rating-calculator/?region=intl&friendIdx=8091021494559&playerName=%EF%BD%84%EF%BC%88%EF%BC%9A%EF%BC%93%EF%BC%89%EF%BC%8F%EF%BD%84%EF%BD%98"]'))
        )
        analyze_rating_link.click()
        driver.switch_to.window(driver.window_handles[1])
        collection = db["keyang_top"]
        collection.insert_one(get_top_score())

        driver.close()


    except Exception as e:
        logging.error(f"Exception message: {e}")
        logging.error(f"Exception type: {type(e)}")
        
        traceback_object = sys.exc_info()[2]
        # Format the traceback and print the line number
        line_number = traceback_object.tb_lineno
        filename = traceback_object.tb_frame.f_code.co_filename
        print(f"Error occurred at line {line_number} of {filename}")

schedule.every().day.at("15:39").do(update)

while True:
    schedule.run_pending()
    time.sleep(60)  # Sleep for 60 seconds before checking again