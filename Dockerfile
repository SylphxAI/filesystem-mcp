# Stage 1: Install production dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev

# Stage 2: Create the final lightweight image
FROM node:20-alpine
WORKDIR /app

# Create a non-root user and group for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production dependencies and package.json from the deps stage
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=deps --chown=appuser:appgroup /app/package.json ./

# Copy the pre-built application code (from the CI artifact)
# This assumes the 'build' directory is present in the build context
COPY --chown=appuser:appgroup build ./build

# Switch to the non-root user
USER appuser

# Command to run the server using the built output
CMD ["node", "build/index.js"]