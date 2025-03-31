# Base Ubuntu Image 
FROM ubuntu:22.04 

ENV NODE_VERSION=22.x
ENV PORT=8080
ENV USE_GKE_GCLOUD_AUTH_PLUGIN=True

# Install dependencies
RUN apt-get update && apt-get install -y curl gnupg2 apt-transport-https lsb-release

# Install Google Cloud SDK with GKE auth plugin
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - && \
    apt-get update && \
    apt-get install -y google-cloud-sdk google-cloud-sdk-gke-gcloud-auth-plugin kubectl

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