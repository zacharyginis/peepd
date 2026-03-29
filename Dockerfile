FROM nginx:1.27-alpine

# Remove the default site
RUN rm /etc/nginx/conf.d/default.conf

# Nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Static assets
COPY index.html profile.html my-profile.html how-it-works.html write-review.html \
     privacy-policy.html terms-of-service.html cookie-policy.html \
     /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/  /usr/share/nginx/html/js/
COPY img/ /usr/share/nginx/html/img/

# Cloud Run listens on 8080
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
