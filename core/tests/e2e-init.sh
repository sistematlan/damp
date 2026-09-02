#!/bin/bash
# =============================================================
#  DAMP E2E Init Tests
#  Tests the init flow: file generation, Caddyfile correctness,
#  PHP 8.4 defaults, and HTTP response validation.
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAMP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DAMP_SCRIPT="$DAMP_ROOT/damp"
TEMPLATES_DIR="$DAMP_ROOT/core/templates"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
BOLD="\033[1m"
DIM="\033[2m"
NC="\033[0m"

PASS=0
FAIL=0
SKIP=0

pass() { ((PASS++)); echo -e "  ${GREEN}✔${NC} $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}✘${NC} $1"; }
skip() { ((SKIP++)); echo -e "  ${YELLOW}⤳${NC} $1 (skipped)"; }

# ── Extract functions from damp script ─────────────────────────
FUNCS_FILE=$(mktemp)
awk '/^case "\$\{1:-help\}" in/{exit} {print}' "$DAMP_SCRIPT" > "$FUNCS_FILE"
trap "rm -f '$FUNCS_FILE'" EXIT

# Helper to run a function in a subshell with proper environment
run_fn() {
  (
    DAMP_TLD="test"
    PROJECTS_DIR="/tmp/damp-test-projects"
    TEMPLATES_DIR="$TEMPLATES_DIR"
    GREEN="\033[0;32m"
    YELLOW="\033[0;33m"
    RED="\033[0;31m"
    BOLD="\033[1m"
    DIM="\033[2m"
    NC="\033[0m"
    source "$FUNCS_FILE"
    "$@"
  )
}

# ── Test: Caddyfile uses auto_https off ────────────────────────
test_caddyfile_auto_https_off() {
  echo -e "\n${BOLD}Test: Caddyfile auto_https off${NC}"

  local template_caddy="$TEMPLATES_DIR/frankenphp/Caddyfile"
  if grep -q 'auto_https off' "$template_caddy"; then
    pass "Template Caddyfile uses 'auto_https off'"
  else
    fail "Template Caddyfile does NOT use 'auto_https off'"
  fi

  if grep -q 'auto_https disable_redirects' "$template_caddy"; then
    fail "Template Caddyfile still has 'auto_https disable_redirects'"
  else
    pass "Template Caddyfile has no 'auto_https disable_redirects'"
  fi

  local tmpdir
  tmpdir=$(mktemp -d)
  run_fn generate_caddyfile "$tmpdir" "public"

  if [ -f "$tmpdir/Caddyfile" ]; then
    if grep -q 'auto_https off' "$tmpdir/Caddyfile"; then
      pass "generate_caddyfile output uses 'auto_https off'"
    else
      fail "generate_caddyfile output does NOT use 'auto_https off'"
    fi

    if grep -q 'auto_https disable_redirects' "$tmpdir/Caddyfile"; then
      fail "generate_caddyfile output still has 'auto_https disable_redirects'"
    else
      pass "generate_caddyfile output has no 'auto_https disable_redirects'"
    fi

    if grep -q 'http_port 80' "$tmpdir/Caddyfile"; then
      pass "generate_caddyfile output has 'http_port 80'"
    else
      fail "generate_caddyfile output missing 'http_port 80'"
    fi

    if grep -q 'http://:80' "$tmpdir/Caddyfile"; then
      pass "generate_caddyfile output listens on 'http://:80'"
    else
      fail "generate_caddyfile output does NOT listen on 'http://:80'"
    fi
  else
    fail "generate_caddyfile did not create Caddyfile"
  fi

  rm -rf "$tmpdir"
}

# ── Test: PHP 8.4 is the default version ───────────────────────
test_php84_default() {
  echo -e "\n${BOLD}Test: PHP 8.4 default version${NC}"

  local template_dockerfile="$TEMPLATES_DIR/frankenphp/Dockerfile"
  if grep -q 'php8.4' "$template_dockerfile"; then
    pass "Template Dockerfile uses PHP 8.4"
  else
    fail "Template Dockerfile does NOT use PHP 8.4"
  fi

  # No composer.json → 8.4
  local tmpdir detected
  tmpdir=$(mktemp -d)
  detected=$(run_fn detect_php_version "$tmpdir")
  if [ "$detected" = "8.4" ]; then
    pass "detect_php_version defaults to 8.4 (no composer.json)"
  else
    fail "detect_php_version defaults to '$detected' instead of 8.4"
  fi
  rm -rf "$tmpdir"

  # php ^8.2 → 8.3 (latest in 8.2-8.3 range)
  tmpdir=$(mktemp -d)
  echo '{"require":{"php":"^8.2"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_php_version "$tmpdir")
  if [ "$detected" = "8.3" ]; then
    pass "detect_php_version returns 8.3 for php ^8.2"
  else
    fail "detect_php_version returns '$detected' for php ^8.2 (expected 8.3)"
  fi
  rm -rf "$tmpdir"

  # php ^8.0 → 8.1
  tmpdir=$(mktemp -d)
  echo '{"require":{"php":"^8.0"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_php_version "$tmpdir")
  if [ "$detected" = "8.1" ]; then
    pass "detect_php_version returns 8.1 for php ^8.0"
  else
    fail "detect_php_version returns '$detected' for php ^8.0 (expected 8.1)"
  fi
  rm -rf "$tmpdir"

  # php 7.4 → 7.4
  tmpdir=$(mktemp -d)
  echo '{"require":{"php":"7.4.*"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_php_version "$tmpdir")
  if [ "$detected" = "7.4" ]; then
    pass "detect_php_version returns 7.4 for php 7.4.*"
  else
    fail "detect_php_version returns '$detected' for php 7.4.* (expected 7.4)"
  fi
  rm -rf "$tmpdir"
}

# ── Test: Dockerfile generation per template ───────────────────
test_dockerfile_generation() {
  echo -e "\n${BOLD}Test: Dockerfile generation${NC}"

  local tmpdir
  tmpdir=$(mktemp -d)

  # FrankenPHP
  run_fn generate_dockerfile "$tmpdir" "frankenphp" "8.4"
  if [ -f "$tmpdir/Dockerfile" ]; then
    if grep -q 'dunglas/frankenphp:1-php8.4' "$tmpdir/Dockerfile"; then
      pass "FrankenPHP Dockerfile uses correct base image"
    else
      fail "FrankenPHP Dockerfile has wrong base image"
    fi
    if grep -q 'EXPOSE 80' "$tmpdir/Dockerfile"; then
      pass "FrankenPHP Dockerfile exposes port 80"
    else
      fail "FrankenPHP Dockerfile does NOT expose port 80"
    fi
  else
    fail "FrankenPHP Dockerfile not generated"
  fi

  # PHP-FPM
  rm -f "$tmpdir/Dockerfile"
  run_fn generate_dockerfile "$tmpdir" "php-fpm" "8.4"
  if [ -f "$tmpdir/Dockerfile" ]; then
    if grep -q 'php:8.4-fpm-alpine' "$tmpdir/Dockerfile"; then
      pass "PHP-FPM Dockerfile uses correct base image"
    else
      fail "PHP-FPM Dockerfile has wrong base image"
    fi
  else
    fail "PHP-FPM Dockerfile not generated"
  fi

  # PHP-Legacy
  rm -f "$tmpdir/Dockerfile"
  run_fn generate_dockerfile "$tmpdir" "php-legacy" "7.4"
  if [ -f "$tmpdir/Dockerfile" ]; then
    if grep -q 'php:7.4-fpm-alpine' "$tmpdir/Dockerfile"; then
      pass "PHP-Legacy Dockerfile uses correct base image"
    else
      fail "PHP-Legacy Dockerfile has wrong base image"
    fi
  else
    fail "PHP-Legacy Dockerfile not generated"
  fi

  rm -rf "$tmpdir"
}

# ── Test: docker-compose.yml generation per template ───────────
test_docker_compose_generation() {
  echo -e "\n${BOLD}Test: docker-compose.yml generation${NC}"

  local tmpdir
  tmpdir=$(mktemp -d)

  # FrankenPHP
  run_fn generate_docker_compose "$tmpdir" "test-project" "frankenphp" "test_project_db" ""
  if [ -f "$tmpdir/docker-compose.yml" ]; then
    if grep -q 'container_name: test-project' "$tmpdir/docker-compose.yml"; then
      pass "FrankenPHP compose has correct container_name"
    else
      fail "FrankenPHP compose has wrong container_name"
    fi
    if grep -q 'external: true' "$tmpdir/docker-compose.yml"; then
      pass "FrankenPHP compose uses external damp network"
    else
      fail "FrankenPHP compose does NOT use external damp network"
    fi
    if grep -q 'Caddyfile:/etc/caddy/Caddyfile:ro' "$tmpdir/docker-compose.yml"; then
      pass "FrankenPHP compose mounts Caddyfile"
    else
      fail "FrankenPHP compose does NOT mount Caddyfile"
    fi
  else
    fail "FrankenPHP docker-compose.yml not generated"
  fi

  # PHP-FPM
  rm -f "$tmpdir/docker-compose.yml"
  run_fn generate_docker_compose "$tmpdir" "test-php" "php-fpm" "test_php_db" ""
  if [ -f "$tmpdir/docker-compose.yml" ]; then
    if grep -q 'container_name: test-php-nginx' "$tmpdir/docker-compose.yml"; then
      pass "PHP-FPM compose has nginx container"
    else
      fail "PHP-FPM compose missing nginx container"
    fi
    if grep -q 'nginx:alpine' "$tmpdir/docker-compose.yml"; then
      pass "PHP-FPM compose uses nginx:alpine"
    else
      fail "PHP-FPM compose does NOT use nginx:alpine"
    fi
  else
    fail "PHP-FPM docker-compose.yml not generated"
  fi

  # Node
  rm -f "$tmpdir/docker-compose.yml"
  run_fn generate_docker_compose "$tmpdir" "test-node" "node" "" "npm install && npm run dev -- --host"
  if [ -f "$tmpdir/docker-compose.yml" ]; then
    if grep -q 'node:22-alpine' "$tmpdir/docker-compose.yml"; then
      pass "Node compose uses node:22-alpine"
    else
      fail "Node compose has wrong image"
    fi
  else
    fail "Node docker-compose.yml not generated"
  fi

  # WordPress
  rm -f "$tmpdir/docker-compose.yml"
  run_fn generate_docker_compose "$tmpdir" "test-wp" "wordpress" "test_wp_db" ""
  if [ -f "$tmpdir/docker-compose.yml" ]; then
    if grep -q 'wordpress:latest' "$tmpdir/docker-compose.yml"; then
      pass "WordPress compose uses wordpress:latest"
    else
      fail "WordPress compose has wrong image"
    fi
  else
    fail "WordPress docker-compose.yml not generated"
  fi

  rm -rf "$tmpdir"
}

# ── Test: Dampfile generation ──────────────────────────────────
test_dampfile_generation() {
  echo -e "\n${BOLD}Test: Dampfile generation${NC}"

  local tmpdir
  tmpdir=$(mktemp -d)

  run_fn generate_dampfile "$tmpdir" "my-project" "frankenphp" "8.4" "public" "my_project_db" ""

  if [ -f "$tmpdir/Dampfile" ]; then
    if grep -q 'name: my-project' "$tmpdir/Dampfile"; then
      pass "Dampfile has correct project name"
    else
      fail "Dampfile has wrong project name"
    fi
    if grep -q 'php_version: "8.4"' "$tmpdir/Dampfile"; then
      pass "Dampfile has PHP 8.4"
    else
      fail "Dampfile has wrong PHP version"
    fi
    if grep -q 'domain: my-project.test' "$tmpdir/Dampfile"; then
      pass "Dampfile has correct domain (.test TLD)"
    else
      fail "Dampfile has wrong domain"
    fi
    if grep -q 'document_root: public' "$tmpdir/Dampfile"; then
      pass "Dampfile has correct document_root"
    else
      fail "Dampfile has wrong document_root"
    fi
    if grep -q 'name: my_project_db' "$tmpdir/Dampfile"; then
      pass "Dampfile has correct database name"
    else
      fail "Dampfile has wrong database name"
    fi
  else
    fail "Dampfile not generated"
  fi

  rm -rf "$tmpdir"
}

# ── Test: Template detection ───────────────────────────────────
test_template_detection() {
  echo -e "\n${BOLD}Test: Template detection${NC}"

  local tmpdir detected
  tmpdir=$(mktemp -d)

  # Laravel
  echo '{"require":{"laravel/framework":"^11.0"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_template "$tmpdir")
  if [ "$detected" = "frankenphp" ]; then
    pass "Detects Laravel as frankenphp"
  else
    fail "Detects Laravel as '$detected' (expected frankenphp)"
  fi

  # CodeIgniter4
  echo '{"require":{"codeigniter4/framework":"^4.0"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_template "$tmpdir")
  if [ "$detected" = "frankenphp" ]; then
    pass "Detects CI4 as frankenphp"
  else
    fail "Detects CI4 as '$detected' (expected frankenphp)"
  fi

  # WordPress
  rm -f "$tmpdir/composer.json"
  touch "$tmpdir/wp-config.php"
  detected=$(run_fn detect_template "$tmpdir")
  if [ "$detected" = "wordpress" ]; then
    pass "Detects WordPress"
  else
    fail "Detects WordPress as '$detected' (expected wordpress)"
  fi

  # Node.js
  rm -f "$tmpdir/wp-config.php"
  echo '{"name":"test"}' > "$tmpdir/package.json"
  detected=$(run_fn detect_template "$tmpdir")
  if [ "$detected" = "node" ]; then
    pass "Detects Node.js"
  else
    fail "Detects Node.js as '$detected' (expected node)"
  fi

  # Generic PHP (no framework marker)
  rm -f "$tmpdir/package.json"
  echo '{"require":{"php":"^8.2"}}' > "$tmpdir/composer.json"
  detected=$(run_fn detect_template "$tmpdir")
  if [ "$detected" = "php-fpm" ]; then
    pass "Detects generic PHP as php-fpm"
  else
    fail "Detects generic PHP as '$detected' (expected php-fpm)"
  fi

  rm -rf "$tmpdir"
}

# ── Test: Document root detection ──────────────────────────────
test_document_root_detection() {
  echo -e "\n${BOLD}Test: Document root detection${NC}"

  local tmpdir root
  tmpdir=$(mktemp -d)

  # Laravel (public/)
  mkdir -p "$tmpdir/public"
  echo '<?php' > "$tmpdir/public/index.php"
  root=$(run_fn detect_document_root "$tmpdir" "frankenphp")
  if [ "$root" = "public" ]; then
    pass "Detects public/ for Laravel"
  else
    fail "Detects '$root' for Laravel (expected public)"
  fi

  # Symfony (web/)
  rm -rf "$tmpdir/public"
  mkdir -p "$tmpdir/web"
  echo '<?php' > "$tmpdir/web/index.php"
  root=$(run_fn detect_document_root "$tmpdir" "frankenphp")
  if [ "$root" = "web" ]; then
    pass "Detects web/ for Symfony"
  else
    fail "Detects '$root' for Symfony (expected web)"
  fi

  # Root-level index.php
  rm -rf "$tmpdir/web"
  echo '<?php' > "$tmpdir/index.php"
  root=$(run_fn detect_document_root "$tmpdir" "frankenphp")
  if [ "$root" = "." ]; then
    pass "Detects . for root-level index.php"
  else
    fail "Detects '$root' for root-level (expected .)"
  fi

  # Default (no index.php) → public
  rm -f "$tmpdir/index.php"
  root=$(run_fn detect_document_root "$tmpdir" "frankenphp")
  if [ "$root" = "public" ]; then
    pass "Defaults to public/ when no index.php found"
  else
    fail "Defaults to '$root' (expected public)"
  fi

  rm -rf "$tmpdir"
}

# ── Test: Full init flow (generates all files) ─────────────────
test_full_init_flow() {
  echo -e "\n${BOLD}Test: Full init flow (file generation)${NC}"

  local tmpdir
  tmpdir=$(mktemp -d)

  local project="test-e2e"
  local template="frankenphp"
  local php_ver="8.4"
  local doc_root="public"
  local dbname="test_e2e_db"

  run_fn generate_dampfile "$tmpdir" "$project" "$template" "$php_ver" "$doc_root" "$dbname" ""
  run_fn generate_docker_compose "$tmpdir" "$project" "$template" "$dbname" ""
  run_fn generate_dockerfile "$tmpdir" "$template" "$php_ver"
  run_fn generate_caddyfile "$tmpdir" "$doc_root"

  for f in Dampfile docker-compose.yml Dockerfile Caddyfile; do
    if [ -f "$tmpdir/$f" ]; then
      pass "Init generates $f"
    else
      fail "Init missing $f"
    fi
  done

  if [ -f "$tmpdir/Caddyfile" ]; then
    if grep -q 'auto_https off' "$tmpdir/Caddyfile" && \
       ! grep -q 'auto_https disable_redirects' "$tmpdir/Caddyfile"; then
      pass "Init Caddyfile has correct auto_https config"
    else
      fail "Init Caddyfile has incorrect auto_https config"
    fi
  fi

  if [ -f "$tmpdir/Dockerfile" ]; then
    if grep -q 'php8.4' "$tmpdir/Dockerfile"; then
      pass "Init Dockerfile uses PHP 8.4"
    else
      fail "Init Dockerfile does NOT use PHP 8.4"
    fi
  fi

  if [ -f "$tmpdir/docker-compose.yml" ]; then
    if grep -q "container_name: ${project}" "$tmpdir/docker-compose.yml"; then
      pass "Init compose has correct container name"
    else
      fail "Init compose has wrong container name"
    fi
    if grep -q 'external: true' "$tmpdir/docker-compose.yml"; then
      pass "Init compose uses external damp network"
    else
      fail "Init compose does NOT use external damp network"
    fi
  fi

  rm -rf "$tmpdir"
}

# ── Test: HTTP response (live container) ───────────────────────
test_http_response() {
  echo -e "\n${BOLD}Test: HTTP response (live container)${NC}"

  if ! docker info >/dev/null 2>&1; then
    skip "Docker not running"
    return
  fi

  if ! docker ps --format '{{.Names}}' | grep -q 'damp-caddy'; then
    skip "DAMP caddy not running"
    return
  fi

  # Test dashboard HTTP (should NOT 308)
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9200/ 2>/dev/null || echo "000")
  if [ "$response" = "308" ]; then
    fail "Dashboard HTTP returns 308 redirect (auto_https issue)"
  elif [ "$response" = "000" ]; then
    skip "Cannot connect to dashboard"
  else
    pass "Dashboard HTTP responds with $response (no 308)"
  fi

  # Test a registered project if any exist
  local projects_dir="$DAMP_ROOT/core/caddy/projects.d"
  if [ -d "$projects_dir" ] && ls "$projects_dir"/*.caddy >/dev/null 2>&1; then
    local first_project
    first_project=$(ls "$projects_dir"/*.caddy 2>/dev/null | head -1)
    if [ -n "$first_project" ]; then
      local name domain
      name=$(basename "$first_project" .caddy)
      domain="${name}.test"
      echo -e "  ${DIM}Testing project: ${domain}${NC}"

      response=$(curl -s -o /dev/null -w "%{http_code}" "http://${domain}/" 2>/dev/null || echo "000")
      if [ "$response" = "308" ]; then
        fail "Project ${domain} HTTP returns 308 redirect"
      elif [ "$response" = "000" ]; then
        skip "Cannot connect to ${domain}"
      else
        pass "Project ${domain} HTTP responds with $response (no 308)"
      fi
    fi
  fi
}

# ── Run all tests ──────────────────────────────────────────────
echo -e "${BOLD}DAMP E2E Init Tests${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_caddyfile_auto_https_off
test_php84_default
test_dockerfile_generation
test_docker_compose_generation
test_dampfile_generation
test_template_detection
test_document_root_detection
test_full_init_flow
test_http_response

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}Results:${NC} ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${SKIP} skipped${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}${BOLD}Some tests failed!${NC}"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}All tests passed!${NC}"
  exit 0
fi
