import os
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


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

except Exception as e:
    print(e)
