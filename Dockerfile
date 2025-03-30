# Base Ubuntu Image 
FROM ubuntu:22.04 

ENV NODE_VERSION=22.x
ENV PORT=8080

# Node.js Installation
RUN apt-get update && apt-get install -y ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Pulumi
RUN curl -fsSL https://get.pulumi.com | sh

# Install npm packages 
RUN npm install -g \
    typescript \
    express \
    @pulumi/kubernetes \
    @pulumi/pulumi \
    @pulumi/gcp 

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