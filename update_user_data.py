#!/usr/bin/env python3
# update_user_data.py - run Firefox in a virtual display (Xvfb) to reduce headless detection
# - takes screenshots and HTML dumps at each step for debugging
# - clicks visible agree checkbox (.c-form__checkbox.js-agree)
# - retries once if SEGA returns the ERROR page

import os
import time
import traceback
import datetime
import random
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.common.exceptions import (
    NoSuchElementException,
    TimeoutException,
    WebDriverException,
)
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from bs4 import BeautifulSoup
from pymongo import MongoClient
import schedule

# pyvirtualdisplay provides an easy Xvfb interface
try:
    from pyvirtualdisplay import Display
except Exception:
    Display = None

# ---------- Configuration ----------
SCREENSHOT_DIR = "/app/screenshots"
GECKODRIVER_LOG = "/tmp/geckodriver.log"
DEFAULT_RUN_AT = "22:45"

# default and alternate UAs used on retry
FALLBACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
ALT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0"
# -----------------------------------

def ensure_screenshot_dir():
    try:
        if os.path.isdir(SCREENSHOT_DIR):
            return
        os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    except Exception:
        alt = "/tmp/screenshots"
        try:
            os.makedirs(alt, exist_ok=True)
            globals()['SCREENSHOT_DIR'] = alt
        except Exception:
            pass

def timestamp():
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def take_screenshot(driver, step_name, save_html=True):
    ensure_screenshot_dir()
    ts = timestamp()
    safe_step = step_name.replace(" ", "_").replace("/", "_")
    png_path = os.path.join(SCREENSHOT_DIR, f"{safe_step}_{ts}.png")
    html_path = None
    try:
        driver.save_screenshot(png_path)
        print(f"[screenshot] saved: {png_path}", flush=True)
    except Exception as e:
        print(f"[screenshot] failed to save png {png_path}: {e}", flush=True)
    if save_html:
        try:
            html_path = os.path.join(SCREENSHOT_DIR, f"{safe_step}_{ts}.html")
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write(driver.page_source)
            print(f"[screenshot] saved html: {html_path}", flush=True)
        except Exception as e:
            print(f"[screenshot] failed to save html {html_path}: {e}", flush=True)
            html_path = None
    return png_path, html_path

# ---------- driver startup ----------
def start_driver(gecko_path: str | None, user_agent: str, extra_prefs: dict | None = None, use_xvfb: bool = True):
    """
    Start Firefox in a virtual display (Xvfb) when available.
    Returns (driver, log_file, display_obj)
    display_obj may be None if Xvfb not used or pyvirtualdisplay missing.
    """
    display = None
    if use_xvfb and Display is not None:
        try:
            display = Display(visible=0, size=(1280, 1024))
            display.start()
            print("[xvfb] started virtual display", flush=True)
        except Exception as e:
            print("[xvfb] failed to start virtual display:", e, flush=True)
            display = None

    options = Options()
    # RUN IN NON-HEADLESS MODE so the browser appears like a real one under Xvfb
    # do NOT call options.add_argument("-headless")
    # set a deterministic window size
    options.add_argument("--width=1280")
    options.add_argument("--height=1024")
    options.add_argument("--disable-dev-shm-usage")

    # set prefs to reduce detectability (best-effort)
    try:
        if user_agent:
            options.set_preference("general.useragent.override", user_agent)
            options.set_preference("intl.accept_languages", "en-US,en;q=0.9")
    except Exception:
        pass

    # apply extra prefs
    if extra_prefs:
        for k, v in extra_prefs.items():
            try:
                options.set_preference(k, v)
            except Exception:
                pass

    # use a binary if present
    ff_bin = "/usr/bin/firefox-esr"
    if os.path.exists(ff_bin):
        options.binary_location = ff_bin

    os.environ.setdefault("MOZ_DISABLE_CONTENT_SANDBOX", "1")
    # open geckodriver log
    try:
        log_file = open(GECKODRIVER_LOG, "a+")
    except Exception:
        log_file = None

    try:
        if gecko_path and gecko_path.strip():
            service = Service(executable_path=gecko_path, log_output=log_file)
        else:
            service = Service(log_output=log_file)
        driver = webdriver.Firefox(service=service, options=options)
        driver.implicitly_wait(3)
        print("[driver] started Firefox successfully (non-headless)", flush=True)
        return driver, log_file, display
    except WebDriverException as e:
        print("[driver] Failed to start Firefox/geckodriver:", e, flush=True)
        print(traceback.format_exc(), flush=True)
        if log_file:
            try:
                log_file.flush()
                log_file.seek(0)
                print("--- geckodriver.log start ---", flush=True)
                print(log_file.read(), flush=True)
                print("--- geckodriver.log end ---", flush=True)
                log_file.close()
            except Exception:
                pass
        # stop display if started
        if display:
            try:
                display.stop()
            except Exception:
                pass
        return None, None, None

# ---------- helper: click visible agree checkbox ----------
def click_visible_agree_checkbox(driver, timeout=8):
    selector = "input.c-form__checkbox.js-agree"
    try:
        WebDriverWait(driver, timeout).until(lambda d: d.find_elements(By.CSS_SELECTOR, selector))
    except TimeoutException:
        print("[agree] no .c-form__checkbox.js-agree present in DOM", flush=True)
        return False

    inputs = driver.find_elements(By.CSS_SELECTOR, selector)
    for i, cb in enumerate(inputs):
        try:
            visible = cb.is_displayed()
        except Exception:
            visible = False
        if not visible:
            continue
        try:
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", cb)
        except Exception:
            pass
        try:
            cb.click()
            print(f"[agree] clicked visible checkbox (index {i}) via element.click()", flush=True)
            return True
        except Exception:
            try:
                driver.execute_script("arguments[0].click();", cb)
                print(f"[agree] clicked visible checkbox (index {i}) via JS click()", flush=True)
                return True
            except Exception:
                continue

    # fallback: click label under #agree-maimaidxex
    try:
        parent = driver.find_element(By.ID, "agree-maimaidxex")
        label = parent.find_element(By.TAG_NAME, "label")
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", label)
        try:
            label.click()
            print("[agree] clicked label inside #agree-maimaidxex via label.click()", flush=True)
            return True
        except Exception:
            driver.execute_script("arguments[0].click();", label)
            print("[agree] clicked label inside #agree-maimaidxex via JS click()", flush=True)
            return True
    except Exception:
        pass

    print("[agree] could not find a visible agree checkbox to click", flush=True)
    return False

# ---------- detect ERROR page ----------
def is_error_page(driver):
    try:
        title = (driver.title or "").upper()
        page = driver.page_source or ""
        if "ERROR" in title:
            return True
        if "Error" in page and "Aime service site" in page:
            return True
        try:
            if driver.find_element(By.ID, "error-ui"):
                return True
        except Exception:
            pass
        if "Please enable JavaScript and CSS" in page:
            return True
    except Exception:
        pass
    return False

# ---------- scraping helpers ----------
def get_top_score(driver):
    elements = WebDriverWait(driver, 60).until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".topRecordTable.songRecordTable"))
    )
    if not elements:
        raise RuntimeError("No .topRecordTable.songRecordTable elements found")
    first_element = elements[0]
    new_rating_html = first_element.get_attribute("outerHTML")
    soup = BeautifulSoup(new_rating_html, "html.parser")
    new_records = []
    for row in soup.find_all("tr", class_="scoreRecordRow")[1:]:
        classes = row.get("class", [])
        diff = classes[1] if len(classes) > 1 else ""
        cells = row.find_all("td")
        if len(cells) < 7:
            continue
        new_records.append({
            "#": cells[0].text.strip(),
            "Song": cells[1].text.strip(),
            "Chart": cells[2].text.strip(),
            "Level": cells[3].text.strip(),
            "Achv": cells[4].text.strip(),
            "Rank": cells[5].text.strip(),
            "Rating": cells[6].text.strip(),
            "Diff": diff,
        })
    old_records = []
    if len(elements) >= 2:
        second_element = elements[1]
        old_rating_html = second_element.get_attribute("outerHTML")
        soup2 = BeautifulSoup(old_rating_html, "html.parser")
        for row in soup2.find_all("tr", class_="scoreRecordRow")[1:]:
            classes = row.get("class", [])
            diff = classes[1] if len(classes) > 1 else ""
            cells = row.find_all("td")
            if len(cells) < 7:
                continue
            old_records.append({
                "#": cells[0].text.strip(),
                "Song": cells[1].text.strip(),
                "Chart": cells[2].text.strip(),
                "Level": cells[3].text.strip(),
                "Achv": cells[4].text.strip(),
                "Rank": cells[5].text.strip(),
                "Rating": cells[6].text.strip(),
                "Diff": diff,
            })
    rating_el = WebDriverWait(driver, 60).until(EC.presence_of_element_located((By.CSS_SELECTOR, ".totalRating")))
    text = rating_el.text or ""
    rating = None
    if "：" in text:
        try:
            rating = int(text.split("：", 1)[1])
        except Exception:
            rating = None
    else:
        import re
        m = re.search(r"(\d+)", text)
        rating = int(m.group(1)) if m else None
    data = {
        "new": new_records,
        "old": old_records,
        "rating": rating,
        "Date": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
    }
    try:
        driver.close()
        if driver.window_handles:
            driver.switch_to.window(driver.window_handles[0])
    except Exception:
        pass
    return data

def get_ryan_info(driver, db, formatted_date):
    # take_screenshot(driver, "before_get_ryan_info")
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
        "date": formatted_date,
    }
    db["user_info"].insert_one(ryan_user_data)
    print("[get_ryan_info] inserted ryan user_info", flush=True)
    # take_screenshot(driver, "after_get_ryan_info")

def get_user_info(driver, db, formatted_date):
    wait = WebDriverWait(driver, 10)
    wait.until(EC.visibility_of_element_located((By.TAG_NAME, "body")))
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    collection_items = driver.find_elements(By.CSS_SELECTOR, ".w_112.f_l")
    user_img_elements = []
    for item in collection_items:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'})", item)
        user_img_elements.append(item)
    user_img_src = [element.get_attribute("src") for element in user_img_elements]
    user_name_elements = WebDriverWait(driver, 10).until(
        EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".name_block.t_l.f_l.f_16.underline"))
    )
    user_name = [element.text for element in user_name_elements]
    user_rating_elements = WebDriverWait(driver, 10).until(
        EC.visibility_of_all_elements_located((By.CSS_SELECTOR, ".rating_block"))
    )
    user_rating = [element.text for element in user_rating_elements]
    mapping = {3: "yuchen", 4: "marcus", 5: "kok", 6: "yuan", 7: "keyang"}
    for i in range(3, 8):
        choose = mapping.get(i)
        if not choose:
            continue
        try:
            user_data = {
                "user": choose,
                "img_src": user_img_src[i],
                "name": user_name[i],
                "rating": user_rating[i],
                "date": formatted_date,
            }
        except IndexError:
            print(f"[get_user_info] index error for {choose}: skipping", flush=True)
            continue
        db["user_info"].insert_one(user_data)
        print(f"[get_user_info] inserted {choose}", flush=True)
    # take_screenshot(driver, "after_get_user_info")

# ---------- main update flow ----------
def update():
    driver = None
    log_file = None
    display = None
    load_dotenv()
    login_user = os.getenv("MAIMAI_USER")
    login_pass = os.getenv("MAIMAI_PASS")
    gecko_path = os.getenv("GECKO_PATH")
    user_agent_env = os.getenv("USER_AGENT", "").strip()
    user_agent = user_agent_env or FALLBACK_UA
    take_screens = os.getenv("DEBUG_SCREENSHOTS", "1") not in ("0", "false", "False", "")

    print("[update] starting update", flush=True)

    # two attempts: first UA then alternate UA; both run non-headless under Xvfb
    attempts = [
        {"ua": user_agent, "prefs": {"dom.webdriver.enabled": False, "privacy.resistFingerprinting": False}},
        {"ua": ALT_UA, "prefs": {"dom.webdriver.enabled": False, "privacy.resistFingerprinting": False}},
    ]

    for attempt_idx, att in enumerate(attempts, start=1):
        try:
            print(f"[attempt {attempt_idx}] start with UA: {att['ua']}", flush=True)
            driver, log_file, display = start_driver(gecko_path, att['ua'], extra_prefs=att.get("prefs"), use_xvfb=True)
            if not driver:
                print("[update] driver failed to start for attempt", attempt_idx, flush=True)
                continue

            url = "https://maimaidx-eng.com"
            driver.get(url)
            print("[update] page loaded", flush=True)
            # if take_screens:
                # take_screenshot(driver, "page_loaded")


            # click Sega login button if present
            try:
                sega_button = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.CSS_SELECTOR, ".c-button--openid--segaId")))
                print("[update] clicking sega login button", flush=True)
                sega_button.click()
                # if take_screens:
                    # take_screenshot(driver, "after_click_sega_button")

                # click visible agree checkbox
                clicked = click_visible_agree_checkbox(driver, timeout=8)
                print("[update] agree clicked?", clicked, flush=True)

                time.sleep(random.uniform(0.4, 1.0))

                # fill credentials if visible
                try:
                    sid_element = WebDriverWait(driver, 20).until(EC.element_to_be_clickable((By.ID, "sid")))
                    sid_element.clear()
                    sid_element.send_keys(login_user or "")
                    pass_element = WebDriverWait(driver, 20).until(EC.element_to_be_clickable((By.ID, "password")))
                    pass_element.clear()
                    pass_element.send_keys(login_pass or "")
                    # if take_screens:
                        # take_screenshot(driver, "filled_login_form")
                    login_button = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.CSS_SELECTOR, ".c-button--login")))
                    login_button.click()
                    # if take_screens:
                        # time.sleep(1)
                        # take_screenshot(driver, "after_login_submit")
                    time.sleep(random.uniform(1.0, 2.0))
                except TimeoutException:
                    print("[update] login inputs not found (maybe already logged in or layout changed)", flush=True)
            except TimeoutException:
                print("[update] Sega login button not present; continuing", flush=True)

            # detect ERROR page
            if is_error_page(driver):
                print(f"[attempt {attempt_idx}] server returned ERROR page after login; screenshot saved and will retry", flush=True)
                # if take_screens:
                    # take_screenshot(driver, f"error_after_login_attempt_{attempt_idx}")
                try:
                    driver.quit()
                except Exception:
                    pass
                try:
                    if log_file:
                        log_file.close()
                except Exception:
                    pass
                # try next attempt
                continue

            # continue scraping flow
            print(f"[attempt {attempt_idx}] login looks OK (no ERROR page)", flush=True)
            # inject helper script
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
            except Exception:
                pass

            # Mongo setup
            CONNECTION_STRING = os.getenv("MONGO_URI", "mongodb://mongodb:27017/")
            client = MongoClient(CONNECTION_STRING)
            db = client["mydatabase"]
            formatted_date = datetime.datetime.today().strftime("%d/%m/%Y")

            # get ryan info
            try:
                get_ryan_info(driver, db, formatted_date)
            except TimeoutException:
                print("[update] get_ryan_info timed out", flush=True)
                # if take_screens:
                    # take_screenshot(driver, "get_ryan_info_timeout")
            except Exception as e:
                print("[update] get_ryan_info failed:", e, flush=True)
                print(traceback.format_exc(), flush=True)
                # if take_screens:
                    # take_screenshot(driver, "get_ryan_info_error")

            # analyze rating
            try:
                analyze_rating_link = WebDriverWait(driver, 10).until(EC.visibility_of_element_located((By.LINK_TEXT, "Analyze Rating")))
                analyze_rating_link.click()
                if len(driver.window_handles) > 1:
                    driver.switch_to.window(driver.window_handles[1])
                # if take_screens:
                    # take_screenshot(driver, "analyze_rating_opened")
                ryan_top = get_top_score(driver)
                db["ryan_top"].insert_one(ryan_top)
                print("[update] Done Ryan Score", flush=True)
            except Exception as e:
                print("[update] analyze rating / ryan score failed:", e, flush=True)
                print(traceback.format_exc(), flush=True)
                # if take_screens:
                    # take_screenshot(driver, "analyze_rating_failed")

            # friends scraping
            try:
                driver.get("https://maimaidx-eng.com/maimai-mobile/friend/")
                # if take_screens:
                    # take_screenshot(driver, "friend_page_loaded")
                try:
                    driver.execute_script(script)
                except Exception:
                    pass
                get_user_info(driver, db, formatted_date)
                elements = WebDriverWait(driver, 10).until(EC.visibility_of_all_elements_located((By.CSS_SELECTOR, 'a[target="friendRating"]')))
                friend_collections = [
                    ("yuchen", 3, "yuchen_top"),
                    ("marcus", 4, "marcus_top"),
                    ("kok", 5, "kok_top"),
                    ("yuan", 6, "yuan_top"),
                    ("keyang", 7, "keyang_top"),
                ]
                for name, idx, col in friend_collections:
                    try:
                        elem = elements[idx]
                        elem.click()
                        if len(driver.window_handles) > 1:
                            driver.switch_to.window(driver.window_handles[1])
                        # if take_screens:
                            # take_screenshot(driver, f"{name}_analyze_opened")
                        top = get_top_score(driver)
                        db[col].insert_one(top)
                        print(f"[update] inserted {name} top", flush=True)
                    except IndexError:
                        print(f"[update] elements index {idx} missing for {name}", flush=True)
                    except Exception as e:
                        print(f"[update] failed to get top for {name}: {e}", flush=True)
                        print(traceback.format_exc(), flush=True)
                        # if take_screens:
                            # take_screenshot(driver, f"{name}_get_top_error")
            except Exception as e:
                print("[update] friend page processing failed:", e, flush=True)
                print(traceback.format_exc(), flush=True)
                # if take_screens:
                    # take_screenshot(driver, "friend_page_processing_failed")

            print("[update] finished successfully", flush=True)
            break  # finished successfully

        except Exception as e:
            print("[update] Unhandled exception during attempt:", e, flush=True)
            print(traceback.format_exc(), flush=True)
            # try:
            #     if driver:
            #         # take_screenshot(driver, "unhandled_exception_attempt")
            # except Exception:
                # pass
            try:
                if driver:
                    driver.quit()
            except Exception:
                pass
            try:
                if log_file:
                    log_file.close()
            except Exception:
                pass
            continue

    # cleanup
    try:
        if 'driver' in locals() and driver:
            driver.quit()
            print("[driver] quit", flush=True)
    except Exception:
        print("[driver] error during quit", flush=True)
    try:
        if 'display' in locals() and display:
            try:
                display.stop()
                print("[xvfb] stopped virtual display", flush=True)
            except Exception:
                pass
    except Exception:
        pass
    try:
        if 'log_file' in locals() and log_file:
            try:
                log_file.flush()
                log_file.close()
            except Exception:
                pass
    except Exception:
        pass

# ---------- schedule & run ----------
if __name__ == "__main__":
    load_dotenv()
    run_at = os.getenv("RUN_AT", DEFAULT_RUN_AT)
    print(f"[main] starting — immediate run + scheduled run at {run_at}", flush=True)
    update()
    schedule.every().day.at(run_at).do(update)
    while True:
        schedule.run_pending()
        time.sleep(60)
  