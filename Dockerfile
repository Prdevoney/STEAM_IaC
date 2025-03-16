# Base Ubuntu Image 
FROM ubuntu:22.04 

ENV NODE_VERSION=22.x
ENV PORT=8080

# Node.js Installation
RUN apt-get updata && apt-get install -y \
    curl \
    build-essential \
    ca-certificates \
    --no-install-recommends \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION} | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Typescript and Express
RUN npm install -g typescript express

# Set working directory to app 
WORKDIR /app 

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install 

# Copy all files to app directory
COPY . . 

# Build the app
RUN npm run build 

# Start the app
CMD ["npm", "start"]

# Expose the port
EXPOSE ${PORT}