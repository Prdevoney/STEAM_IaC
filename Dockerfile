# Base Ubuntu Image 
FROM ubuntu:22.04 

ENV NODE_VERSION=22.x
ENV PORT=8080

# Install dependencies
RUN apt-get update && apt-get install -y curl gnupg2 lsb-release

# Node.js Installation
RUN apt-get update && apt-get install -y ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Pulumi and add to PATH
RUN curl -fsSL https://get.pulumi.com | sh && \
    echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.bashrc && \
    echo 'export PATH=$PATH:$HOME/.pulumi/bin' >> ~/.profile && \
    ln -s ~/.pulumi/bin/pulumi /usr/local/bin/pulumi
    
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