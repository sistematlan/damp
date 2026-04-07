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
