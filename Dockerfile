FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

# Install Firefox + runtime libs used by Firefox and geckodriver
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      x11-utils \
      firefox-esr \
      wget curl unzip ca-certificates \
      libnss3 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 \
      libxi6 libxtst6 libgtk-3-0 libasound2 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*


# Install latest geckodriver matching runtime architecture
RUN GECKO_VER=$(curl -s https://api.github.com/repos/mozilla/geckodriver/releases/latest | grep '"tag_name":' | cut -d '"' -f 4) && \
    case "$(uname -m)" in \
      x86_64) ARCH="linux64";; \
      aarch64) ARCH="aarch64";; \
      armv7l) ARCH="arm7";; \
      *) ARCH="$(uname -m)";; \
    esac && \
    echo "Downloading geckodriver ${GECKO_VER} for ${ARCH}" && \
    wget -q -O /tmp/geckodriver.tar.gz "https://github.com/mozilla/geckodriver/releases/download/${GECKO_VER}/geckodriver-${GECKO_VER}-linux-${ARCH}.tar.gz" && \
    tar -C /usr/local/bin -xzf /tmp/geckodriver.tar.gz geckodriver && \
    rm -f /tmp/geckodriver.tar.gz && chmod +x /usr/local/bin/geckodriver

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY update_user_data.py /app/

# Run the scraper unbuffered so docker logs are immediate
CMD ["python", "-u", "/app/update_user_data.py"]
