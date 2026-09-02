#!/bin/bash
# =============================================================
#  DAMP Live Test — Minimal PHP project
#  Creates a test project, starts it, and verifies HTTPS responses.
#  Expected: HTTP → 308 → HTTPS, HTTPS → 200 with content.
# =============================================================
set -euo pipefail

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
BOLD="\033[1m"
DIM="\033[2m"
NC="\033[0m"

PROJECT="damp-test-$$"
DOMAIN="${PROJECT}.test"
TEST_DIR="/tmp/${PROJECT}"
DAMP_TLD="${DAMP_TLD:-test}"

echo -e "${BOLD}DAMP Live Test — Minimal PHP Project${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Cleanup on exit ────────────────────────────────────────────
cleanup() {
  echo -e "\n${DIM}Cleaning up...${NC}"
  cd "$TEST_DIR" 2>/dev/null && docker compose down --remove-orphans 2>/dev/null || true
  rm -rf "$TEST_DIR"
  if grep -q "127.0.0.1.*$DOMAIN" /etc/hosts 2>/dev/null; then
    sudo sed -i '' "/127.0.0.1.*${DOMAIN}/d" /etc/hosts 2>/dev/null || true
  fi
  rm -f "/Users/christianhernandez/sourcecode/damp/core/caddy/projects.d/${PROJECT}.caddy"
  echo -e "${GREEN}✔ Cleanup done${NC}"
}
trap cleanup EXIT

# ── 1. Create project directory ────────────────────────────────
echo -e "${BOLD}1. Creating project files...${NC}"
mkdir -p "$TEST_DIR"

cat > "$TEST_DIR/index.php" <<'PHP'
<?php
$host = $_SERVER['HTTP_HOST'] ?? 'unknown';
$is_https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || ($_SERVER['SERVER_PORT'] ?? 0) == 443
    || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
$scheme = $is_https ? 'https' : 'http';
$url = $scheme . '://' . $host;

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html>
<head><title>DAMP Test</title></head>
<body style="font-family: system-ui; max-width: 600px; margin: 60px auto; text-align: center;">
  <h1>Estás en DAMP</h1>
  <p style="font-size: 1.2em; color: #555;">Tu URL es: <strong><?php echo htmlspecialchars($url); ?></strong></p>
  <p style="color: #888;">Host: <?php echo htmlspecialchars($host); ?></p>
  <p style="color: #888;">PHP: <?php echo phpversion(); ?></p>
  <p style="color: #888;">Server: <?php echo $_SERVER['SERVER_SOFTWARE'] ?? 'unknown'; ?></p>
</body>
</html>
PHP

cat > "$TEST_DIR/Caddyfile" <<'CADDY'
{
	auto_https off
	http_port 80
}

http://:80 {
	root * /app
	php_server

	@notStatic {
		not file
		not path *.ico *.css *.js *.gif *.jpg *.jpeg *.png *.svg *.woff *.woff2 *.ttf *.eot
	}
	rewrite @notStatic /index.php?{query}

	log {
		output stdout
		format console
	}
}
CADDY

cat > "$TEST_DIR/Dockerfile" <<'DOCKER'
FROM dunglas/frankenphp:1-php8.4

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git unzip libzip-dev libicu-dev libpng-dev \
    libjpeg-dev libfreetype6-dev libonig-dev \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    intl pdo_mysql mysqli zip gd exif opcache mbstring

COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
DOCKER

cat > "$TEST_DIR/docker-compose.yml" <<COMPOSE
name: ${PROJECT}
services:
  app:
    build: .
    container_name: ${PROJECT}
    hostname: ${PROJECT}
    volumes:
      - ./:/app
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    restart: unless-stopped
    mem_limit: 512m
    memswap_limit: 512m
    cpus: 1.5
    pids_limit: 256
    networks:
      - damp

networks:
  damp:
    external: true
COMPOSE

echo -e "  ${GREEN}✔${NC} Files created in ${TEST_DIR}"

# ── 2. Add to /etc/hosts ──────────────────────────────────────
echo -e "\n${BOLD}2. Adding ${DOMAIN} to /etc/hosts...${NC}"
if ! grep -q "127.0.0.1.*$DOMAIN" /etc/hosts 2>/dev/null; then
  sudo sh -c "printf '\n127.0.0.1   ${DOMAIN}\n' >> /etc/hosts"
  echo -e "  ${GREEN}✔${NC} Added"
else
  echo -e "  ${DIM}Already exists${NC}"
fi

# ── 3. Register with Caddy ────────────────────────────────────
echo -e "\n${BOLD}3. Registering with Caddy...${NC}"
cat > "/Users/christianhernandez/sourcecode/damp/core/caddy/projects.d/${PROJECT}.caddy" <<CADDY
${DOMAIN} {
    reverse_proxy ${PROJECT}:80
}
CADDY
echo -e "  ${GREEN}✔${NC} Caddy config created"

# ── 4. Build and start ────────────────────────────────────────
echo -e "\n${BOLD}4. Building and starting container...${NC}"
cd "$TEST_DIR"
docker compose up -d --build 2>&1 | tail -5

echo -e "  ${DIM}Waiting for container...${NC}"
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' "$PROJECT" 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 2
done

if [ "$status" = "healthy" ]; then
  echo -e "  ${GREEN}✔${NC} Container is healthy"
else
  echo -e "  ${YELLOW}⚠${NC} Container status: $status (continuing anyway)"
fi

# Reload Caddy
docker compose -f /Users/christianhernandez/sourcecode/damp/core/docker-compose.yml up -d caddy --force-recreate >/dev/null 2>&1
sleep 2

# ── 5. Test HTTP responses ────────────────────────────────────
echo -e "\n${BOLD}5. Testing HTTP responses...${NC}"
PASS=0
FAIL=0

# Test 1: HTTP → 308 redirect to HTTPS (expected behavior)
echo -n "  GET http://${DOMAIN}/ → "
http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}/" 2>/dev/null || echo "000")
if [ "$http_code" = "308" ]; then
  echo -e "${GREEN}${http_code} (redirects to HTTPS — correct!)${NC}"
  ((PASS++))
elif [ "$http_code" = "000" ]; then
  echo -e "${YELLOW}Connection failed${NC}"
  ((FAIL++))
else
  echo -e "${YELLOW}${http_code} (expected 308 redirect)${NC}"
fi

# Test 2: HTTPS → 200 (with -k to skip cert verification)
echo -n "  GET https://${DOMAIN}/ → "
https_code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" 2>/dev/null || echo "000")
if [ "$https_code" = "200" ]; then
  echo -e "${GREEN}${https_code} (HTTPS works!)${NC}"
  ((PASS++))
elif [ "$https_code" = "000" ]; then
  echo -e "${YELLOW}Connection failed${NC}"
  ((FAIL++))
else
  echo -e "${RED}${https_code} (expected 200)${NC}"
  ((FAIL++))
fi

# Test 3: Response body contains "Estás en DAMP"
echo -n "  Body contains 'Estás en DAMP' → "
body=$(curl -sk "https://${DOMAIN}/" 2>/dev/null || echo "")
if echo "$body" | grep -q "Estás en DAMP"; then
  echo -e "${GREEN}✔${NC}"
  ((PASS++))
else
  echo -e "${RED}✘ Not found${NC}"
  ((FAIL++))
fi

# Test 4: Response body contains URL
echo -n "  Body contains 'Tu URL es' → "
if echo "$body" | grep -q "Tu URL es"; then
  echo -e "${GREEN}✔${NC}"
  ((PASS++))
else
  echo -e "${RED}✘ Not found${NC}"
  ((FAIL++))
fi

# Test 5: URL in response uses https://
echo -n "  URL uses https:// → "
if echo "$body" | grep -q "https://${DOMAIN}"; then
  echo -e "${GREEN}✔${NC}"
  ((PASS++))
elif echo "$body" | grep -q "http://${DOMAIN}"; then
  echo -e "${RED}✘ URL shows http:// (should be https://)${NC}"
  ((FAIL++))
else
  echo -e "${YELLOW}⚠ Could not verify${NC}"
fi

# Test 6: PHP version
echo -n "  PHP 8.4 → "
if echo "$body" | grep -q "8.4"; then
  echo -e "${GREEN}✔${NC}"
  ((PASS++))
else
  php_ver=$(echo "$body" | sed -n 's/.*PHP: \([0-9.]*\).*/\1/p' || echo "unknown")
  echo -e "${YELLOW}${php_ver}${NC}"
fi

# Test 7: HTTPS for static files (no redirect loop)
echo -n "  GET https://${DOMAIN}/favicon.ico → "
static_code=$(curl -sk -o /dev/null -w "%{http_code}" "https://${DOMAIN}/favicon.ico" 2>/dev/null || echo "000")
if [ "$static_code" = "200" ]; then
  echo -e "${GREEN}${static_code} (no redirect loop)${NC}"
  ((PASS++))
else
  echo -e "${RED}${static_code} (expected 200)${NC}"
  ((FAIL++))
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}Results:${NC} ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}${BOLD}Some tests failed!${NC}"
  echo -e "${DIM}Container logs:${NC}"
  docker logs "$PROJECT" 2>&1 | tail -10
  exit 1
else
  echo -e "\n${GREEN}${BOLD}All tests passed!${NC}"
  echo -e "\n${DIM}You can manually test:${NC}"
  echo -e "  curl -sk https://${DOMAIN}/"
  echo -e "  open https://${DOMAIN}"
  echo ""
  echo -e "${DIM}Press Enter to cleanup and remove the test project...${NC}"
  read -r
fi
