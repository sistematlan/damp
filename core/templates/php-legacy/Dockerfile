FROM php:7.4-fpm-alpine

WORKDIR /app

RUN apk add --no-cache \
    git unzip icu-dev libzip-dev libpng-dev \
    libjpeg-turbo-dev freetype-dev oniguruma-dev

RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
    intl pdo_mysql mysqli zip gd exif opcache mbstring

# Composer (v2 compatible with PHP 7.4)
COPY --from=composer:2.7 /usr/bin/composer /usr/bin/composer
COPY zz-damp.conf /usr/local/etc/php-fpm.d/zz-damp.conf

EXPOSE 9000
CMD ["php-fpm"]
