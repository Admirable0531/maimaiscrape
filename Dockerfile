FROM python:3.11-slim

# Install Firefox and dependencies
RUN apt-get update && apt-get install -y \
    firefox-esr \
    wget \
    curl \
    unzip \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libgtk-3-0 \
    libasound2 \
    libxrandr2 \
    libgl1-mesa-glx \
    dbus-x11 \
    && apt-get clean

# Install Geckodriver (manually to match Firefox ESR)
RUN GECKO_VER=$(curl -s https://api.github.com/repos/mozilla/geckodriver/releases/latest | grep '"tag_name":' | cut -d '"' -f 4) && \
    wget -O /tmp/geckodriver.tar.gz "https://github.com/mozilla/geckodriver/releases/download/$GECKO_VER/geckodriver-$GECKO_VER-linux-aarch64.tar.gz" && \
    tar -xvzf /tmp/geckodriver.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/geckodriver

# Set working directory
WORKDIR /app

# Copy files
COPY update_user_data.py /app/
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Start the script
CMD ["python", "-u", "update_user_data.py"]
