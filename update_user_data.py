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
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options

def update():
    # Load variables from .env file
    load_dotenv()

    # Access variables
    login_user = os.getenv("MAIMAI_USER")
    login_pass = os.getenv("MAIMAI_PASS")
    gecko_path = os.getenv("GECKO_PATH")

    #firefox_binary_path = r"C:\Program Files\Mozilla Firefox\firefox.exe"

    # URL of the website you want to scrape
    url = "https://maimaidx-eng.com"

    # try:
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36"
    options = Options()
    options.add_argument("--proxy-server='direct://'")
    options.add_argument("--proxy-bypass-list=*")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-dev-shm-usage")
    #options.add_argument("--no-sandbox")
    #options.add_argument("--proxy-server=")
    #options.add_argument("blink-settings=imagesEnabled=false")
    #options.binary_location = firefox_binary_path
    # options.add_argument("--enable-logging=stderr")
    # options.add_argument('--log-level=3')

    options.add_argument("--headless")
# Specify the path to the Chrome WebDriver
    service = Service(gecko_path)
    driver = webdriver.Firefox(service=service, options=options)

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
    print("Done Login")
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
        new_rating_elements = WebDriverWait(driver, 60).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
        
        if len(new_rating_elements) >= 2:
            first_element = new_rating_elements[0]
        new_rating = first_element.get_attribute('outerHTML')
        
        soup = BeautifulSoup(new_rating, 'html.parser')
        new_records=[]
        
        for row in soup.find_all('tr', class_='scoreRecordRow')[1:]:
            diff = row['class'][1]
            new_record = {}
            cells = row.find_all('td')
            new_record['#'] = cells[0].text.strip()
            new_record['Song'] = cells[1].text.strip()
            new_record['Chart'] = cells[2].text.strip()
            new_record['Level'] = cells[3].text.strip()
            new_record['Achv'] = cells[4].text.strip()
            new_record['Rank'] = cells[5].text.strip()
            new_record['Rating'] = cells[6].text.strip()
            new_record['Diff'] = diff
            new_records.append(new_record)

        old_rating_elements = WebDriverWait(driver, 60).until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, '.topRecordTable.songRecordTable')))
        
        if len(old_rating_elements) >= 2:
            # Get the second element
            second_element = old_rating_elements[1]
        old_rating = second_element.get_attribute('outerHTML')
        
        soup = BeautifulSoup(old_rating, 'html.parser')
        old_records=[]
        
        for row in soup.find_all('tr', class_='scoreRecordRow')[1:]:
            diff = row['class'][1]
            old_record = {}
            cells = row.find_all('td')
            old_record['#'] = cells[0].text.strip()
            old_record['Song'] = cells[1].text.strip()
            old_record['Chart'] = cells[2].text.strip()
            old_record['Level'] = cells[3].text.strip()
            old_record['Achv'] = cells[4].text.strip()
            old_record['Rank'] = cells[5].text.strip()
            old_record['Rating'] = cells[6].text.strip()
            old_record['Diff'] = diff
            old_records.append(old_record)
        
        rating = WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.CSS_SELECTOR, '.totalRating')))
        text = rating.text

        rating = int(text.split("：")[1])

        data = {
            "new": new_records,
            "old": old_records,
            "rating": rating,
            "Date": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        }
        print("Done Score")
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
        user_img_element = WebDriverWait(driver, 60).until(
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
    print("Done Ryan Info")
    driver.switch_to.window(driver.window_handles[1])
    
    collection = db["ryan_top"]
    collection.insert_one(get_top_score())
    print("Done Ryan Score")
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
        wait = WebDriverWait(driver, 10)
        wait.until(EC.visibility_of_element_located((By.TAG_NAME, "body")))
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        collection = driver.find_elements(By.CSS_SELECTOR,  ".w_112.f_l")
        user_img_elements=[]
        for item in collection:
            driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'})", item)
            user_img_elements.append(item)
        #user_img_elements = WebDriverWait(driver, 45).until(
        #    EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".w_112.f_l"))
        #)
        user_img_src = [element.get_attribute("src") for element in user_img_elements]
        
        user_name_elements = WebDriverWait(driver, 10).until(
            EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".name_block.t_l.f_l.f_16.underline"))
        )
        user_name = [element.text for element in user_name_elements]

        user_rating_elements = WebDriverWait(driver, 10).until(
            EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".rating_block"))
        )
        user_rating = [element.text for element in user_rating_elements]

        for i in range(2, 7):
            if i == 2:
                choose = "yuchen"
            elif i == 3:
                choose = "marcus"
            elif i == 4:
                choose = "kok"
            elif i == 5:
                choose = "yuan"
            elif i == 6:
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
            print("Done " + choose + " Info")
    get_user_info()

    elements = WebDriverWait(driver, 10).until(
        EC.visibility_of_all_elements_located((By.CSS_SELECTOR, 'a[target="friendRating"]'))
    )

# Yuchen
    analyze_rating_link = elements[2]
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    
    collection = db["yuchen_top"]
    collection.insert_one(get_top_score())


# Markus
    analyze_rating_link = elements[3]
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    collection = db["marcus_top"]
    collection.insert_one(get_top_score())


# Kok
    analyze_rating_link = elements[4]
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    collection = db["kok_top"]
    collection.insert_one(get_top_score())


# Yuan
    analyze_rating_link = elements[5]
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    collection = db["yuan_top"]
    collection.insert_one(get_top_score())


# Keyang
    analyze_rating_link = elements[6]
    analyze_rating_link.click()
    driver.switch_to.window(driver.window_handles[1])
    collection = db["keyang_top"]
    collection.insert_one(get_top_score())
    print("DONE")
    driver.close()


    # except Exception as e:
    #     logging.error(f"Exception message: {e}")
    #     logging.error(f"Exception type: {type(e)}")
        
    #     traceback_object = sys.exc_info()[2]
    #     # Format the traceback and print the line number
    #     line_number = traceback_object.tb_lineno
    #     filename = traceback_object.tb_frame.f_code.co_filename
    #     print(f"Error occurred at line {line_number} of {filename}")

schedule.every().day.at("22:45").do(update)
update()
while True:
    schedule.run_pending()
    time.sleep(60)  # Sleep for 60 seconds before checking again
