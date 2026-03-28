# ── Stage 1: build ────────────────────────────────────────────────────────────
# (No compile step needed — pure static HTML/CSS/JS)
# We use a Node image only to prune devDependencies and verify the asset tree.
FROM node:20-alpine AS build

WORKDIR /app

# Install only production dependencies (Supabase JS is bundled via CDN,
# so node_modules aren't actually served — this step is just a sanity check)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy all static assets
COPY index.html profile.html write-review.html ./
COPY privacy-policy.html terms-of-service.html cookie-policy.html ./
COPY css/   ./css/
COPY js/    ./js/
COPY img/   ./img/


# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static files from build stage
COPY --from=build /app /usr/share/nginx/html

# Cloud Run runs containers as non-root; nginx needs write access to /tmp paths
# (already configured in nginx.conf) and read access to /var/log/nginx
RUN chown -R nginx:nginx /var/log/nginx /usr/share/nginx/html \
 && chmod -R 755 /usr/share/nginx/html

# Cloud Run expects the container to listen on $PORT (default 8080)
EXPOSE 8080

# Health-check (optional but useful for GCP)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

# Run nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
